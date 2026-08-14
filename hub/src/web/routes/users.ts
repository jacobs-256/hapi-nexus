import { Hono } from 'hono'
import {
    ChangeOwnPasswordRequestSchema,
    ChangeOwnUsernameRequestSchema,
    CreateUserRequestSchema,
    ResetUserPasswordRequestSchema,
    UpdateUserRequestSchema,
    type EnterpriseUser
} from '@hapi/protocol'
import { getConfiguration } from '../../configuration'
import { getOrCreateOwnerId } from '../../config/ownerId'
import { DEFAULT_NAMESPACE } from '../../utils/accessToken'
import type { Store, StoredUser } from '../../store'
import type { WebAppEnv } from '../middleware/auth'

type UsersRouteOptions = {
    getOwnerUserId?: () => Promise<number>
    getOwnerAccessToken?: (namespace: string) => string
}

function ownerAccessToken(namespace: string): string {
    const token = getConfiguration().cliApiToken
    return namespace === DEFAULT_NAMESPACE ? token : `${token}:${namespace}`
}

async function getCurrentOwnerUserId(): Promise<number> {
    return await getOrCreateOwnerId()
}

function toEnterpriseUser(user: StoredUser, includeToken: boolean): EnterpriseUser {
    return {
        id: user.id,
        platform: user.platform,
        platformUserId: user.platformUserId,
        namespace: user.namespace,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        disabledAt: user.disabledAt,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        ...(includeToken ? { accessToken: user.accessToken } : {})
    }
}


function canViewStoredUserAccessToken(user: StoredUser, actorUserId: number, authPlatform?: string): boolean {
    return user.platform === 'local' && user.id === actorUserId && authPlatform === 'local'
}

function toOwnerEnterpriseUser(ownerId: number, namespace: string, includeToken: boolean): EnterpriseUser {
    return {
        id: ownerId,
        platform: 'owner',
        platformUserId: 'hub-owner',
        namespace,
        username: 'admin',
        displayName: 'Hub Owner',
        role: 'admin',
        disabledAt: null,
        createdAt: 0,
        updatedAt: null,
        ...(includeToken ? { accessToken: ownerAccessToken(namespace) } : {})
    }
}

async function isEnterpriseAdmin(
    store: Store,
    namespace: string,
    userId: number,
    getOwnerUserId: () => Promise<number>,
    authPlatform?: string
): Promise<boolean> {
    const ownerId = await getOwnerUserId()
    if (authPlatform === 'owner' || (authPlatform === undefined && userId === ownerId)) return true

    const user = store.users.getUserById(userId, namespace)
    return user?.role === 'admin' && user.disabledAt === null
}

async function isOwnerAuth(
    userId: number,
    authPlatform: string | undefined,
    getOwnerUserId: () => Promise<number>
): Promise<boolean> {
    if (authPlatform === 'owner') return true
    if (authPlatform !== undefined) return false
    return userId === await getOwnerUserId()
}

async function hashPassword(password: string): Promise<string> {
    return await Bun.password.hash(password, { algorithm: 'argon2id' })
}

async function verifyPassword(password: string, passwordHash: string | null): Promise<boolean> {
    if (!passwordHash) return false
    try {
        return await Bun.password.verify(password, passwordHash)
    } catch {
        return false
    }
}

