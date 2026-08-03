import type { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'

import type { StoredUser } from './types'

type DbUserRow = {
    id: number
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
    disabled_at: number | null
    created_at: number
    updated_at: number | null
}

type UserRole = StoredUser['role']

export type CreateLocalUserInput = {
    namespace: string
    username: string
    passwordHash: string
    displayName?: string | null
    role?: UserRole
    accessToken?: string
}

export type UpdateUserInput = {
    displayName?: string | null
    role?: UserRole
    disabledAt?: number | null
}

export type UpdateLocalUsernameResult =
    | { status: 'updated'; user: StoredUser }
    | { status: 'not_found' }
    | { status: 'duplicate'; existingUser: StoredUser }

function toStoredUser(row: DbUserRow): StoredUser {
    return {
        id: row.id,
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
        disabledAt: row.disabled_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function normalizeUserRole(value: string | null): UserRole {
    return value === 'admin' ? 'admin' : 'user'
}

export function normalizeLocalUsername(username: string): string {
    return username.trim().toLowerCase()
}

export function localPlatformUserId(namespace: string, username: string): string {
    return `${namespace}:${normalizeLocalUsername(username)}`
}

export function generateUserAccessToken(): string {
    return `hapi_user_${randomBytes(32).toString('base64url')}`
}

export function hashUserAccessToken(token: string): string {
    return createHash('sha256').update(token.trim()).digest('hex')
}

export function getUser(db: Database, platform: string, platformUserId: string): StoredUser | null {
    const row = db.prepare(
        'SELECT * FROM users WHERE platform = ? AND platform_user_id = ? LIMIT 1'
    ).get(platform, platformUserId) as DbUserRow | undefined
    return row ? toStoredUser(row) : null
}

export function getUserById(db: Database, userId: number, namespace: string): StoredUser | null {
    const row = db.prepare(
        'SELECT * FROM users WHERE id = ? AND namespace = ? LIMIT 1'
    ).get(userId, namespace) as DbUserRow | undefined
    return row ? toStoredUser(row) : null
}

export function getLocalUserByUsername(db: Database, namespace: string, username: string): StoredUser | null {
    const normalized = normalizeLocalUsername(username)
    const row = db.prepare(`
        SELECT * FROM users
        WHERE platform = 'local'
          AND namespace = ?
          AND username_normalized = ?
        LIMIT 1
    `).get(namespace, normalized) as DbUserRow | undefined
    return row ? toStoredUser(row) : null
}

export function getUserByAccessToken(db: Database, accessToken: string): StoredUser | null {
    const trimmed = accessToken.trim()
    if (!trimmed) return null
    const tokenHash = hashUserAccessToken(trimmed)
    const row = db.prepare(`
        SELECT * FROM users
        WHERE access_token_hash = ?
        LIMIT 1
    `).get(tokenHash) as DbUserRow | undefined
    return row ? toStoredUser(row) : null
}

export function getUsersByPlatform(db: Database, platform: string): StoredUser[] {
    const rows = db.prepare(
        'SELECT * FROM users WHERE platform = ? ORDER BY created_at ASC'
    ).all(platform) as DbUserRow[]
    return rows.map(toStoredUser)
}

export function listUsersByNamespace(db: Database, namespace: string): StoredUser[] {
    const rows = db.prepare(
        'SELECT * FROM users WHERE namespace = ? ORDER BY created_at ASC'
    ).all(namespace) as DbUserRow[]
    return rows.map(toStoredUser)
}

export function getUsersByPlatformAndNamespace(
    db: Database,
    platform: string,
    namespace: string
): StoredUser[] {
    const rows = db.prepare(
        'SELECT * FROM users WHERE platform = ? AND namespace = ? ORDER BY created_at ASC'
    ).all(platform, namespace) as DbUserRow[]
    return rows.map(toStoredUser)
}

export function addUser(
    db: Database,
    platform: string,
    platformUserId: string,
    namespace: string
): StoredUser {
    const now = Date.now()
    db.prepare(`
        INSERT OR IGNORE INTO users (
            platform, platform_user_id, namespace, role, created_at, updated_at
        ) VALUES (
            @platform, @platform_user_id, @namespace, 'user', @created_at, @updated_at
        )
    `).run({
        platform,
        platform_user_id: platformUserId,
        namespace,
        created_at: now,
        updated_at: now
    })

    const row = getUser(db, platform, platformUserId)
    if (!row) {
        throw new Error('Failed to create user')
    }
    return row
}

export function createLocalUser(db: Database, input: CreateLocalUserInput): StoredUser {
    const now = Date.now()
    const username = input.username.trim()
    const usernameNormalized = normalizeLocalUsername(username)
    if (!usernameNormalized) {
        throw new Error('Username is required')
    }
    const accessToken = input.accessToken ?? generateUserAccessToken()
    const accessTokenHash = hashUserAccessToken(accessToken)

    db.prepare(`
        INSERT INTO users (
            platform,
            platform_user_id,
            namespace,
            username,
            username_normalized,
            display_name,
            password_hash,
            access_token,
            access_token_hash,
            role,
            disabled_at,
            created_at,
            updated_at
        ) VALUES (
            'local',
            @platform_user_id,
            @namespace,
            @username,
            @username_normalized,
            @display_name,
            @password_hash,
            @access_token,
            @access_token_hash,
            @role,
            NULL,
            @created_at,
            @updated_at
        )
    `).run({
        platform_user_id: localPlatformUserId(input.namespace, username),
        namespace: input.namespace,
        username,
        username_normalized: usernameNormalized,
        display_name: input.displayName ?? null,
        password_hash: input.passwordHash,
        access_token: accessToken,
        access_token_hash: accessTokenHash,
        role: input.role ?? 'user',
        created_at: now,
        updated_at: now
    })

    const user = getLocalUserByUsername(db, input.namespace, username)
    if (!user) {
        throw new Error('Failed to create local user')
    }
    return user
}

export function updateUser(db: Database, userId: number, namespace: string, input: UpdateUserInput): StoredUser | null {
    const current = getUserById(db, userId, namespace)
    if (!current) return null
    const updatedAt = Date.now()
    db.prepare(`
        UPDATE users
        SET
            display_name = @display_name,
            role = @role,
            disabled_at = @disabled_at,
            updated_at = @updated_at
        WHERE id = @id AND namespace = @namespace
    `).run({
        id: userId,
        namespace,
        display_name: input.displayName !== undefined ? input.displayName : current.displayName,
        role: input.role !== undefined ? input.role : current.role,
        disabled_at: input.disabledAt !== undefined ? input.disabledAt : current.disabledAt,
        updated_at: updatedAt
    })
    return getUserById(db, userId, namespace)
}

export function updateUserPassword(db: Database, userId: number, namespace: string, passwordHash: string): StoredUser | null {
    db.prepare(`
        UPDATE users
        SET password_hash = ?, updated_at = ?
        WHERE id = ? AND namespace = ? AND platform = 'local'
    `).run(passwordHash, Date.now(), userId, namespace)
    return getUserById(db, userId, namespace)
}

export function updateLocalUsername(
    db: Database,
    userId: number,
    namespace: string,
    usernameInput: string
): UpdateLocalUsernameResult {
    const current = getUserById(db, userId, namespace)
    if (!current || current.platform !== 'local') {
        return { status: 'not_found' }
    }

    const username = usernameInput.trim()
    const usernameNormalized = normalizeLocalUsername(username)
    if (!usernameNormalized) {
        throw new Error('Username is required')
    }

    const duplicate = getLocalUserByUsername(db, namespace, username)
    if (duplicate && duplicate.id !== userId) {
        return { status: 'duplicate', existingUser: duplicate }
    }

    db.prepare(`
        UPDATE users
        SET
            platform_user_id = ?,
            username = ?,
            username_normalized = ?,
            updated_at = ?
        WHERE id = ? AND namespace = ? AND platform = 'local'
    `).run(
        localPlatformUserId(namespace, username),
        username,
        usernameNormalized,
        Date.now(),
        userId,
        namespace
    )

    const updated = getUserById(db, userId, namespace)
    if (!updated) {
        return { status: 'not_found' }
    }
    return { status: 'updated', user: updated }
}

export function regenerateUserAccessToken(db: Database, userId: number, namespace: string): StoredUser | null {
    const accessToken = generateUserAccessToken()
    db.prepare(`
        UPDATE users
        SET access_token = ?, access_token_hash = ?, updated_at = ?
        WHERE id = ? AND namespace = ? AND platform = 'local'
    `).run(accessToken, hashUserAccessToken(accessToken), Date.now(), userId, namespace)
    return getUserById(db, userId, namespace)
}

export function removeUser(db: Database, platform: string, platformUserId: string): boolean {
    const result = db.prepare(
        'DELETE FROM users WHERE platform = ? AND platform_user_id = ?'
    ).run(platform, platformUserId)
    return result.changes > 0
}
