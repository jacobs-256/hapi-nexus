import { describe, expect, it } from 'bun:test'

import { Store } from './index'

describe('UserStore local accounts', () => {
    it('creates local users with namespace-scoped usernames and token lookup', () => {
        const store = new Store(':memory:')
        try {
            const alice = store.users.createLocalUser({
                namespace: 'default',
                username: 'Alice',
                passwordHash: 'hash-1',
                displayName: 'Alice A',
                role: 'admin',
                accessToken: 'hapi_user_alice'
            })
            const otherAlice = store.users.createLocalUser({
                namespace: 'tenant',
                username: 'alice',
                passwordHash: 'hash-2',
                accessToken: 'hapi_user_tenant_alice'
            })

            expect(alice.usernameNormalized).toBe('alice')
            expect(alice.platformUserId).toBe('default:alice')
            expect(otherAlice.platformUserId).toBe('tenant:alice')
            expect(store.users.getLocalUserByUsername('default', 'ALICE')?.id).toBe(alice.id)
            expect(store.users.getUserByAccessToken('hapi_user_alice')?.id).toBe(alice.id)
            expect(store.users.getUserByAccessToken(' hapi_user_tenant_alice ')?.id).toBe(otherAlice.id)
        } finally {
            store.close()
        }
    })

    it('updates local account status, password hash, and access token', () => {
        const store = new Store(':memory:')
        try {
            const user = store.users.createLocalUser({
                namespace: 'default',
                username: 'dev',
                passwordHash: 'old-hash',
                accessToken: 'hapi_user_old'
            })

            const disabled = store.users.updateUser(user.id, 'default', {
                displayName: 'Developer',
                role: 'admin',
                disabledAt: 123
            })
            expect(disabled).toEqual(expect.objectContaining({
                displayName: 'Developer',
                role: 'admin',
                disabledAt: 123
            }))

            expect(store.users.updateUserPassword(user.id, 'default', 'new-hash')?.passwordHash).toBe('new-hash')
            const regenerated = store.users.regenerateUserAccessToken(user.id, 'default')
            expect(regenerated?.accessToken).toMatch(/^hapi_user_/)
            expect(regenerated?.accessToken).not.toBe('hapi_user_old')
            expect(store.users.getUserByAccessToken('hapi_user_old')).toBeNull()
            expect(store.users.getUserByAccessToken(regenerated?.accessToken ?? '')?.id).toBe(user.id)
        } finally {
            store.close()
        }
    })

    it('updates local usernames while preserving namespace uniqueness', () => {
        const store = new Store(':memory:')
        try {
            const user = store.users.createLocalUser({
                namespace: 'default',
                username: 'dev',
                passwordHash: 'hash-dev'
            })
            const other = store.users.createLocalUser({
                namespace: 'default',
                username: 'ops',
                passwordHash: 'hash-ops'
            })

            const renamed = store.users.updateLocalUsername(user.id, 'default', 'Admin')
            expect(renamed.status).toBe('updated')
            if (renamed.status !== 'updated') return
            expect(renamed.user.username).toBe('Admin')
            expect(renamed.user.usernameNormalized).toBe('admin')
            expect(renamed.user.platformUserId).toBe('default:admin')
            expect(store.users.getLocalUserByUsername('default', 'DEV')).toBeNull()
            expect(store.users.getLocalUserByUsername('default', 'admin')?.id).toBe(user.id)

            const duplicate = store.users.updateLocalUsername(user.id, 'default', 'OPS')
            expect(duplicate.status).toBe('duplicate')
            if (duplicate.status !== 'duplicate') return
            expect(duplicate.existingUser.id).toBe(other.id)
        } finally {
            store.close()
        }
    })
})
