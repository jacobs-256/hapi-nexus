import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store, SCHEMA_VERSION } from '../../index'
import { hashUserAccessToken } from '../../users'
import { initializeCoreSqliteSchema } from '../../sqlite/storeInitializer'
import { runSchemaMigrationStep } from '../../sqlite/migrationLedger'
import { migrateFromV20ToV21 } from '../v20ToV21'
import { createAuthRoutes } from '../../../web/routes/auth'

function rawDb(store: Store): Database {
    return (store as unknown as { db: Database }).db
}

function addLegacyUser(db: Database, username: string, namespace = 'default', disabledAt: number | null = null): number {
    const token = `hapi_user_${namespace}_${username}`
    const result = db.prepare(`
        INSERT INTO users (
            platform, platform_user_id, namespace, username, username_normalized,
            display_name, password_hash, access_token, access_token_hash, role,
            disabled_at, created_at, updated_at
        ) VALUES ('local', ?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?, 100, 200)
    `).run(`${namespace}:${username.toLowerCase()}`, namespace, username, username.toLowerCase(),
        'Legacy User', Bun.password.hashSync('old-password'), token, hashUserAccessToken(token), disabledAt)
    return Number(result.lastInsertRowid)
}

describe('Store V20→V21 migration: local usernames to email', () => {
    it('handles suffix collisions when Unicode case folding changes username length', () => {
        const store = new Store(':memory:')
        try {
            const db = rawDb(store)
            const username = 'i\u0307'.repeat(20)
            const suffixUsername = `${'\u0130'.repeat(20)}@hapi.local`
            addLegacyUser(db, username)
            addLegacyUser(db, suffixUsername)
            db.exec('DELETE FROM schema_migrations; PRAGMA user_version = 20;')
            initializeCoreSqliteSchema(db, ':memory:', SCHEMA_VERSION)
            expect(store.users.getLocalUserByEmail('default', `${username}@hapi.local`)?.email).toBe(`${username}@hapi.local`)
            expect(store.users.getLocalUserByEmail('default', `${suffixUsername}@hapi.local`)?.email).toBe(`${suffixUsername}@hapi.local`)
        } finally {
            store.close()
        }
    })

    it('does not apply a stale migration step after another startup has committed it', () => {
        const store = new Store(':memory:')
        try {
            const db = rawDb(store)
            addLegacyUser(db, 'Alice')
            db.exec('DELETE FROM schema_migrations; PRAGMA user_version = 20;')
            // Both starters may have read version 20 before taking the write lock.
            for (let starter = 0; starter < 2; starter++) {
                runSchemaMigrationStep(db, 20, 21, null, () => migrateFromV20ToV21(db))
            }
            expect(store.users.getLocalUserByEmail('default', 'alice@hapi.local')?.email).toBe('Alice@hapi.local')
            expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: 1 })
        } finally {
            store.close()
        }
    })

    it('preserves identities, credentials, ownership and history; backs up and runs once', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'hapi-email-upgrade-'))
        const dbPath = join(directory, 'hapi.db')
        let store: Store | undefined
        try {
            store = new Store(dbPath)
            const db = rawDb(store)
            const aliceId = addLegacyUser(db, 'Alice')
            const suffixedId = addLegacyUser(db, 'alice@hapi.local')
            const tenantId = addLegacyUser(db, 'Alice', 'tenant', 123)
            const unusualId = addLegacyUser(db, '张 三@team')
            const longId = addLegacyUser(db, 'a'.repeat(128))
            const telegram = store.users.addUser('telegram', '12345', 'default')
            const original = store.users.getUserById(aliceId, 'default')!
            const project = store.projects.createProject('default', 'Existing project', aliceId)
            const machine = store.machines.getOrCreateMachine('machine', {}, null, 'default', { ownerUserId: aliceId })
            const session = store.sessions.getOrCreateSession('session', { machineId: machine.id }, null, 'default', undefined, undefined, undefined, undefined, {
                projectId: project.id, createdByUserId: aliceId
            })
            store.messages.addMessage(session.id, { text: 'existing history' }, 'old-message')
            db.exec('DELETE FROM schema_migrations; PRAGMA user_version = 20;')
            store.close()

            store = new Store(dbPath)
            expect(store.schemaVersion).toBe(SCHEMA_VERSION)
            expect(store.users.getLocalUserByEmail('default', ' ALICE@HAPI.LOCAL ')).toEqual({
                ...original,
                email: 'Alice@hapi.local',
                emailNormalized: 'alice@hapi.local',
                platformUserId: 'default:alice@hapi.local'
            })
            expect(store.users.getUserById(suffixedId, 'default')?.email).toBe('alice@hapi.local@hapi.local')
            expect(store.users.getUserById(tenantId, 'tenant')).toMatchObject({ email: 'Alice@hapi.local', disabledAt: 123 })
            expect(store.users.getUserById(longId, 'default')?.email).toBe(`${'a'.repeat(128)}@hapi.local`)
            expect(store.users.getUserById(telegram.id, 'default')).toEqual(telegram)
            expect(store.users.getUserByAccessToken(original.accessToken!)?.id).toBe(aliceId)
            expect(store.projects.listProjectMembers(project.id)).toContainEqual(expect.objectContaining({ userId: aliceId, role: 'owner' }))
            expect(store.machines.getMachine(machine.id)?.ownerUserId).toBe(aliceId)
            expect(store.sessions.getSession(session.id)?.createdByUserId).toBe(aliceId)
            expect(rawDb(store).prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 1 })

            const app = createAuthRoutes(new TextEncoder().encode('email-upgrade-test-secret'), store)
            for (const [email, id] of [['Alice@hapi.local', aliceId], ['张 三@team@hapi.local', unusualId]] as const) {
                const response = await app.request('/auth', {
                    method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ email, password: 'old-password' })
                })
                expect(response.status).toBe(200)
                expect(await response.json()).toMatchObject({ user: { id, email } })
            }
            const oldLogin = await app.request('/auth', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'Alice', password: 'old-password' })
            })
            expect(oldLogin.status).toBe(401)

            const ledger = rawDb(store).prepare('SELECT * FROM schema_migrations').all() as Array<{ from_version: number; to_version: number; backup_path: string }>
            expect(ledger).toHaveLength(1)
            expect(ledger[0]).toMatchObject({ from_version: 20, to_version: 21 })
            expect(existsSync(ledger[0].backup_path)).toBe(true)
            const restoredPath = join(directory, 'restored.db')
            copyFileSync(ledger[0].backup_path, restoredPath)
            const backup = new Database(restoredPath)
            expect(backup.prepare('SELECT username FROM users WHERE id = ?').get(aliceId)).toEqual({ username: 'Alice' })
            backup.close()

            store.close()
            store = new Store(dbPath)
            expect(store.users.getUserById(aliceId, 'default')?.email).toBe('Alice@hapi.local')
            expect(rawDb(store).prepare('SELECT * FROM schema_migrations').all()).toEqual(ledger)
        } finally {
            store?.close()
            rmSync(directory, { recursive: true, force: true })
        }
    })

    it('rolls back data and version if recording the migration fails', () => {
        const store = new Store(':memory:')
        try {
            const db = rawDb(store)
            addLegacyUser(db, 'Alice')
            db.exec(`
                DELETE FROM schema_migrations;
                PRAGMA user_version = 20;
                CREATE TRIGGER reject_migration BEFORE INSERT ON schema_migrations
                BEGIN SELECT RAISE(ABORT, 'ledger unavailable'); END;
            `)
            expect(() => initializeCoreSqliteSchema(db, ':memory:', SCHEMA_VERSION)).toThrow('ledger unavailable')
            expect(store.schemaVersion).toBe(20)
            expect(db.prepare('SELECT username FROM users').all()).toEqual([{ username: 'Alice' }])
            db.exec('DROP TRIGGER reject_migration;')
            initializeCoreSqliteSchema(db, ':memory:', SCHEMA_VERSION)
            expect(store.users.getLocalUserByEmail('default', 'alice@hapi.local')).not.toBeNull()
        } finally {
            store.close()
        }
    })
})
