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
    it('validates emails for creation and changes and rejects case-insensitive duplicates', async () => {
        const store = new Store(':memory:')
        try {
            const admin = store.users.createLocalUser({
                namespace: 'default', email: 'admin@example.com', passwordHash: 'hash', role: 'admin'
            })
            const app = createApp(store, admin.id)
            for (const email of ['alice', 'alice@', 'a b@example.com', 'alice@example.com@hapi.local']) {
                const create = await app.request('/api/users', {
                    method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ email, password: 'correct-password' })
                })
                expect(create.status).toBe(400)
                const change = await app.request('/api/me/email', {
                    method: 'PATCH', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ email })
                })
                expect(change.status).toBe(400)
            }
            const create = await app.request('/api/users', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: ' Alice@Example.COM ', password: 'correct-password' })
            })
            expect(create.status).toBe(201)
            expect(await create.json()).toMatchObject({ user: { email: 'Alice@Example.COM' } })
            const duplicate = await app.request('/api/users', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'alice@example.com', password: 'correct-password' })
            })
            expect(duplicate.status).toBe(409)
            expect(store.users.getUserById(admin.id, 'default')?.email).toBe('admin@example.com')
            expect(store.users.listUsersByNamespace('default')).toHaveLength(2)
        } finally {
            store.close()
        }
    })

    it('lets the owner create local users without listing other users access tokens', async () => {
        const store = new Store(':memory:')
        try {
            const app = createApp(store, OWNER_ID)

            const createResponse = await app.request('/api/users', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    email: 'alice@hapi.local',
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
            const body = await listResponse.json() as { users: Array<{ platform: string; email: string | null; accessToken?: string | null }> }
            const owner = body.users.find((user) => user.platform === 'owner')
            const alice = body.users.find((user) => user.platform === 'local' && user.email === 'alice@hapi.local')
            expect(owner).toEqual(expect.objectContaining({ platform: 'owner', accessToken: 'owner-token' }))
            expect(alice).toEqual(expect.objectContaining({ platform: 'local', email: 'alice@hapi.local' }))
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
                email: 'admin@hapi.local',
                passwordHash: 'hash-admin',
                accessToken: 'hapi_user_admin',
                role: 'admin'
            })
            store.users.createLocalUser({
                namespace: 'default',
                email: 'dev@hapi.local',
                passwordHash: 'hash-dev',
                accessToken: 'hapi_user_dev',
                role: 'user'
            })
            const app = createApp(store, admin.id)

            const response = await app.request('/api/users')

            expect(response.status).toBe(200)
            const body = await response.json() as { users: Array<{ platform: string; email: string | null; accessToken?: string | null }> }
            const owner = body.users.find((user) => user.platform === 'owner')
            const self = body.users.find((user) => user.platform === 'local' && user.email === 'admin@hapi.local')
            const dev = body.users.find((user) => user.platform === 'local' && user.email === 'dev@hapi.local')
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
                email: 'dev@hapi.local',
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
                email: 'dev@hapi.local',
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
                    email: 'dev@hapi.local',
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
                email: 'admin@hapi.local',
                passwordHash: 'hash-admin',
                accessToken: 'hapi_user_admin',
                role: 'admin'
            })
            const user = store.users.createLocalUser({
                namespace: 'default',
                email: 'dev@hapi.local',
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
                email: 'admin@hapi.local',
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
                    email: 'admin@hapi.local',
                    accessToken: 'hapi_user_admin'
                })
            })
        } finally {
            store.close()
        }
    })

    it('lets a local user change their own email', async () => {
        const store = new Store(':memory:')
        try {
            const user = store.users.createLocalUser({
                namespace: 'default',
                email: 'dev@hapi.local',
                passwordHash: 'hash',
                accessToken: 'hapi_user_dev',
                role: 'user'
            })
            const app = createApp(store, user.id)

            const response = await app.request('/api/me/email', {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'admin@hapi.local' })
            })

            expect(response.status).toBe(200)
            expect(await response.json()).toEqual({
                user: expect.objectContaining({
                    id: user.id,
                    email: 'admin@hapi.local',
                    platformUserId: 'default:admin@hapi.local'
                })
            })
        } finally {
            store.close()
        }
    })

    it('rejects duplicate email changes', async () => {
        const store = new Store(':memory:')
        try {
            const user = store.users.createLocalUser({
                namespace: 'default',
                email: 'dev@hapi.local',
                passwordHash: 'hash-dev',
                role: 'user'
            })
            store.users.createLocalUser({
                namespace: 'default',
                email: 'admin@hapi.local',
                passwordHash: 'hash-admin',
                role: 'admin'
            })
            const app = createApp(store, user.id)

            const response = await app.request('/api/me/email', {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'ADMIN@hapi.local' })
            })

            expect(response.status).toBe(409)
            expect(store.users.getUserById(user.id, 'default')?.email).toBe('dev@hapi.local')
        } finally {
            store.close()
        }
    })

    it('lets administrators delete local users', async () => {
        const store = new Store(':memory:')
        try {
            const admin = store.users.createLocalUser({
                namespace: 'default',
                email: 'admin@hapi.local',
                passwordHash: 'hash-admin',
                role: 'admin'
            })
            const user = store.users.createLocalUser({
                namespace: 'default',
                email: 'dev@hapi.local',
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
                email: 'dev@hapi.local',
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
                email: 'actor@hapi.local',
                passwordHash: 'hash-actor',
                role: 'user'
            })
            const target = store.users.createLocalUser({
                namespace: 'default',
                email: 'target@hapi.local',
                passwordHash: 'hash-target'
            })
            const app = createApp(store, actor.id)

            const response = await app.request(`/api/users/${target.id}`, { method: 'DELETE' })

            expect(response.status).toBe(403)
            expect(store.users.getUserById(target.id, 'default')?.email).toBe('target@hapi.local')
        } finally {
            store.close()
        }
    })

    it('rejects deleting the current administrator account', async () => {
        const store = new Store(':memory:')
        try {
            const admin = store.users.createLocalUser({
                namespace: 'default',
                email: 'admin@hapi.local',
                passwordHash: 'hash-admin',
                role: 'admin'
            })
            const app = createApp(store, admin.id)

            const response = await app.request(`/api/users/${admin.id}`, { method: 'DELETE' })

            expect(response.status).toBe(400)
            expect(store.users.getUserById(admin.id, 'default')?.email).toBe('admin@hapi.local')
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
                email: 'admin@hapi.local',
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
