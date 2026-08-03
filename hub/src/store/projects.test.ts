import { describe, expect, it } from 'bun:test'

import { Store } from './index'

describe('ProjectStore invites', () => {
    it('lets one invite link add multiple users without downgrading existing roles', () => {
        const store = new Store(':memory:')
        try {
            const project = store.projects.createProject('default', 'Shared', 1)
            store.projects.addProjectMember(project.id, 2, 'admin')
            const { token } = store.projects.createProjectInvite(
                project.id,
                'viewer',
                Date.now() + 60_000,
                1
            )

            expect(store.projects.acceptProjectInvite(token, 2, 'default')).toEqual({
                ok: true,
                projectId: project.id,
                role: 'admin'
            })
            expect(store.projects.acceptProjectInvite(token, 3, 'default')).toEqual({
                ok: true,
                projectId: project.id,
                role: 'viewer'
            })
            expect(store.projects.acceptProjectInvite(token, 4, 'default')).toEqual({
                ok: true,
                projectId: project.id,
                role: 'viewer'
            })

            const roles = new Map(
                store.projects.listProjectMembers(project.id).map((member) => [member.userId, member.role])
            )
            expect(roles.get(2)).toBe('admin')
            expect(roles.get(3)).toBe('viewer')
            expect(roles.get(4)).toBe('viewer')
        } finally {
            store.close()
        }
    })

    it('rejects expired and cross-namespace invite accepts', () => {
        const store = new Store(':memory:')
        try {
            const project = store.projects.createProject('default', 'Shared', 1)
            const { token } = store.projects.createProjectInvite(project.id, 'editor', 100, 1)

            expect(store.projects.acceptProjectInvite(token, 2, 'other', 101)).toEqual({
                ok: false,
                reason: 'not-found'
            })
            expect(store.projects.acceptProjectInvite(token, 2, 'default', 101)).toEqual({
                ok: false,
                reason: 'expired'
            })
        } finally {
            store.close()
        }
    })
})
