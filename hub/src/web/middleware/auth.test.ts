import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import * as ownerId from '../../config/ownerId'
import { Store } from '../../store'
import { createAuthMiddleware, type WebAppEnv } from './auth'

const secret = new TextEncoder().encode('auth-middleware-test-secret')

describe('auth middleware infrastructure errors', () => {
    afterEach(() => {
        ownerSpy?.mockRestore()
        ownerSpy = undefined
    })

    let ownerSpy: ReturnType<typeof spyOn<typeof ownerId, 'getOrCreateOwnerId'>> | undefined

    it('preserves server errors when the account database is unavailable', async () => {
        ownerSpy = spyOn(ownerId, 'getOrCreateOwnerId').mockResolvedValue(999)
        const store = new Store(':memory:')
        const cause = new Error('Too many connections')
        spyOn(store.users, 'getUserById').mockImplementation(() => { throw cause })
        const app = new Hono<WebAppEnv>()
        app.onError((error, c) => c.json({ error: error.message }, 500))
        app.use('*', createAuthMiddleware(secret, store))
        app.get('/api/account', (c) => c.json({ ok: true }))
        try {
            const token = await new SignJWT({ uid: 1, ns: 'default', plt: 'local' })
                .setProtectedHeader({ alg: 'HS256' })
                .setExpirationTime('1h')
                .sign(secret)
            const response = await app.request('/api/account', {
                headers: { authorization: `Bearer ${token}` }
            })
            expect(response.status).toBe(500)
            expect(await response.json()).toEqual({ error: cause.message })
        } finally {
            store.close()
        }
    })

    it('still rejects invalid JWTs with 401', async () => {
        const app = new Hono<WebAppEnv>()
        app.use('*', createAuthMiddleware(secret))
        app.get('/api/account', (c) => c.json({ ok: true }))
        const response = await app.request('/api/account', {
            headers: { authorization: 'Bearer invalid' }
        })
        expect(response.status).toBe(401)
    })
})
