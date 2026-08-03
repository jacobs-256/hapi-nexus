import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { Store } from '../store'
import { ensureInitialLocalAdmin } from './initialAdmin'

describe('initial local admin bootstrap', () => {
    let originalAdminUsername: string | undefined
    let originalAdminPassword: string | undefined

    beforeEach(() => {
        originalAdminUsername = process.env.HAPI_ADMIN_USERNAME
        originalAdminPassword = process.env.HAPI_ADMIN_PASSWORD
        delete process.env.HAPI_ADMIN_USERNAME
        delete process.env.HAPI_ADMIN_PASSWORD
    })

    afterEach(() => {
        if (originalAdminUsername === undefined) {
            delete process.env.HAPI_ADMIN_USERNAME
        } else {
            process.env.HAPI_ADMIN_USERNAME = originalAdminUsername
        }
        if (originalAdminPassword === undefined) {
            delete process.env.HAPI_ADMIN_PASSWORD
        } else {
            process.env.HAPI_ADMIN_PASSWORD = originalAdminPassword
        }
    })

    it('creates admin/admin when no local admin exists', async () => {
        const store = new Store(':memory:')
        try {
            const result = await ensureInitialLocalAdmin(store)

            expect(result.status).toBe('created')
            if (result.status !== 'created') return
            expect(result.username).toBe('admin')
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
                username: 'root',
                password: 'configured-secret'
            })

            expect(result.status).toBe('created')
            if (result.status !== 'created') return
            expect(result.username).toBe('root')
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
                username: 'ops',
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
