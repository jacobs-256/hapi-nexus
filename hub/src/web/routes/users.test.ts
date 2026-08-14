import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

import { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import { createUsersRoutes } from './users'

const OWNER_ID = 999

function createApp(
    store: Store,
    userId: number,
    namespace = 'default',
    options?: { ownerId?: number; authPlatform?: string }
) {
    const ownerId = options?.ownerId ?? OWNER_ID
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', namespace)
        c.set('userId', userId)
        c.set('authPlatform', options?.authPlatform ?? (userId === ownerId ? 'owner' : 'local'))
        await next()
    })
    app.route('/api', createUsersRoutes(store, {
        getOwnerUserId: async () => ownerId,
        getOwnerAccessToken: (ns) => ns === 'default' ? 'owner-token' : `owner-token:${ns}`
    }))
    return app
}

describe('users routes', () => {
    it('lets the owner create local users without listing other users access tokens', async () => {
        const store = new Store(':memory:')
        try {
            const app = createApp(store, OWNER_ID)

            const createResponse = await app.request('/api/users', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    username: 'alice',
                    displayName: 'Alice',
                    password: 'correct-password',
                    role: 'admin'
                })
            })

            expect(createResponse.status).toBe(201)
            const created = await createResponse.json() as { user: { id: number; accessToken?: string; role: string } }
            expect(created.user).not.toHaveProperty('accessToken')
            expect(created.user.role).toBe('admin')

            const listResponse = await app.request('/api/users')
            expect(listResponse.status).toBe(200)
            const body = await listResponse.json() as { users: Array<{ platform: string; username: string | null; accessToken?: string | null }> }
            const owner = body.users.find((user) => user.platform === 'owner')
            const alice = body.users.find((user) => user.platform === 'local' && user.username === 'alice')
            expect(owner).toEqual(expect.objectContaining({ platform: 'owner', accessToken: 'owner-token' }))
            expect(alice).toEqual(expect.objectContaining({ platform: 'local', username: 'alice' }))
            expect(alice).not.toHaveProperty('accessToken')
        } finally {
            store.close()
        }
    })

    it('lets local administrators see only their own access token in the user list', async () => {
        const store = new Store(':memory:')
        try {
            const admin = store.users.createLocalUser({
                namespace: 'default',
                username: 'admin',
                passwordHash: 'hash-admin',
                accessToken: 'hapi_user_admin',
                role: 'admin'
            })
            store.users.createLocalUser({
                namespace: 'default',
                username: 'dev',
                passwordHash: 'hash-dev',
                accessToken: 'hapi_user_dev',
                role: 'user'
            })
            const app = createApp(store, admin.id)

            const response = await app.request('/api/users')

            expect(response.status).toBe(200)
            const body = await response.json() as { users: Array<{ platform: string; username: string | null; accessToken?: string | null }> }
            const owner = body.users.find((user) => user.platform === 'owner')
            const self = body.users.find((user) => user.platform === 'local' && user.username === 'admin')
            const dev = body.users.find((user) => user.platform === 'local' && user.username === 'dev')
            expect(owner).not.toHaveProperty('accessToken')
            expect(self).toEqual(expect.objectContaining({ accessToken: 'hapi_user_admin' }))
            expect(dev).not.toHaveProperty('accessToken')
        } finally {
            store.close()
        }
    })

    it('rejects non-admin user management', async () => {
        const store = new Store(':memory:')
        try {
            const user = store.users.createLocalUser({
                namespace: 'default',
                username: 'dev',
                passwordHash: 'hash',
                accessToken: 'hapi_user_dev',
                role: 'user'
            })
            const app = createApp(store, user.id)

            const response = await app.request('/api/users')

            expect(response.status).toBe(403)
        } finally {
            store.close()
        }
    })

    it('lets a local user view and regenerate their own access token', async () => {
        const store = new Store(':memory:')
        try {
            const user = store.users.createLocalUser({
                namespace: 'default',
                username: 'dev',
                passwordHash: 'hash',
                accessToken: 'hapi_user_dev',
                role: 'user'
            })
            const app = createApp(store, user.id)

            const meResponse = await app.request('/api/me')
            expect(meResponse.status).toBe(200)
            expect(await meResponse.json()).toEqual({
                user: expect.objectContaining({
                    id: user.id,
                    username: 'dev',
                    accessToken: 'hapi_user_dev'
                })
            })

            const regenerateResponse = await app.request('/api/me/token/regenerate', { method: 'POST' })
            expect(regenerateResponse.status).toBe(200)
            const regenerated = await regenerateResponse.json() as { accessToken: string }
            expect(regenerated.accessToken).toMatch(/^hapi_user_/)
            expect(regenerated.accessToken).not.toBe('hapi_user_dev')
            expect(store.users.getUserByAccessToken(regenerated.accessToken)?.id).toBe(user.id)
        } finally {
            store.close()
        }
    })

    it('does not expose token regeneration from the user management API', async () => {
        const store = new Store(':memory:')
        try {
            const admin = store.users.createLocalUser({
                namespace: 'default',
                username: 'admin',
                passwordHash: 'hash-admin',
                accessToken: 'hapi_user_admin',
                role: 'admin'
            })
            const user = store.users.createLocalUser({
                namespace: 'default',
                username: 'dev',
                passwordHash: 'hash-dev',
                accessToken: 'hapi_user_dev',
                role: 'user'
            })
            const app = createApp(store, admin.id)

            const response = await app.request(`/api/users/${user.id}/token/regenerate`, { method: 'POST' })

            expect(response.status).toBe(404)
            expect(store.users.getUserByAccessToken('hapi_user_dev')?.id).toBe(user.id)
        } finally {
            store.close()
        }
    })

    it('does not treat a local user as owner when their row id collides with the owner id', async () => {
        const store = new Store(':memory:')
        try {
            const user = store.users.createLocalUser({
                namespace: 'default',
                username: 'admin',
                passwordHash: 'hash-admin',
                accessToken: 'hapi_user_admin',
                role: 'admin'
            })
            const app = createApp(store, user.id, 'default', {
                ownerId: user.id,
                authPlatform: 'local'
            })

            const response = await app.request('/api/me')

            expect(response.status).toBe(200)
            expect(await response.json()).toEqual({
                user: expect.objectContaining({
                    id: user.id,
                    platform: 'local',
                    username: 'admin',
                    accessToken: 'hapi_user_admin'
                })
            })
        } finally {
            store.close()
        }
    })

    it('lets a local user change their own username', async () => {
        const store = new Store(':memory:')
        try {
            const user = store.users.createLocalUser({
                namespace: 'default',
                username: 'dev',
                passwordHash: 'hash',
                accessToken: 'hapi_user_dev',
                role: 'user'
            })
            const app = createApp(store, user.id)

            const response = await app.request('/api/me/username', {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username: 'admin' })
            })

            expect(response.status).toBe(200)
            expect(await response.json()).toEqual({
                user: expect.objectContaining({
                    id: user.id,
                    username: 'admin',
                    platformUserId: 'default:admin'
                })
            })
        } finally {
            store.close()
        }
    })

    it('rejects duplicate username changes', async () => {
        const store = new Store(':memory:')
        try {
            const user = store.users.createLocalUser({
                namespace: 'default',
                username: 'dev',
                passwordHash: 'hash-dev',
                role: 'user'
            })
            store.users.createLocalUser({
                namespace: 'default',
                username: 'admin',
                passwordHash: 'hash-admin',
                role: 'admin'
            })
            const app = createApp(store, user.id)

            const response = await app.request('/api/me/username', {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username: 'ADMIN' })
            })

            expect(response.status).toBe(409)
            expect(store.users.getUserById(user.id, 'default')?.username).toBe('dev')
        } finally {
            store.close()
        }
    })

    it('lets administrators delete local users', async () => {
        const store = new Store(':memory:')
        try {
            const admin = store.users.createLocalUser({
                namespace: 'default',
                username: 'admin',
                passwordHash: 'hash-admin',
                role: 'admin'
            })
            const user = store.users.createLocalUser({
                namespace: 'default',
                username: 'dev',
                passwordHash: 'hash-dev',
                accessToken: 'hapi_user_dev'
            })
            const app = createApp(store, admin.id)

            const response = await app.request(`/api/users/${user.id}`, { method: 'DELETE' })

            expect(response.status).toBe(200)
            expect(await response.json()).toEqual({ ok: true })
            expect(store.users.getUserById(user.id, 'default')).toBeNull()
            expect(store.users.getUserByAccessToken('hapi_user_dev')).toBeNull()
        } finally {
            store.close()
        }
    })

    it('lets the owner delete a local user whose row id collides with the owner id', async () => {
        const store = new Store(':memory:')
        try {
            const user = store.users.createLocalUser({
                namespace: 'default',
                username: 'dev',
                passwordHash: 'hash-dev',
                accessToken: 'hapi_user_dev'
            })
            const app = createApp(store, user.id, 'default', {
                ownerId: user.id,
                authPlatform: 'owner'
            })

            const response = await app.request(`/api/users/${user.id}`, { method: 'DELETE' })

            expect(response.status).toBe(200)
            expect(store.users.getUserById(user.id, 'default')).toBeNull()
        } finally {
            store.close()
        }
    })

    it('rejects non-admin local user deletion', async () => {
        const store = new Store(':memory:')
        try {
            const actor = store.users.createLocalUser({
                namespace: 'default',
                username: 'actor',
                passwordHash: 'hash-actor',
                role: 'user'
            })
            const target = store.users.createLocalUser({
                namespace: 'default',
                username: 'target',
                passwordHash: 'hash-target'
            })
            const app = createApp(store, actor.id)

            const response = await app.request(`/api/users/${target.id}`, { method: 'DELETE' })

            expect(response.status).toBe(403)
            expect(store.users.getUserById(target.id, 'default')?.username).toBe('target')
        } finally {
            store.close()
        }
    })

    it('rejects deleting the current administrator account', async () => {
        const store = new Store(':memory:')
        try {
            const admin = store.users.createLocalUser({
                namespace: 'default',
                username: 'admin',
                passwordHash: 'hash-admin',
                role: 'admin'
            })
            const app = createApp(store, admin.id)

            const response = await app.request(`/api/users/${admin.id}`, { method: 'DELETE' })

            expect(response.status).toBe(400)
            expect(store.users.getUserById(admin.id, 'default')?.username).toBe('admin')
        } finally {
            store.close()
        }
    })

    it('rejects deleting the hub owner pseudo-account', async () => {
        const store = new Store(':memory:')
        try {
            const app = createApp(store, OWNER_ID)

            const response = await app.request(`/api/users/${OWNER_ID}`, { method: 'DELETE' })

            expect(response.status).toBe(400)
        } finally {
            store.close()
        }
    })

    it('rejects deleting non-local bound users', async () => {
        const store = new Store(':memory:')
        try {
            const admin = store.users.createLocalUser({
                namespace: 'default',
                username: 'admin',
                passwordHash: 'hash-admin',
                role: 'admin'
            })
            const telegramUser = store.users.addUser('telegram', 'telegram-1', 'default')
            const app = createApp(store, admin.id)

            const response = await app.request(`/api/users/${telegramUser.id}`, { method: 'DELETE' })

            expect(response.status).toBe(400)
            expect(store.users.getUserById(telegramUser.id, 'default')?.platform).toBe('telegram')
        } finally {
            store.close()
        }
    })
})
