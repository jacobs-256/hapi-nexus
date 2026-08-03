import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

import { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import { createUsersRoutes } from './users'

const OWNER_ID = 999

function createApp(store: Store, userId: number, namespace = 'default') {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', namespace)
        c.set('userId', userId)
        await next()
    })
    app.route('/api', createUsersRoutes(store, {
        getOwnerUserId: async () => OWNER_ID,
        getOwnerAccessToken: (ns) => ns === 'default' ? 'owner-token' : `owner-token:${ns}`
    }))
    return app
}

describe('users routes', () => {
    it('lets the owner create local users and list their access tokens', async () => {
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
            const created = await createResponse.json() as { user: { id: number; accessToken: string; role: string } }
            expect(created.user.accessToken).toMatch(/^hapi_user_/)
            expect(created.user.role).toBe('admin')

            const listResponse = await app.request('/api/users')
            expect(listResponse.status).toBe(200)
            const body = await listResponse.json() as { users: Array<{ platform: string; username: string | null; accessToken: string | null }> }
            expect(body.users).toEqual([
                expect.objectContaining({ platform: 'owner', accessToken: 'owner-token' }),
                expect.objectContaining({ platform: 'local', username: 'alice', accessToken: created.user.accessToken })
            ])
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
})
