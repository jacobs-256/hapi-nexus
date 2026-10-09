import { describe, expect, it } from 'bun:test'

import { Store } from './index'

describe('UserStore local accounts', () => {
    it('creates local users with namespace-scoped emails and token lookup', () => {
        const store = new Store(':memory:')
        try {
            const alice = store.users.createLocalUser({
                namespace: 'default',
                email: 'Alice@hapi.local',
                passwordHash: 'hash-1',
                displayName: 'Alice A',
                role: 'admin',
                accessToken: 'hapi_user_alice'
            })
            const otherAlice = store.users.createLocalUser({
                namespace: 'tenant',
                email: 'alice@hapi.local',
                passwordHash: 'hash-2',
                accessToken: 'hapi_user_tenant_alice'
            })

            expect(alice.emailNormalized).toBe('alice@hapi.local')
            expect(alice.platformUserId).toBe('default:alice@hapi.local')
            expect(otherAlice.platformUserId).toBe('tenant:alice@hapi.local')
            expect(store.users.getLocalUserByEmail('default', 'ALICE@hapi.local')?.id).toBe(alice.id)
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
                email: 'dev@hapi.local',
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

    it('updates local emails while preserving namespace uniqueness', () => {
        const store = new Store(':memory:')
        try {
            const user = store.users.createLocalUser({
                namespace: 'default',
                email: 'dev@hapi.local',
                passwordHash: 'hash-dev'
            })
            const other = store.users.createLocalUser({
                namespace: 'default',
                email: 'ops@hapi.local',
                passwordHash: 'hash-ops'
            })

            const renamed = store.users.updateLocalEmail(user.id, 'default', 'Admin@hapi.local')
            expect(renamed.status).toBe('updated')
            if (renamed.status !== 'updated') return
            expect(renamed.user.email).toBe('Admin@hapi.local')
            expect(renamed.user.emailNormalized).toBe('admin@hapi.local')
            expect(renamed.user.platformUserId).toBe('default:admin@hapi.local')
            expect(store.users.getLocalUserByEmail('default', 'DEV@hapi.local')).toBeNull()
            expect(store.users.getLocalUserByEmail('default', 'admin@hapi.local')?.id).toBe(user.id)

            const duplicate = store.users.updateLocalEmail(user.id, 'default', 'OPS@hapi.local')
            expect(duplicate.status).toBe('duplicate')
            if (duplicate.status !== 'duplicate') return
            expect(duplicate.existingUser.id).toBe(other.id)
        } finally {
            store.close()
        }
    })

    it('removes local users and transfers sole project ownership to the replacement owner', () => {
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
            const project = store.projects.createProject('default', 'Shared Project', user.id)
            store.projects.addProjectMember(project.id, admin.id, 'viewer')
            store.machines.getOrCreateMachine(
                'machine-1',
                { host: 'workstation', workspaceRoots: ['/srv/projects'] },
                null,
                'default',
                { ownerUserId: user.id, teamId: project.teamId }
            )

            const removed = store.users.removeLocalUserById(user.id, 'default', admin.id)

            expect(removed?.id).toBe(user.id)
            expect(store.users.getUserById(user.id, 'default')).toBeNull()
            expect(store.users.getUserByAccessToken('hapi_user_dev')).toBeNull()
            expect(store.projects.getProjectMemberRole(project.id, user.id)).toBeNull()
            expect(store.projects.getProjectMemberRole(project.id, admin.id)).toBe('owner')
            expect(store.machines.getMachineByNamespace('machine-1', 'default')?.ownerUserId).toBe(admin.id)
        } finally {
            store.close()
        }
    })
})