export function createUsersRoutes(store: Store, options?: UsersRouteOptions): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const getOwnerUserId = options?.getOwnerUserId ?? getCurrentOwnerUserId
    const getOwnerAccessToken = options?.getOwnerAccessToken ?? ownerAccessToken

    app.get('/me', async (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const authPlatform = c.get('authPlatform')
        const ownerId = await getOwnerUserId()
        if (await isOwnerAuth(userId, authPlatform, getOwnerUserId)) {
            return c.json({
                user: {
                    ...toOwnerEnterpriseUser(ownerId, namespace, false),
                    accessToken: getOwnerAccessToken(namespace)
                }
            })
        }

        const user = store.users.getUserById(userId, namespace)
        if (!user) {
            return c.json({ error: 'User not found' }, 404)
        }

        return c.json({ user: toEnterpriseUser(user, true) })
    })

    app.post('/me/token/regenerate', async (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        if (await isOwnerAuth(userId, c.get('authPlatform'), getOwnerUserId)) {
            return c.json({ error: 'Hub owner token is CLI_API_TOKEN. Regenerate it from hub settings.' }, 400)
        }

        const user = store.users.regenerateUserAccessToken(userId, namespace)
        if (!user) {
            return c.json({ error: 'User not found' }, 404)
        }

        return c.json({
            user: toEnterpriseUser(user, true),
            accessToken: user.accessToken ?? ''
        })
    })

    app.post('/me/password', async (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        if (await isOwnerAuth(userId, c.get('authPlatform'), getOwnerUserId)) {
            return c.json({ error: 'Hub owner password is not available. Sign in with a local admin account.' }, 400)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = ChangeOwnPasswordRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }

        const user = store.users.getUserById(userId, namespace)
        if (!user || user.platform !== 'local' || user.disabledAt !== null) {
            return c.json({ error: 'Local user not found' }, 404)
        }

        const currentPasswordOk = await verifyPassword(parsed.data.currentPassword, user.passwordHash)
        if (!currentPasswordOk) {
            return c.json({ error: 'Current password is incorrect' }, 401)
        }

        const updated = store.users.updateUserPassword(userId, namespace, await hashPassword(parsed.data.newPassword))
        if (!updated) {
            return c.json({ error: 'Local user not found' }, 404)
        }

        return c.json({ user: toEnterpriseUser(updated, true) })
    })

    app.patch('/me/username', async (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        if (await isOwnerAuth(userId, c.get('authPlatform'), getOwnerUserId)) {
            return c.json({ error: 'Hub owner username is not editable. Sign in with a local admin account.' }, 400)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = ChangeOwnUsernameRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }

        const result = store.users.updateLocalUsername(userId, namespace, parsed.data.username)
        if (result.status === 'not_found') {
            return c.json({ error: 'Local user not found' }, 404)
        }
        if (result.status === 'duplicate') {
            return c.json({ error: 'Username already exists' }, 409)
        }

        return c.json({ user: toEnterpriseUser(result.user, true) })
    })

    app.get('/users', async (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        if (!await isEnterpriseAdmin(store, namespace, userId, getOwnerUserId, c.get('authPlatform'))) {
            return c.json({ error: 'Admin access required' }, 403)
        }

        const authPlatform = c.get('authPlatform')
        const ownerId = await getOwnerUserId()
        const actorIsOwner = await isOwnerAuth(userId, authPlatform, getOwnerUserId)
        const users = [
            {
                ...toOwnerEnterpriseUser(ownerId, namespace, false),
                ...(actorIsOwner ? { accessToken: getOwnerAccessToken(namespace) } : {})
            },
            ...store.users.listUsersByNamespace(namespace).map((user) => (
                toEnterpriseUser(user, canViewStoredUserAccessToken(user, userId, authPlatform))
            ))
        ]
        return c.json({ users })
    })

    app.post('/users', async (c) => {
        const namespace = c.get('namespace')
        const actorUserId = c.get('userId')
        if (!await isEnterpriseAdmin(store, namespace, actorUserId, getOwnerUserId, c.get('authPlatform'))) {
            return c.json({ error: 'Admin access required' }, 403)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = CreateUserRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }

        if (store.users.getLocalUserByUsername(namespace, parsed.data.username)) {
            return c.json({ error: 'Username already exists' }, 409)
        }

        try {
            const passwordHash = await hashPassword(parsed.data.password)
            const user = store.users.createLocalUser({
                namespace,
                username: parsed.data.username,
                passwordHash,
                displayName: parsed.data.displayName ?? null,
                role: parsed.data.role
            })
            return c.json({ user: toEnterpriseUser(user, false) }, 201)
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to create user' }, 400)
        }
    })

    app.patch('/users/:id', async (c) => {
        const namespace = c.get('namespace')
        const actorUserId = c.get('userId')
        const actorIsOwner = await isOwnerAuth(actorUserId, c.get('authPlatform'), getOwnerUserId)
        if (!await isEnterpriseAdmin(store, namespace, actorUserId, getOwnerUserId, c.get('authPlatform'))) {
            return c.json({ error: 'Admin access required' }, 403)
        }

        const targetUserId = Number(c.req.param('id'))
        if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
            return c.json({ error: 'Invalid user id' }, 400)
        }

        const ownerId = await getOwnerUserId()
        const target = store.users.getUserById(targetUserId, namespace)
        if (!target && targetUserId === ownerId) {
            return c.json({ error: 'Hub owner is managed by CLI_API_TOKEN settings' }, 400)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = UpdateUserRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }

        if (!actorIsOwner && targetUserId === actorUserId && (parsed.data.disabled || parsed.data.role === 'user')) {
            return c.json({ error: 'Admins cannot disable or demote their own account' }, 400)
        }

        const user = store.users.updateUser(targetUserId, namespace, {
            displayName: parsed.data.displayName,
            role: parsed.data.role,
            disabledAt: parsed.data.disabled === undefined
                ? undefined
                : parsed.data.disabled ? Date.now() : null
        })
        if (!user) {
            return c.json({ error: 'User not found' }, 404)
        }

        return c.json({ user: toEnterpriseUser(user, canViewStoredUserAccessToken(user, actorUserId, c.get('authPlatform'))) })
    })

    app.delete('/users/:id', async (c) => {
        const namespace = c.get('namespace')
        const actorUserId = c.get('userId')
        const actorIsOwner = await isOwnerAuth(actorUserId, c.get('authPlatform'), getOwnerUserId)
        if (!await isEnterpriseAdmin(store, namespace, actorUserId, getOwnerUserId, c.get('authPlatform'))) {
            return c.json({ error: 'Admin access required' }, 403)
        }

        const targetUserId = Number(c.req.param('id'))
        if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
            return c.json({ error: 'Invalid user id' }, 400)
        }

        const ownerId = await getOwnerUserId()
        const target = store.users.getUserById(targetUserId, namespace)
        if (!target && targetUserId === ownerId) {
            return c.json({ error: 'Hub owner is managed by CLI_API_TOKEN settings' }, 400)
        }
        if (!actorIsOwner && targetUserId === actorUserId) {
            return c.json({ error: 'Admins cannot delete their own account' }, 400)
        }
        if (!target) {
            return c.json({ error: 'User not found' }, 404)
        }
        if (target.platform !== 'local') {
            return c.json({ error: 'Only local users can be deleted' }, 400)
        }

        const deleted = store.users.removeLocalUserById(targetUserId, namespace, actorUserId)
        if (!deleted) {
            return c.json({ error: 'Local user not found' }, 404)
        }

        return c.json({ ok: true })
    })

    app.post('/users/:id/password', async (c) => {
        const namespace = c.get('namespace')
        const actorUserId = c.get('userId')
        if (!await isEnterpriseAdmin(store, namespace, actorUserId, getOwnerUserId, c.get('authPlatform'))) {
            return c.json({ error: 'Admin access required' }, 403)
        }

        const targetUserId = Number(c.req.param('id'))
        if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
            return c.json({ error: 'Invalid user id' }, 400)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = ResetUserPasswordRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }

        const user = store.users.updateUserPassword(targetUserId, namespace, await hashPassword(parsed.data.password))
        if (!user) {
            return c.json({ error: 'Local user not found' }, 404)
        }

        return c.json({ user: toEnterpriseUser(user, canViewStoredUserAccessToken(user, actorUserId, c.get('authPlatform'))) })
    })

    return app
}
