import { LocalEmailSchema } from '@hapi/protocol'
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
    email: string
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

export type UpdateLocalEmailResult =
    | { status: 'updated'; user: StoredUser }
    | { status: 'not_found' }
    | { status: 'duplicate'; existingUser: StoredUser }

function toStoredUser(row: DbUserRow): StoredUser {
    return {
        id: row.id,
        platform: row.platform,
        platformUserId: row.platform_user_id,
        namespace: row.namespace,
        // Persist emails in the historical SQL columns to keep snapshots compatible.
        email: row.username,
        emailNormalized: row.username_normalized,
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

export function normalizeLocalEmail(email: string): string {
    return email.trim().toLowerCase()
}

export function localPlatformUserId(namespace: string, email: string): string {
    return `${namespace}:${normalizeLocalEmail(email)}`
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

export function getLocalUserByEmail(db: Database, namespace: string, email: string): StoredUser | null {
    const normalized = normalizeLocalEmail(email)
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
    const email = LocalEmailSchema.parse(input.email)
    const emailNormalized = normalizeLocalEmail(email)
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
        platform_user_id: localPlatformUserId(input.namespace, email),
        namespace: input.namespace,
        username: email,
        username_normalized: emailNormalized,
        display_name: input.displayName ?? null,
        password_hash: input.passwordHash,
        access_token: accessToken,
        access_token_hash: accessTokenHash,
        role: input.role ?? 'user',
        created_at: now,
        updated_at: now
    })

    const user = getLocalUserByEmail(db, input.namespace, email)
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

export function updateLocalEmail(
    db: Database,
    userId: number,
    namespace: string,
    emailInput: string
): UpdateLocalEmailResult {
    const current = getUserById(db, userId, namespace)
    if (!current || current.platform !== 'local') {
        return { status: 'not_found' }
    }

    const email = LocalEmailSchema.parse(emailInput)
    const emailNormalized = normalizeLocalEmail(email)

    const duplicate = getLocalUserByEmail(db, namespace, email)
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
        localPlatformUserId(namespace, email),
        email,
        emailNormalized,
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

export function removeLocalUserById(
    db: Database,
    userId: number,
    namespace: string,
    replacementOwnerUserId: number
): StoredUser | null {
    const remove = db.transaction((): StoredUser | null => {
        const user = getUserById(db, userId, namespace)
        if (!user || user.platform !== 'local') {
            return null
        }

        const now = Date.now()
        const soleOwnerProjects = db.prepare(`
            SELECT pm.project_id
            FROM project_members pm
            INNER JOIN projects p ON p.id = pm.project_id
            WHERE p.namespace = ?
              AND pm.user_id = ?
              AND pm.role = 'owner'
              AND NOT EXISTS (
                  SELECT 1
                  FROM project_members other
                  WHERE other.project_id = pm.project_id
                    AND other.user_id != pm.user_id
                    AND other.role = 'owner'
              )
        `).all(namespace, userId) as Array<{ project_id: string }>
        for (const project of soleOwnerProjects) {
            db.prepare(`
                INSERT INTO project_members (project_id, user_id, role, created_at)
                VALUES (?, ?, 'owner', ?)
                ON CONFLICT(project_id, user_id) DO UPDATE SET role = 'owner'
            `).run(project.project_id, replacementOwnerUserId, now)
        }

        const soleOwnerTeams = db.prepare(`
            SELECT tm.team_id
            FROM team_members tm
            INNER JOIN teams t ON t.id = tm.team_id
            WHERE t.namespace = ?
              AND tm.user_id = ?
              AND tm.role = 'owner'
              AND NOT EXISTS (
                  SELECT 1
                  FROM team_members other
                  WHERE other.team_id = tm.team_id
                    AND other.user_id != tm.user_id
                    AND other.role = 'owner'
              )
        `).all(namespace, userId) as Array<{ team_id: string }>
        for (const team of soleOwnerTeams) {
            db.prepare(`
                INSERT INTO team_members (team_id, user_id, role, created_at)
                VALUES (?, ?, 'owner', ?)
                ON CONFLICT(team_id, user_id) DO UPDATE SET role = 'owner'
            `).run(team.team_id, replacementOwnerUserId, now)
        }

        db.prepare('UPDATE machines SET owner_user_id = ? WHERE namespace = ? AND owner_user_id = ?')
            .run(replacementOwnerUserId, namespace, userId)
        db.prepare('UPDATE sessions SET created_by_user_id = NULL WHERE namespace = ? AND created_by_user_id = ?')
            .run(namespace, userId)
        db.prepare('UPDATE teams SET created_by_user_id = NULL WHERE namespace = ? AND created_by_user_id = ?')
            .run(namespace, userId)
        db.prepare('UPDATE projects SET created_by_user_id = NULL WHERE namespace = ? AND created_by_user_id = ?')
            .run(namespace, userId)
        db.prepare(`
            UPDATE project_workspaces
            SET created_by_user_id = NULL
            WHERE created_by_user_id = ?
              AND project_id IN (SELECT id FROM projects WHERE namespace = ?)
        `).run(userId, namespace)
        db.prepare(`
            UPDATE project_invites
            SET created_by_user_id = NULL
            WHERE created_by_user_id = ?
              AND project_id IN (SELECT id FROM projects WHERE namespace = ?)
        `).run(userId, namespace)
        db.prepare(`
            DELETE FROM team_members
            WHERE user_id = ?
              AND team_id IN (SELECT id FROM teams WHERE namespace = ?)
        `).run(userId, namespace)
        db.prepare(`
            DELETE FROM project_members
            WHERE user_id = ?
              AND project_id IN (SELECT id FROM projects WHERE namespace = ?)
        `).run(userId, namespace)

        const result = db.prepare(
            "DELETE FROM users WHERE id = ? AND namespace = ? AND platform = 'local'"
        ).run(userId, namespace)

        return result.changes > 0 ? user : null
    })

    return remove()
}

export function removeUser(db: Database, platform: string, platformUserId: string): boolean {
    const result = db.prepare(
        'DELETE FROM users WHERE platform = ? AND platform_user_id = ?'
    ).run(platform, platformUserId)
    return result.changes > 0
}
