import { stat } from 'node:fs/promises'
import type {
    SqliteStorageFileUsage,
    SqliteStorageUsageResponse,
    StorageSettingsResponse,
    UpdateStorageSettingsRequest,
    UpdateStorageSettingsResponse,
    StorageMigrationStatus
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
import { migrateExternalStorageToSqlite, migrateSqliteStorage } from '../../store/storageMigration'
import type { StorageConfig } from '@hapi/protocol/storage'


function storageSectionEquals<K extends keyof StorageConfig>(a: StorageConfig, b: StorageConfig, key: K): boolean {
    return JSON.stringify(a[key]) === JSON.stringify(b[key])
}


function changedToSqlite(current: StorageConfig, next: StorageConfig, key: keyof StorageConfig): boolean {
    if (storageSectionEquals(current, next, key)) return false
    return next[key].backend === 'sqlite' && current[key].backend !== 'sqlite'
}

function selectiveSqliteImportConfig(current: StorageConfig, next: StorageConfig): { source: StorageConfig; target: StorageConfig } {
    const memorySqlite = { backend: 'sqlite' as const, sqlite: { path: ':memory:' } }
    return {
        source: {
            core: changedToSqlite(current, next, 'core') ? current.core : memorySqlite,
            conversation: changedToSqlite(current, next, 'conversation') ? current.conversation : memorySqlite
        },
        target: {
            core: changedToSqlite(current, next, 'core') && next.core.backend === 'sqlite' ? next.core : memorySqlite,
            conversation: changedToSqlite(current, next, 'conversation') && next.conversation.backend === 'sqlite' ? next.conversation : memorySqlite
        }
    }
}

function hasChangedExternalTarget(current: StorageConfig, next: StorageConfig): boolean {
    return (!storageSectionEquals(current, next, 'core') && next.core.backend !== 'sqlite')
        || (!storageSectionEquals(current, next, 'conversation') && next.conversation.backend !== 'sqlite')
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

const runningMigrations = new Set<string>()
const STORAGE_MIGRATION_UNBLOCK_ROWS = 500
let restartHub: () => void = () => {
    process.exit(0)
}

export function setStorageRestartHandlerForTests(handler: () => void): () => void {
    const previous = restartHub
    restartHub = handler
    return () => {
        restartHub = previous
    }
}

function scheduleStorageRestart(): void {
    setTimeout(() => {
        console.log('[Storage] Restart requested after storage settings update.')
        restartHub()
    }, 500).unref?.()
}

function idleMigrationStatus(): StorageMigrationStatus {
    return { id: '', status: 'idle', startedAt: null, finishedAt: null, message: null, error: null }
}

function isRunningMigration(status: StorageMigrationStatus | undefined): boolean {
    return status?.status === 'running'
}

export async function readStorageMigrationStatus(settingsFile: string): Promise<StorageMigrationStatus> {
    const settings = await readSettingsOrThrow(settingsFile)
    const status = settings.storageMigration
    if (!status) return idleMigrationStatus()
    return status
}

async function writeStorageMigrationStatus(settingsFile: string, status: StorageMigrationStatus, storage?: StorageConfig): Promise<void> {
    await updateSettings(settingsFile, (settings) => {
        if (storage) settings.storage = storage
        settings.storageMigration = status
    })
}

async function performStorageMigration(
    store: Store,
    currentConfig: StorageConfig,
    nextConfig: StorageConfig,
    options: {
        forceExternalExport?: boolean
        initialOffsets?: Record<string, number>
        onProgress?: (status: StorageMigrationStatus) => void | Promise<void>
        status?: StorageMigrationStatus
    } = {}
): Promise<string> {
    const messages: string[] = []
    if (nextConfig.core.backend === 'sqlite' && nextConfig.conversation.backend === 'sqlite' && currentConfig.core.backend === 'sqlite' && currentConfig.conversation.backend === 'sqlite') {
        const result = migrateSqliteStorage(store.sqliteMirrorStorageConfig, nextConfig)
        messages.push(result.message)
    } else if (changedToSqlite(currentConfig, nextConfig, 'core') || changedToSqlite(currentConfig, nextConfig, 'conversation')) {
        const { source, target } = selectiveSqliteImportConfig(currentConfig, nextConfig)
        const result = await migrateExternalStorageToSqlite(source, target)
        messages.push(result.message)
    }

    if (options.forceExternalExport || hasChangedExternalTarget(currentConfig, nextConfig)) {
        const migrationTarget = options.forceExternalExport
            ? nextConfig
            : externalMigrationTarget(store.sqliteMirrorStorageConfig, currentConfig, nextConfig)
        const copied = await store.exportExternalSnapshot(migrationTarget, {
            initialOffsets: options.initialOffsets,
            onProgress: async (progress) => {
                const previous = options.status?.progress
                const tableOffsets = {
                    ...(previous?.tableOffsets ?? {}),
                    [`${progress.group}.${progress.table}`]: progress.offset
                }
                const tableTotals = {
                    ...(previous?.tableTotals ?? {}),
                    ...(progress.totalRows === undefined ? {} : { [`${progress.group}.${progress.table}`]: progress.totalRows })
                }
                const copiedRows = Object.values(tableOffsets).reduce((sum, value) => sum + value, 0)
                if (options.status) {
                    options.status.progress = {
                        copiedRows,
                        totalRows: Object.values(tableTotals).reduce((sum, value) => sum + value, 0),
                        currentTable: `${progress.group}.${progress.table}`,
                        tableOffsets,
                        tableTotals
                    }
                    options.status.blocking = copiedRows < STORAGE_MIGRATION_UNBLOCK_ROWS
                    if (!options.status.blocking) {
                        options.status.message = 'Storage migration is continuing in the background. You can use the web app now.'
                    }
                    await options.onProgress?.(options.status)
                }
            }
        })
        const total = Object.values(copied).reduce((sum, value) => sum + value, 0)
        messages.push(`Exported ${total} row(s) to changed external storage.`)
    }
    return messages.join(' ')
}

async function startBackgroundStorageMigration(
    store: Store,
    options: { settingsFile: string; currentConfig: StorageConfig; nextConfig: StorageConfig; resume?: boolean; forceExternalExport?: boolean }
): Promise<StorageMigrationStatus> {
    if (runningMigrations.has(options.settingsFile)) {
        throw new Error('Storage migration is already running. Please wait until it finishes.')
    }
    const existing = options.resume ? (await readSettingsOrThrow(options.settingsFile)).storageMigration : undefined
    const status: StorageMigrationStatus = existing?.status === 'running'
        ? {
            ...existing,
            message: existing.blocking === false
                ? 'Storage migration is continuing in the background. You can use the web app now.'
                : 'Storage migration resumed. Please wait before logging in or operating the web app.',
            error: null
        }
        : {
            id: crypto.randomUUID(),
            status: 'running',
            startedAt: Date.now(),
            finishedAt: null,
            message: 'Storage migration is running. Please wait before logging in or operating the web app.',
            error: null,
            blocking: true,
            progress: { copiedRows: 0, tableOffsets: {} }
        }
    runningMigrations.add(options.settingsFile)
    await writeStorageMigrationStatus(options.settingsFile, status, options.nextConfig)
    void (async () => {
        try {
            await new Promise((resolve) => setTimeout(resolve, 0))
            const migrationMessage = await performStorageMigration(store, options.currentConfig, options.nextConfig, {
                forceExternalExport: options.forceExternalExport,
                initialOffsets: status.progress?.tableOffsets,
                status,
                onProgress: async (updated) => {
                    await writeStorageMigrationStatus(options.settingsFile, { ...updated }, options.nextConfig)
                }
            })
            await updateSettings(options.settingsFile, (settings) => {
                settings.storage = options.nextConfig
                settings.storageMigration = {
                    ...status,
                    status: 'success',
                    finishedAt: Date.now(),
                    message: migrationMessage || 'Storage migration completed.',
                    error: null,
                    blocking: false
                }
            })
        } catch (error) {
            console.warn('[Storage] Background storage migration failed:', error instanceof Error ? error.message : error)
            await writeStorageMigrationStatus(options.settingsFile, {
                ...status,
                status: 'failed',
                finishedAt: Date.now(),
                message: null,
                error: error instanceof Error ? error.message : String(error),
                blocking: false
            }, options.nextConfig)
        } finally {
            runningMigrations.delete(options.settingsFile)
        }
    })()
    return status
}

export async function resumeStorageMigrationIfNeeded(store: Store, options: { settingsFile: string; config: StorageConfig }): Promise<void> {
    const settings = await readSettingsOrThrow(options.settingsFile)
    const status = settings.storageMigration
    if (status?.status !== 'running') return
    if (runningMigrations.has(options.settingsFile)) return
    await startBackgroundStorageMigration(store, {
        settingsFile: options.settingsFile,
        currentConfig: options.config,
        nextConfig: options.config,
        resume: true,
        forceExternalExport: true
    })
}

async function hasStorageAdminAccess(c: Context<WebAppEnv>, store: Store): Promise<boolean> {
    const namespace = c.get('namespace')
    if (namespace !== 'default') return false
    if (c.get('authPlatform') === 'owner') return true

    const userId = c.get('userId')
    if (typeof userId !== 'number') return false
    const user = await store.users.getUserById(userId, namespace)
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
    const migration = await readStorageMigrationStatus(options.settingsFile)
    return {
        config: redactedConfig,
        effectiveConfig: redactedConfig,
        activeConfig: redactStorageConfig(activeConfig),
        restartRequired: JSON.stringify(config) !== JSON.stringify(activeConfig),
        migrationSupported: true,
        migration,
        externalSync: typeof store.getExternalStorageSyncStatus === 'function'
            ? store.getExternalStorageSyncStatus()
            : {},
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
        if (!await hasStorageAdminAccess(c, store)) {
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
        if (!await hasStorageAdminAccess(c, store)) {
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
        if (!await hasStorageAdminAccess(c, store)) {
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
            const existingMigration = await readStorageMigrationStatus(routeOptions.settingsFile)
            if (isRunningMigration(existingMigration)) {
                return c.json({ error: 'Storage migration is already running. Please wait until it finishes.' }, 409)
            }

            let migrated = false
            let migrationMessage: string | undefined
            let migrationStarted = false
            let migrationStatus: StorageMigrationStatus | undefined
            if (body.migrate === 'copy') {
                const needsBackgroundMigration = hasChangedExternalTarget(currentConfig, nextConfig)
                    || changedToSqlite(currentConfig, nextConfig, 'core')
                    || changedToSqlite(currentConfig, nextConfig, 'conversation')
                if (needsBackgroundMigration) {
                    migrationStatus = await startBackgroundStorageMigration(store, {
                        settingsFile: routeOptions.settingsFile,
                        currentConfig,
                        nextConfig
                    })
                    migrated = true
                    migrationStarted = true
                    migrationMessage = migrationStatus.message ?? undefined
                } else {
                    migrationMessage = await performStorageMigration(store, currentConfig, nextConfig)
                    migrated = Boolean(migrationMessage)
                    await updateSettings(routeOptions.settingsFile, (settings) => {
                        settings.storage = nextConfig
                    })
                }
            } else {
                await updateSettings(routeOptions.settingsFile, (settings) => {
                    settings.storage = nextConfig
                })
            }
            const response: UpdateStorageSettingsResponse = {
                ...await storageSettingsResponse(store, routeOptions),
                ...(migrationStatus ? { migration: migrationStatus } : {}),
                saved: true,
                migrated,
                ...(migrationMessage ? { migrationMessage } : {}),
                ...(migrationStarted ? { migrationStarted } : {}),
                ...(body.restart === true ? { restarting: true } : {})
            }
            if (body.restart === true) {
                scheduleStorageRestart()
            }
            return c.json(response)
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to update storage settings' }, 400)
        }
    })

    return app
}
