import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { Store } from '../store'
import { ensureInitialLocalAdmin } from './initialAdmin'

describe('initial local admin bootstrap', () => {
    let originalAdminEmail: string | undefined
    let originalAdminPassword: string | undefined

    beforeEach(() => {
        originalAdminEmail = process.env.HAPI_ADMIN_EMAIL
        originalAdminPassword = process.env.HAPI_ADMIN_PASSWORD
        delete process.env.HAPI_ADMIN_EMAIL
        delete process.env.HAPI_ADMIN_PASSWORD
    })

    afterEach(() => {
        if (originalAdminEmail === undefined) {
            delete process.env.HAPI_ADMIN_EMAIL
        } else {
            process.env.HAPI_ADMIN_EMAIL = originalAdminEmail
        }
        if (originalAdminPassword === undefined) {
            delete process.env.HAPI_ADMIN_PASSWORD
        } else {
            process.env.HAPI_ADMIN_PASSWORD = originalAdminPassword
        }
    })

    it('creates admin@hapi.local/admin when no local admin exists', async () => {
        const store = new Store(':memory:')
        try {
            const result = await ensureInitialLocalAdmin(store)

            expect(result.status).toBe('created')
            if (result.status !== 'created') return
            expect(result.email).toBe('admin@hapi.local')
            expect(result.passwordSource).toBe('default')
            expect(result.password).toBe('admin')
            expect(result.user.role).toBe('admin')
            expect(await Bun.password.verify('admin', result.user.passwordHash ?? '')).toBe(true)
        } finally {
            store.close()
        }
    })

    it('keeps environment overrides for private deployments', async () => {
        const store = new Store(':memory:')
        try {
            const result = await ensureInitialLocalAdmin(store, {
                email: 'root@hapi.local',
                password: 'configured-secret'
            })

            expect(result.status).toBe('created')
            if (result.status !== 'created') return
            expect(result.email).toBe('root@hapi.local')
            expect(result.passwordSource).toBe('environment')
            expect(result.password).toBe('configured-secret')
            expect(await Bun.password.verify('configured-secret', result.user.passwordHash ?? '')).toBe(true)
        } finally {
            store.close()
        }
    })

    it('does not create another admin when one already exists', async () => {
        const store = new Store(':memory:')
        try {
            const existing = store.users.createLocalUser({
                namespace: 'default',
                email: 'ops@hapi.local',
                passwordHash: 'hash',
                role: 'admin'
            })

            const result = await ensureInitialLocalAdmin(store)

            expect(result).toEqual({ status: 'exists', user: existing })
            expect(store.users.listUsersByNamespace('default')).toHaveLength(1)
        } finally {
            store.close()
        }
    })
})
