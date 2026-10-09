import { describe, expect, it } from 'bun:test'
import { jwtVerify } from 'jose'

import { Store } from '../../store'
import { createAuthRoutes } from './auth'

const JWT_SECRET = new TextEncoder().encode('test-secret-test-secret-test-secret')

describe('auth routes local accounts', () => {
    it('signs in with email and password and returns the personal access token', async () => {
        const store = new Store(':memory:')
        try {
            const passwordHash = Bun.password.hashSync('correct-password', { algorithm: 'argon2id' })
            const user = store.users.createLocalUser({
                namespace: 'default',
                email: 'alice@hapi.local',
                passwordHash,
                displayName: 'Alice',
                role: 'admin',
                accessToken: 'hapi_user_alice'
            })
            const app = createAuthRoutes(JWT_SECRET, store)

            const response = await app.request('/auth', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'Alice@hapi.local', password: 'correct-password' })
            })

            expect(response.status).toBe(200)
            const body = await response.json() as { token: string; user: { id: number; role: string; accessToken: string } }
            expect(body.user).toEqual(expect.objectContaining({
                id: user.id,
                email: 'alice@hapi.local',
                role: 'admin',
                accessToken: 'hapi_user_alice'
            }))
            const verified = await jwtVerify(body.token, JWT_SECRET, { algorithms: ['HS256'] })
            expect(verified.payload).toEqual(expect.objectContaining({ uid: user.id, ns: 'default', plt: 'local' }))
        } finally {
            store.close()
        }
    })

    it('rejects invalid local passwords', async () => {
        const store = new Store(':memory:')
        try {
            store.users.createLocalUser({
                namespace: 'default',
                email: 'alice@hapi.local',
                passwordHash: Bun.password.hashSync('correct-password', { algorithm: 'argon2id' }),
                accessToken: 'hapi_user_alice'
            })
            const app = createAuthRoutes(JWT_SECRET, store)

            const response = await app.request('/auth', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'alice@hapi.local', password: 'wrong-password' })
            })

            expect(response.status).toBe(401)
        } finally {
            store.close()
        }
    })

    it('accepts legacy username payloads and rejects disabled email accounts', async () => {
        const store = new Store(':memory:')
        try {
            const user = store.users.createLocalUser({
                namespace: 'default', email: 'alice@hapi.local', passwordHash: Bun.password.hashSync('password')
            })
            const app = createAuthRoutes(JWT_SECRET, store)
            const legacyResponse = await app.request('/auth', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username: 'alice', password: 'password' })
            })
            expect(legacyResponse.status).toBe(200)
            expect(await legacyResponse.json()).toMatchObject({ user: { id: user.id, email: 'alice@hapi.local' } })
            store.users.updateUser(user.id, 'default', { disabledAt: Date.now() })
            const disabledResponse = await app.request('/auth', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'alice@hapi.local', password: 'password' })
            })
            expect(disabledResponse.status).toBe(401)
        } finally {
            store.close()
        }
    })
})
