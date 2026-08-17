import { stat } from 'node:fs/promises'
import type {
    SqliteStorageFileUsage,
    SqliteStorageUsageResponse,
    StorageSettingsResponse,
    UpdateStorageSettingsRequest,
    UpdateStorageSettingsResponse
} from '@hapi/protocol/apiTypes'
import { Hono, type Context } from 'hono'
import type { WebAppEnv } from '../middleware/auth'
import type { Store } from '../../store'
import { getSettingsFile, readSettingsOrThrow, updateSettings } from '../../config/settings'
import {
    mergeRedactedStorageConfig,
    normalizeStorageConfig,
    redactStorageConfig,
    validateStorageConfig
} from '../../store/storageConfig'
import { migrateSqliteStorage } from '../../store/storageMigration'
import type { StorageConfig } from '@hapi/protocol/storage'


function storageSectionEquals<K extends keyof StorageConfig>(a: StorageConfig, b: StorageConfig, key: K): boolean {
    return JSON.stringify(a[key]) === JSON.stringify(b[key])
}

function externalMigrationTarget(sourceMirror: StorageConfig, current: StorageConfig, next: StorageConfig): StorageConfig {
    return {
        conversation: storageSectionEquals(current, next, 'conversation')
            ? sourceMirror.conversation
            : next.conversation,
        core: storageSectionEquals(current, next, 'core')
            ? sourceMirror.core
            : next.core
    }
}

function hasStorageAdminAccess(c: Context<WebAppEnv>, store: Store): boolean {
    const namespace = c.get('namespace')
    if (namespace !== 'default') return false
    if (c.get('authPlatform') === 'owner') return true

    const userId = c.get('userId')
    if (typeof userId !== 'number') return false
    const user = store.users.getUserById(userId, namespace)
    return user?.role === 'admin' && user.disabledAt === null
}

function storageAccessDenied(c: Context<WebAppEnv>) {
    return c.json({ error: 'Storage settings are only available to default-namespace administrators' }, 403)
}

async function fileSize(path: string, required = false): Promise<number> {
    try {
        return (await stat(path)).size
    } catch (error) {
        if (!required && error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0
        throw error
    }
}

async function sqliteUsage(path: string): Promise<SqliteStorageFileUsage> {
    const [databaseBytes, walBytes, shmBytes] = await Promise.all([
        fileSize(path, true),
        fileSize(`${path}-wal`),
        fileSize(`${path}-shm`),
    ])
    return {
        path,
        databaseBytes,
        walBytes,
        shmBytes,
        totalBytes: databaseBytes + walBytes + shmBytes,
    }
}

async function storageSettingsResponse(
    store: Store,
    options: { settingsFile: string; dataDir: string; legacyDbPath: string }
): Promise<StorageSettingsResponse> {
    const persisted = await readSettingsOrThrow(options.settingsFile)
    const config = normalizeStorageConfig(persisted.storage, options.dataDir, options.legacyDbPath)
    const activeConfig = store.storageConfig
    const sqlite: StorageSettingsResponse['sqlite'] = {}
    if (activeConfig.core.backend === 'sqlite') {
        sqlite.core = {
            ...await sqliteUsage(activeConfig.core.sqlite.path),
            schemaVersion: store.schemaVersion,
            expectedSchemaVersion: store.expectedSchemaVersion,
        }
    }
    if (activeConfig.conversation.backend === 'sqlite') {
        sqlite.conversation = {
            ...await sqliteUsage(activeConfig.conversation.sqlite.path),
            schemaVersion: store.expectedSchemaVersion,
            expectedSchemaVersion: store.expectedSchemaVersion,
        }
    }
    const redactedConfig = redactStorageConfig(config)
    return {
        config: redactedConfig,
        effectiveConfig: redactedConfig,
        activeConfig: redactStorageConfig(activeConfig),
        restartRequired: JSON.stringify(config) !== JSON.stringify(activeConfig),
        migrationSupported: true,
        ...(Object.keys(sqlite).length > 0 ? { sqlite } : {})
    }
}

export function createStorageRoutes(
    store: Store,
    options?: { settingsFile?: string; dataDir?: string; legacyDbPath?: string }
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const routeOptions = options && options.settingsFile && options.dataDir && options.legacyDbPath
        ? { settingsFile: options.settingsFile, dataDir: options.dataDir, legacyDbPath: options.legacyDbPath }
        : null

    app.get('/storage/sqlite', async (c) => {
        if (!hasStorageAdminAccess(c, store)) {
            return storageAccessDenied(c)
        }
        c.header('Cache-Control', 'no-store')
        try {
            const dbPath = store.dbPath
            const usage = await sqliteUsage(dbPath)
            const response: SqliteStorageUsageResponse = {
                ...usage,
                schemaVersion: store.schemaVersion,
                expectedSchemaVersion: store.expectedSchemaVersion,
            }
            return c.json(response)
        } catch (error) {
            return c.json({
                error: error instanceof Error ? error.message : 'Failed to read SQLite storage usage'
            }, 500)
        }
    })

    app.get('/storage', async (c) => {
        if (!hasStorageAdminAccess(c, store)) {
            return storageAccessDenied(c)
        }
        if (!routeOptions) {
            return c.json({ error: 'Storage settings are not configurable in this context' }, 503)
        }
        c.header('Cache-Control', 'no-store')
        try {
            return c.json(await storageSettingsResponse(store, routeOptions))
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to read storage settings' }, 500)
        }
    })

    app.put('/storage', async (c) => {
        if (!hasStorageAdminAccess(c, store)) {
            return storageAccessDenied(c)
        }
        if (!routeOptions) {
            return c.json({ error: 'Storage settings are not configurable in this context' }, 503)
        }
        let body: UpdateStorageSettingsRequest
        try {
            body = await c.req.json()
        } catch {
            return c.json({ error: 'Invalid JSON body' }, 400)
        }
        try {
            const currentSettings = await readSettingsOrThrow(routeOptions.settingsFile)
            const currentConfig = normalizeStorageConfig(currentSettings.storage, routeOptions.dataDir, routeOptions.legacyDbPath)
            const normalized = normalizeStorageConfig(body.config, routeOptions.dataDir, routeOptions.legacyDbPath)
            const nextConfig: StorageConfig = mergeRedactedStorageConfig(normalized, currentConfig)
            validateStorageConfig(nextConfig)

            let migrated = false
            let migrationMessage: string | undefined
            if (body.migrate === 'copy') {
                if (nextConfig.core.backend === 'sqlite' && nextConfig.conversation.backend === 'sqlite') {
                    const result = migrateSqliteStorage(store.sqliteMirrorStorageConfig, nextConfig)
                    migrated = result.migrated
                    migrationMessage = result.message
                } else {
                    const migrationTarget = externalMigrationTarget(store.sqliteMirrorStorageConfig, currentConfig, nextConfig)
                    const copied = await store.exportExternalSnapshot(migrationTarget)
                    const total = Object.values(copied).reduce((sum, value) => sum + value, 0)
                    migrated = total > 0
                    migrationMessage = `Exported ${total} row(s) to changed external storage.`
                }
            }

            await updateSettings(routeOptions.settingsFile, (settings) => {
                settings.storage = nextConfig
            })
            const response: UpdateStorageSettingsResponse = {
                ...await storageSettingsResponse(store, routeOptions),
                saved: true,
                migrated,
                ...(migrationMessage ? { migrationMessage } : {})
            }
            return c.json(response)
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to update storage settings' }, 400)
        }
    })

    return app
}
