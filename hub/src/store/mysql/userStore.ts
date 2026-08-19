import type { StorageConfig } from '@hapi/protocol/storage'
import type { UserStorePort } from '../ports/coreStores'
import type { StoredUser } from '../types'
import {
    generateUserAccessToken,
    hashUserAccessToken,
    localPlatformUserId,
    normalizeLocalUsername,
    type CreateLocalUserInput,
    type UpdateLocalUsernameResult,
    type UpdateUserInput
} from '../users'
import { withMysqlClient } from './client'

type MysqlTarget = Extract<StorageConfig['core'], { backend: 'mysql' }>['mysql']

type MysqlUserRow = {
    id: number | string
    platform: string
    platform_user_id: string
    namespace: string
    username: string | null
    username_normalized: string | null
    display_name: string | null
    password_hash: string | null
    access_token: string | null
    access_token_hash: string | null
    role: string | null
    disabled_at: number | string | null
    created_at: number | string
    updated_at: number | string | null
}

function num(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function normalizeUserRole(value: string | null): StoredUser['role'] {
    return value === 'admin' ? 'admin' : 'user'
}

function toStoredUser(row: MysqlUserRow): StoredUser {
    return {
        id: num(row.id) ?? 0,
        platform: row.platform,
        platformUserId: row.platform_user_id,
        namespace: row.namespace,
        username: row.username,
        usernameNormalized: row.username_normalized,
        displayName: row.display_name,
        passwordHash: row.password_hash,
        accessToken: row.access_token,
        accessTokenHash: row.access_token_hash,
        role: normalizeUserRole(row.role),
        disabledAt: num(row.disabled_at),
        createdAt: num(row.created_at) ?? 0,
        updatedAt: num(row.updated_at)
    }
}

export class MysqlUserStore implements UserStorePort {
    constructor(
        private readonly target: MysqlTarget,
        private readonly onChange?: () => void
    ) {}

    private async withSql<T>(fn: (sql: Bun.SQL) => Promise<T>): Promise<T> {
        return await withMysqlClient(this.target, 'using MySQL user store', fn)
    }

    async getUser(platform: string, platformUserId: string): Promise<StoredUser | null> {
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<MysqlUserRow[]>('SELECT * FROM users WHERE platform = ? AND platform_user_id = ? LIMIT 1', [platform, platformUserId])
            return rows[0] ? toStoredUser(rows[0]) : null
        })
    }

    async getUserById(userId: number, namespace: string): Promise<StoredUser | null> {
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<MysqlUserRow[]>('SELECT * FROM users WHERE id = ? AND namespace = ? LIMIT 1', [userId, namespace])
            return rows[0] ? toStoredUser(rows[0]) : null
        })
    }

    async getLocalUserByUsername(namespace: string, username: string): Promise<StoredUser | null> {
        const normalized = normalizeLocalUsername(username)
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<MysqlUserRow[]>(`
                SELECT * FROM users
                WHERE platform = 'local'
                  AND namespace = ?
                  AND username_normalized = ?
                LIMIT 1
            `, [namespace, normalized])
            return rows[0] ? toStoredUser(rows[0]) : null
        })
    }

    async getUserByAccessToken(accessToken: string): Promise<StoredUser | null> {
        const trimmed = accessToken.trim()
        if (!trimmed) return null
        const tokenHash = hashUserAccessToken(trimmed)
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<MysqlUserRow[]>('SELECT * FROM users WHERE access_token_hash = ? LIMIT 1', [tokenHash])
            return rows[0] ? toStoredUser(rows[0]) : null
        })
    }

    async getUsersByPlatform(platform: string): Promise<StoredUser[]> {
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<MysqlUserRow[]>('SELECT * FROM users WHERE platform = ? ORDER BY created_at ASC', [platform])
            return rows.map(toStoredUser)
        })
    }

    async listUsersByNamespace(namespace: string): Promise<StoredUser[]> {
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<MysqlUserRow[]>('SELECT * FROM users WHERE namespace = ? ORDER BY created_at ASC', [namespace])
            return rows.map(toStoredUser)
        })
    }

    async getUsersByPlatformAndNamespace(platform: string, namespace: string): Promise<StoredUser[]> {
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<MysqlUserRow[]>('SELECT * FROM users WHERE platform = ? AND namespace = ? ORDER BY created_at ASC', [platform, namespace])
            return rows.map(toStoredUser)
        })
    }

    async addUser(platform: string, platformUserId: string, namespace: string): Promise<StoredUser> {
        const now = Date.now()
        return await this.withSql(async (sql) => {
            await sql.unsafe(`
                INSERT IGNORE INTO users (platform, platform_user_id, namespace, role, created_at, updated_at)
                VALUES (?, ?, ?, 'user', ?, ?)
            `, [platform, platformUserId, namespace, now, now])
            this.onChange?.()
            const rows = await sql.unsafe<MysqlUserRow[]>('SELECT * FROM users WHERE platform = ? AND platform_user_id = ? LIMIT 1', [platform, platformUserId])
            if (!rows[0]) throw new Error('Failed to create user')
            return toStoredUser(rows[0])
        })
    }

    async createLocalUser(input: CreateLocalUserInput): Promise<StoredUser> {
        const now = Date.now()
        const username = input.username.trim()
        const usernameNormalized = normalizeLocalUsername(username)
        if (!usernameNormalized) throw new Error('Username is required')
        const accessToken = input.accessToken ?? generateUserAccessToken()
        const accessTokenHash = hashUserAccessToken(accessToken)
        return await this.withSql(async (sql) => {
            await sql.unsafe(`
                INSERT INTO users (
                    platform, platform_user_id, namespace, username, username_normalized, display_name,
                    password_hash, access_token, access_token_hash, role, disabled_at, created_at, updated_at
                ) VALUES ('local', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
            `, [
                localPlatformUserId(input.namespace, username),
                input.namespace,
                username,
                usernameNormalized,
                input.displayName ?? null,
                input.passwordHash,
                accessToken,
                accessTokenHash,
                input.role ?? 'user',
                now,
                now
            ])
            this.onChange?.()
            const rows = await sql.unsafe<MysqlUserRow[]>(`
                SELECT * FROM users WHERE platform = 'local' AND namespace = ? AND username_normalized = ? LIMIT 1
            `, [input.namespace, usernameNormalized])
            if (!rows[0]) throw new Error('Failed to create local user')
            return toStoredUser(rows[0])
        })
    }

    async updateUser(userId: number, namespace: string, input: UpdateUserInput): Promise<StoredUser | null> {
        return await this.withSql(async (sql) => {
            const currentRows = await sql.unsafe<MysqlUserRow[]>('SELECT * FROM users WHERE id = ? AND namespace = ? LIMIT 1', [userId, namespace])
            const current = currentRows[0] ? toStoredUser(currentRows[0]) : null
            if (!current) return null
            const updatedAt = Date.now()
            await sql.unsafe(`
                UPDATE users
                SET display_name = ?, role = ?, disabled_at = ?, updated_at = ?
                WHERE id = ? AND namespace = ?
            `, [
                input.displayName !== undefined ? input.displayName : current.displayName,
                input.role !== undefined ? input.role : current.role,
                input.disabledAt !== undefined ? input.disabledAt : current.disabledAt,
                updatedAt,
                userId,
                namespace
            ])
            this.onChange?.()
            const rows = await sql.unsafe<MysqlUserRow[]>('SELECT * FROM users WHERE id = ? AND namespace = ? LIMIT 1', [userId, namespace])
            return rows[0] ? toStoredUser(rows[0]) : null
        })
    }

    async updateUserPassword(userId: number, namespace: string, passwordHash: string): Promise<StoredUser | null> {
        return await this.withSql(async (sql) => {
            await sql.unsafe(`
                UPDATE users SET password_hash = ?, updated_at = ?
                WHERE id = ? AND namespace = ? AND platform = 'local'
            `, [passwordHash, Date.now(), userId, namespace])
            this.onChange?.()
            const rows = await sql.unsafe<MysqlUserRow[]>('SELECT * FROM users WHERE id = ? AND namespace = ? LIMIT 1', [userId, namespace])
            return rows[0] ? toStoredUser(rows[0]) : null
        })
    }

    async updateLocalUsername(userId: number, namespace: string, usernameInput: string): Promise<UpdateLocalUsernameResult> {
        const username = usernameInput.trim()
        const usernameNormalized = normalizeLocalUsername(username)
        if (!usernameNormalized) throw new Error('Username is required')
        return await this.withSql(async (sql) => {
            const currentRows = await sql.unsafe<MysqlUserRow[]>('SELECT * FROM users WHERE id = ? AND namespace = ? LIMIT 1', [userId, namespace])
            const current = currentRows[0] ? toStoredUser(currentRows[0]) : null
            if (!current || current.platform !== 'local') return { status: 'not_found' }
            const duplicateRows = await sql.unsafe<MysqlUserRow[]>(`
                SELECT * FROM users WHERE platform = 'local' AND namespace = ? AND username_normalized = ? LIMIT 1
            `, [namespace, usernameNormalized])
            const duplicate = duplicateRows[0] ? toStoredUser(duplicateRows[0]) : null
            if (duplicate && duplicate.id !== userId) return { status: 'duplicate', existingUser: duplicate }
            await sql.unsafe(`
                UPDATE users SET platform_user_id = ?, username = ?, username_normalized = ?, updated_at = ?
                WHERE id = ? AND namespace = ? AND platform = 'local'
            `, [localPlatformUserId(namespace, username), username, usernameNormalized, Date.now(), userId, namespace])
            this.onChange?.()
            const rows = await sql.unsafe<MysqlUserRow[]>('SELECT * FROM users WHERE id = ? AND namespace = ? LIMIT 1', [userId, namespace])
            return rows[0] ? { status: 'updated', user: toStoredUser(rows[0]) } : { status: 'not_found' }
        })
    }

    async regenerateUserAccessToken(userId: number, namespace: string): Promise<StoredUser | null> {
        const accessToken = generateUserAccessToken()
        return await this.withSql(async (sql) => {
            await sql.unsafe(`
                UPDATE users SET access_token = ?, access_token_hash = ?, updated_at = ?
                WHERE id = ? AND namespace = ? AND platform = 'local'
            `, [accessToken, hashUserAccessToken(accessToken), Date.now(), userId, namespace])
            this.onChange?.()
            const rows = await sql.unsafe<MysqlUserRow[]>('SELECT * FROM users WHERE id = ? AND namespace = ? LIMIT 1', [userId, namespace])
            return rows[0] ? toStoredUser(rows[0]) : null
        })
    }

    async removeLocalUserById(userId: number, namespace: string, replacementOwnerUserId: number): Promise<StoredUser | null> {
        return await this.withSql(async (sql) => {
            const removed = await sql.begin(async (tx) => {
                const userRows = await tx.unsafe<MysqlUserRow[]>('SELECT * FROM users WHERE id = ? AND namespace = ? AND platform = \'local\' LIMIT 1', [userId, namespace])
                if (!userRows[0]) return null
                const now = Date.now()
                const soleOwnerProjects = await tx.unsafe<Array<{ project_id: string }>>(`
                    SELECT pm.project_id
                    FROM project_members pm
                    INNER JOIN projects p ON p.id = pm.project_id
                    WHERE p.namespace = ? AND pm.user_id = ? AND pm.role = 'owner'
                      AND NOT EXISTS (
                          SELECT 1 FROM project_members other
                          WHERE other.project_id = pm.project_id
                            AND other.user_id != pm.user_id
                            AND other.role = 'owner'
                      )
                `, [namespace, userId])
                for (const project of soleOwnerProjects) {
                    await tx.unsafe(`
                        INSERT INTO project_members (project_id, user_id, role, created_at)
                        VALUES (?, ?, 'owner', ?)
                        ON DUPLICATE KEY UPDATE role = 'owner'
                    `, [project.project_id, replacementOwnerUserId, now])
                }
                const soleOwnerTeams = await tx.unsafe<Array<{ team_id: string }>>(`
                    SELECT tm.team_id
                    FROM team_members tm
                    INNER JOIN teams t ON t.id = tm.team_id
                    WHERE t.namespace = ? AND tm.user_id = ? AND tm.role = 'owner'
                      AND NOT EXISTS (
                          SELECT 1 FROM team_members other
                          WHERE other.team_id = tm.team_id
                            AND other.user_id != tm.user_id
                            AND other.role = 'owner'
                      )
                `, [namespace, userId])
                for (const team of soleOwnerTeams) {
                    await tx.unsafe(`
                        INSERT INTO team_members (team_id, user_id, role, created_at)
                        VALUES (?, ?, 'owner', ?)
                        ON DUPLICATE KEY UPDATE role = 'owner'
                    `, [team.team_id, replacementOwnerUserId, now])
                }
                await tx.unsafe('UPDATE machines SET owner_user_id = ? WHERE namespace = ? AND owner_user_id = ?', [replacementOwnerUserId, namespace, userId])
                await tx.unsafe('UPDATE sessions SET created_by_user_id = NULL WHERE namespace = ? AND created_by_user_id = ?', [namespace, userId])
                await tx.unsafe('UPDATE teams SET created_by_user_id = NULL WHERE namespace = ? AND created_by_user_id = ?', [namespace, userId])
                await tx.unsafe('UPDATE projects SET created_by_user_id = NULL WHERE namespace = ? AND created_by_user_id = ?', [namespace, userId])
                await tx.unsafe('UPDATE project_workspaces SET created_by_user_id = NULL WHERE created_by_user_id = ? AND project_id IN (SELECT id FROM projects WHERE namespace = ?)', [userId, namespace])
                await tx.unsafe('UPDATE project_invites SET created_by_user_id = NULL WHERE created_by_user_id = ? AND project_id IN (SELECT id FROM projects WHERE namespace = ?)', [userId, namespace])
                await tx.unsafe('DELETE FROM team_members WHERE user_id = ? AND team_id IN (SELECT id FROM teams WHERE namespace = ?)', [userId, namespace])
                await tx.unsafe('DELETE FROM project_members WHERE user_id = ? AND project_id IN (SELECT id FROM projects WHERE namespace = ?)', [userId, namespace])
                await tx.unsafe('DELETE FROM users WHERE id = ? AND namespace = ? AND platform = \'local\'', [userId, namespace])
                return toStoredUser(userRows[0])
            })
            if (removed) this.onChange?.()
            return removed
        })
    }

    async removeUser(platform: string, platformUserId: string): Promise<boolean> {
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<MysqlUserRow[]>('SELECT * FROM users WHERE platform = ? AND platform_user_id = ? LIMIT 1', [platform, platformUserId])
            if (!rows[0]) return false
            await sql.unsafe('DELETE FROM users WHERE platform = ? AND platform_user_id = ?', [platform, platformUserId])
            this.onChange?.()
            return true
        })
    }
}
