import { describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createMysqlClient } from './client'
import { ensureMysqlCoreSchema } from './coreSchema'
import { MysqlUserStore } from './userStore'
import { hashUserAccessToken } from '../users'

// Uses a disposable database on an explicitly supplied local test server.
const socketPath = process.env.HAPI_TEST_MYSQL_SOCKET_PATH

describe.skipIf(!socketPath)('MySQL email upgrade integration', () => {
    it('migrates once, preserves credentials and supports full-length email identifiers', async () => {
        const database = `hapi_email_test_${randomUUID().replaceAll('-', '')}`
        const server = createMysqlClient({ socketPath, user: 'root' })
        const target = { socketPath, user: 'root', database }
        const sql = createMysqlClient(target)
        try {
            await server.unsafe(`CREATE DATABASE ${database}`)
            await ensureMysqlCoreSchema(target)
            await sql.unsafe('DELETE FROM schema_migrations')
            await sql.unsafe(`ALTER TABLE users
                MODIFY COLUMN username VARCHAR(191),
                MODIFY COLUMN username_normalized VARCHAR(191),
                MODIFY COLUMN platform_user_id VARCHAR(191) NOT NULL`)
            for (const [username, namespace, disabledAt] of [
                ['Alice', 'default', null],
                ['alice@hapi.local', 'default', null],
                ['Alice', 'tenant', 123]
            ] as const) {
                const token = `hapi_user_${namespace}_${username}`
                await sql.unsafe(`INSERT INTO users (
                    platform, platform_user_id, namespace, username, username_normalized,
                    password_hash, access_token, access_token_hash, role, disabled_at, created_at, updated_at
                ) VALUES ('local', ?, ?, ?, ?, 'old-hash', ?, ?, 'admin', ?, 100, 200)`, [
                    `${namespace}:${username.toLowerCase()}`, namespace, username, username.toLowerCase(),
                    token, hashUserAccessToken(token), disabledAt
                ])
            }
            await sql.unsafe(`INSERT INTO users (platform, platform_user_id, namespace, created_at)
                VALUES ('telegram', '123', 'default', 100)`)
            const original = await sql.unsafe<Array<Record<string, unknown>>>('SELECT * FROM users ORDER BY id')

            // A ledger failure must leave both the data and migration version untouched.
            await sql.unsafe(`CREATE TRIGGER reject_migration BEFORE INSERT ON schema_migrations
                FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ledger unavailable'`)
            await expect(ensureMysqlCoreSchema(target)).rejects.toThrow('ledger unavailable')
            expect(await sql.unsafe<Array<Record<string, unknown>>>('SELECT * FROM users ORDER BY id')).toEqual(original)
            await sql.unsafe('DROP TRIGGER reject_migration')

            await ensureMysqlCoreSchema(target)
            const users = new MysqlUserStore(target)
            expect(await users.getLocalUserByEmail('default', ' ALICE@HAPI.LOCAL ')).toMatchObject({
                id: original[0].id, email: 'Alice@hapi.local', emailNormalized: 'alice@hapi.local',
                platformUserId: 'default:alice@hapi.local', passwordHash: 'old-hash',
                accessToken: 'hapi_user_default_Alice', role: 'admin', createdAt: 100, updatedAt: 200
            })
            expect(await users.getLocalUserByEmail('default', 'alice@hapi.local@hapi.local')).not.toBeNull()
            expect(await users.getLocalUserByEmail('tenant', 'alice@hapi.local')).toMatchObject({ disabledAt: 123 })
            expect(await users.getUserByAccessToken('hapi_user_default_Alice')).toMatchObject({ id: original[0].id })
            expect(await sql.unsafe<Array<Record<string, unknown>>>("SELECT * FROM users WHERE platform = 'telegram'")).toEqual([original[3]])
            await ensureMysqlCoreSchema(target)
            expect(await users.getLocalUserByEmail('default', 'alice@hapi.local')).not.toBeNull()
            expect(await sql.unsafe<Array<{ from_version: number; to_version: number }>>('SELECT from_version, to_version FROM schema_migrations')).toEqual([
                { from_version: 20, to_version: 21 }
            ])

            const email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.example.com`
            const user = await users.createLocalUser({ namespace: 'n'.repeat(128), email, passwordHash: 'hash' })
            expect(user.email).toBe(email)
            expect(user.platformUserId).toBe(`${'n'.repeat(128)}:${email}`)
            const renamed = await users.updateLocalEmail(user.id, user.namespace, 'new@example.com')
            expect(renamed.status).toBe('updated')
            expect(await users.getLocalUserByEmail(user.namespace, email)).toBeNull()
        } finally {
            await sql.close()
            await server.unsafe(`DROP DATABASE IF EXISTS ${database}`)
            await server.close()
        }
    })
})
