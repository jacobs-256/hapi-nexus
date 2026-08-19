import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'
import { createStorageRoutes, resumeStorageMigrationIfNeeded, setStorageRestartHandlerForTests } from './storage'
import { Store } from '../../store'
import type { Store as StoreType } from '../../store'
import type { StorageConfig } from '@hapi/protocol/storage'

const directories: string[] = []

afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 1000): Promise<void> {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
        if (await condition()) return
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('Timed out waiting for condition')
}

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

    it('does not create a SQLite core mirror when MySQL is the active core backend', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-storage-direct-'))
        directories.push(directory)
        const dbPath = join(directory, 'hapi.db')
        const store = new Store(dbPath, {
            conversation: {
                backend: 'elasticsearch',
                elasticsearch: { url: 'http://127.0.0.1:9200', index: 'hapi-conversations', apiKey: '' }
            },
            core: {
                backend: 'mysql',
                mysql: { host: '127.0.0.1', port: 3306, database: 'hapi', user: 'hapi', password: '', url: '', socketPath: '' }
            }
        })

        expect(existsSync(dbPath)).toBe(false)
        expect(existsSync(`${dbPath}.core-mirror.db`)).toBe(false)
        expect(existsSync(`${dbPath}.conversation-mirror.db`)).toBe(false)
        store.close()
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
        const body = await response.json() as any
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
        const body = await response.json() as any
        expect(body.saved).toBe(true)
        expect(body.migrated).toBe(true)
        const settings = JSON.parse(await readFile(settingsFile, 'utf8'))
        expect(settings.storage).toEqual(next)

        const migrated = new Store(next.core.backend === 'sqlite' ? next.core.sqlite.path : '', next)
        expect(migrated.sessions.getSession(session.id)?.id).toBe(session.id)
        expect(migrated.messages.getMessages(session.id)).toHaveLength(1)
        migrated.close()
    })

    it('migrates only changed external storage sections when saving settings', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-storage-settings-'))
        directories.push(directory)
        const dbPath = join(directory, 'hapi.db')
        const conversationMirrorPath = join(directory, 'conversation-mirror.db')
        const settingsFile = join(directory, 'settings.json')
        await Promise.all([
            writeFile(dbPath, ''),
            writeFile(conversationMirrorPath, '')
        ])

        const current: StorageConfig = {
            conversation: {
                backend: 'elasticsearch',
                elasticsearch: {
                    url: 'http://es.local:9200',
                    index: 'hapi-conversations',
                    username: '',
                    password: '',
                    apiKey: ''
                }
            },
            core: { backend: 'sqlite', sqlite: { path: dbPath } }
        }
        const next: StorageConfig = {
            conversation: current.conversation,
            core: {
                backend: 'mysql',
                mysql: {
                    host: 'mysql.local',
                    port: 3306,
                    database: 'hapi',
                    user: 'hapi',
                    password: 'secret',
                    url: '',
                    socketPath: ''
                }
            }
        }
        await writeFile(settingsFile, JSON.stringify({ storage: current }))

        let exportedConfig: StorageConfig | null = null
        const store = {
            storageConfig: current,
            sqliteMirrorStorageConfig: {
                conversation: { backend: 'sqlite', sqlite: { path: conversationMirrorPath } },
                core: { backend: 'sqlite', sqlite: { path: dbPath } }
            },
            schemaVersion: 18,
            expectedSchemaVersion: 18,
            exportExternalSnapshot: async (config: StorageConfig) => {
                exportedConfig = config
                return { users: 1 }
            }
        } as unknown as StoreType
        const app = appWithStore(store, 'default', { settingsFile, dataDir: directory, legacyDbPath: dbPath })

        const response = await app.request('/api/storage', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config: next, migrate: 'copy' })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as any
        expect(body.migrated).toBe(true)
        expect(body.migrationStarted).toBe(true)
        await waitFor(() => exportedConfig !== null)
        const capturedExportConfig = exportedConfig as unknown as StorageConfig
        expect(capturedExportConfig.conversation).toEqual({ backend: 'sqlite', sqlite: { path: conversationMirrorPath } })
        expect(capturedExportConfig.core.backend).toBe('mysql')
        expect(capturedExportConfig.core).toMatchObject({
            mysql: {
                host: 'mysql.local',
                database: 'hapi',
                user: 'hapi',
                password: 'secret'
            }
        })
    })

    it('keeps the saved external config when a background migration fails', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-storage-settings-'))
        directories.push(directory)
        const dbPath = join(directory, 'hapi.db')
        const settingsFile = join(directory, 'settings.json')
        await writeFile(dbPath, '')
        const current: StorageConfig = {
            conversation: { backend: 'sqlite', sqlite: { path: dbPath } },
            core: { backend: 'sqlite', sqlite: { path: dbPath } }
        }
        const next: StorageConfig = {
            conversation: {
                backend: 'elasticsearch',
                elasticsearch: { url: 'http://es.local:9200', index: 'hapi-conversations', apiKey: 'secret' }
            },
            core: current.core
        }
        await writeFile(settingsFile, JSON.stringify({ storage: current }))
        const store = {
            storageConfig: current,
            sqliteMirrorStorageConfig: current,
            schemaVersion: 18,
            expectedSchemaVersion: 18,
            exportExternalSnapshot: async () => { throw new Error('boom') }
        } as unknown as StoreType
        const app = appWithStore(store, 'default', { settingsFile, dataDir: directory, legacyDbPath: dbPath })

        const response = await app.request('/api/storage', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config: next, migrate: 'copy' })
        })

        expect(response.status).toBe(200)
        await waitFor(async () => {
            const settings = JSON.parse(await readFile(settingsFile, 'utf8'))
            return settings.storageMigration?.status === 'failed'
        })
        const settings = JSON.parse(await readFile(settingsFile, 'utf8'))
        expect(settings.storage.conversation.backend).toBe('elasticsearch')
        expect(settings.storage.conversation.elasticsearch.index).toBe('hapi-conversations')
    })

    it('unblocks the migration overlay after the first 500 exported rows', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-storage-settings-'))
        directories.push(directory)
        const dbPath = join(directory, 'hapi.db')
        const settingsFile = join(directory, 'settings.json')
        await writeFile(dbPath, '')
        const current: StorageConfig = {
            conversation: { backend: 'sqlite', sqlite: { path: dbPath } },
            core: { backend: 'sqlite', sqlite: { path: dbPath } }
        }
        const next: StorageConfig = {
            conversation: {
                backend: 'elasticsearch',
                elasticsearch: { url: 'http://es.local:9200', index: 'hapi-conversations', apiKey: 'secret' }
            },
            core: current.core
        }
        await writeFile(settingsFile, JSON.stringify({ storage: current }))
        const store = {
            storageConfig: current,
            sqliteMirrorStorageConfig: current,
            schemaVersion: 18,
            expectedSchemaVersion: 18,
            exportExternalSnapshot: async (_config: StorageConfig, options?: { onProgress?: (progress: { group: 'conversation'; table: 'messages'; copiedRows: number; totalRows: number; offset: number }) => void | Promise<void> }) => {
                await options?.onProgress?.({ group: 'conversation', table: 'messages', copiedRows: 500, totalRows: 1000, offset: 500 })
                await new Promise((resolve) => setTimeout(resolve, 20))
                return { messages: 1000 }
            }
        } as unknown as StoreType
        const app = appWithStore(store, 'default', { settingsFile, dataDir: directory, legacyDbPath: dbPath })

        const response = await app.request('/api/storage', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config: next, migrate: 'copy' })
        })

        expect(response.status).toBe(200)
        await waitFor(async () => {
            const settings = JSON.parse(await readFile(settingsFile, 'utf8'))
            return settings.storageMigration?.blocking === false
                && settings.storageMigration?.progress?.copiedRows === 500
        })
    })

    it('resumes a running migration toward the active external config after restart', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-storage-settings-'))
        directories.push(directory)
        const dbPath = join(directory, 'hapi.db')
        const settingsFile = join(directory, 'settings.json')
        const config: StorageConfig = {
            conversation: {
                backend: 'elasticsearch',
                elasticsearch: { url: 'http://es.local:9200', index: 'hapi-conversations', apiKey: 'secret' }
            },
            core: { backend: 'sqlite', sqlite: { path: dbPath } }
        }
        await writeFile(settingsFile, JSON.stringify({
            storage: config,
            storageMigration: {
                id: 'migration-1',
                status: 'running',
                startedAt: Date.now(),
                finishedAt: null,
                message: 'running',
                error: null,
                blocking: false,
                progress: { copiedRows: 500, tableOffsets: { 'conversation.messages': 500 } }
            }
        }))
        let capturedConfig: StorageConfig | null = null
        const store = {
            exportExternalSnapshot: async (target: StorageConfig) => {
                capturedConfig = target
                return { messages: 1 }
            }
        } as unknown as StoreType

        await resumeStorageMigrationIfNeeded(store, { settingsFile, config })

        await waitFor(() => capturedConfig !== null)
        expect((capturedConfig as unknown as StorageConfig).conversation.backend).toBe('elasticsearch')
    })

    it('normalizes fullwidth colons in Elasticsearch URLs before saving', async () => {
        const { app, settingsFile } = await createRealApp()
        const next: StorageConfig = {
            conversation: {
                backend: 'elasticsearch',
                elasticsearch: {
                    url: 'https://anviz-cloud-ba28ec.es.us-west-2.aws.elastic.cloud：443',
                    index: 'hapi-conversations'
                }
            },
            core: { backend: 'sqlite', sqlite: { path: ':memory:' } }
        }

        const response = await app.request('/api/storage', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config: next, migrate: 'none' })
        })

        expect(response.status).toBe(200)
        const settings = JSON.parse(await readFile(settingsFile, 'utf8'))
        expect(settings.storage.conversation.elasticsearch.url).toBe('https://anviz-cloud-ba28ec.es.us-west-2.aws.elastic.cloud:443')
    })

    it('saves settings and schedules an explicit restart when requested', async () => {
        const { app, dbPath, settingsFile } = await createRealApp()
        let restarted = false
        const restoreRestartHandler = setStorageRestartHandlerForTests(() => {
            restarted = true
        })
        const next: StorageConfig = {
            conversation: { backend: 'sqlite', sqlite: { path: dbPath } },
            core: { backend: 'sqlite', sqlite: { path: dbPath } }
        }

        try {
            const response = await app.request('/api/storage', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ config: next, migrate: 'none', restart: true })
            })

            expect(response.status).toBe(200)
            const body = await response.json() as any
            expect(body.saved).toBe(true)
            expect(body.restarting).toBe(true)
            const settings = JSON.parse(await readFile(settingsFile, 'utf8'))
            expect(settings.storage).toEqual(next)
            await waitFor(() => restarted, 1000)
        } finally {
            restoreRestartHandler()
        }
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
