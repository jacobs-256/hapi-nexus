import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'
import { createStorageRoutes } from './storage'
import { Store } from '../../store'
import type { Store as StoreType } from '../../store'
import type { StorageConfig } from '@hapi/protocol/storage'

const directories: string[] = []

afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function appWithStore(store: StoreType, namespace = 'default', options?: { settingsFile?: string; dataDir?: string; legacyDbPath?: string }) {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('userId', 1)
        c.set('namespace', namespace)
        c.set('authPlatform', 'owner')
        await next()
    })
    app.route('/api', createStorageRoutes(store, options))
    return app
}

describe('GET /api/storage/sqlite', () => {
    function createApp(dbPath: string, namespace = 'default') {
        const store = {
            dbPath,
            schemaVersion: 18,
            expectedSchemaVersion: 18,
            storageConfig: {
                conversation: { backend: 'sqlite', sqlite: { path: dbPath } },
                core: { backend: 'sqlite', sqlite: { path: dbPath } }
            }
        } as StoreType
        return appWithStore(store, namespace)
    }

    it('returns the database and existing sidecar sizes', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-storage-'))
        directories.push(directory)
        const dbPath = join(directory, 'hapi.db')
        await Promise.all([
            writeFile(dbPath, Buffer.alloc(10)),
            writeFile(`${dbPath}-wal`, Buffer.alloc(20)),
        ])
        const app = createApp(dbPath)

        const response = await app.request('/api/storage/sqlite')

        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(await response.json()).toEqual({
            path: dbPath,
            databaseBytes: 10,
            walBytes: 20,
            shmBytes: 0,
            totalBytes: 30,
            schemaVersion: 18,
            expectedSchemaVersion: 18,
        })
    })

    it('rejects non-default namespaces', async () => {
        const response = await createApp('/unused/hapi.db', 'tenant').request('/api/storage/sqlite')

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({ error: 'Storage settings are only available to default-namespace administrators' })
    })
})

describe('GET/PUT /api/storage', () => {
    async function createRealApp() {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-storage-settings-'))
        directories.push(directory)
        const dbPath = join(directory, 'hapi.db')
        const settingsFile = join(directory, 'settings.json')
        const store = new Store(dbPath)
        const app = appWithStore(store, 'default', { settingsFile, dataDir: directory, legacyDbPath: dbPath })
        return { app, store, directory, dbPath, settingsFile }
    }

    it('returns redacted storage config and active backends', async () => {
        const { app, dbPath } = await createRealApp()

        const response = await app.request('/api/storage')

        expect(response.status).toBe(200)
        const body = await response.json() as any as any
        expect(body.config).toEqual({
            conversation: { backend: 'sqlite', sqlite: { path: dbPath } },
            core: { backend: 'sqlite', sqlite: { path: dbPath } }
        })
        expect(body.restartRequired).toBe(false)
        expect(body.sqlite.core.path).toBe(dbPath)
    })

    it('saves a split SQLite config and copies data when requested', async () => {
        const { app, store, directory, settingsFile } = await createRealApp()
        const session = store.sessions.getOrCreateSession('tag', { path: '/tmp' }, null, 'default')
        store.messages.addMessage(session.id, { role: 'agent', content: 'hello' })
        const next: StorageConfig = {
            conversation: { backend: 'sqlite', sqlite: { path: join(directory, 'conversation.db') } },
            core: { backend: 'sqlite', sqlite: { path: join(directory, 'core.db') } }
        }

        const response = await app.request('/api/storage', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config: next, migrate: 'copy' })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as any as any
        expect(body.saved).toBe(true)
        expect(body.migrated).toBe(true)
        const settings = JSON.parse(await readFile(settingsFile, 'utf8'))
        expect(settings.storage).toEqual(next)

        const migrated = new Store(next.core.backend === 'sqlite' ? next.core.sqlite.path : '', next)
        expect(migrated.sessions.getSession(session.id)?.id).toBe(session.id)
        expect(migrated.messages.getMessages(session.id)).toHaveLength(1)
        migrated.close()
    })

    it('rejects non-default namespaces', async () => {
        const { store, dbPath, directory, settingsFile } = await createRealApp()
        const app = appWithStore(store, 'tenant', { settingsFile, dataDir: directory, legacyDbPath: dbPath })
        const response = await app.request('/api/storage')

        expect(response.status).toBe(403)
    })

    it('rejects default-namespace non-admin users', async () => {
        const { store, dbPath, directory, settingsFile } = await createRealApp()
        const user = store.users.createLocalUser({
            namespace: 'default',
            username: 'viewer',
            passwordHash: 'hash',
            role: 'user'
        })
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('userId', user.id)
            c.set('namespace', 'default')
            c.set('authPlatform', 'local')
            await next()
        })
        app.route('/api', createStorageRoutes(store, { settingsFile, dataDir: directory, legacyDbPath: dbPath }))

        const response = await app.request('/api/storage')

        expect(response.status).toBe(403)
    })
})
