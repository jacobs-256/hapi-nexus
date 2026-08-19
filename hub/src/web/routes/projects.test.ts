import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

import { Store } from '../../store'
import type { Machine, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createProjectsRoutes } from './projects'

function createMachine(store: Store, overrides?: Partial<Machine>): Machine {
    const machine: Machine = {
        id: 'machine-1',
        namespace: 'default',
        ownerUserId: 1,
        teamId: 'default-team:default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: {
            host: 'workstation',
            platform: 'darwin',
            happyCliVersion: '1.0.0',
            workspaceRoots: ['/srv/projects']
        },
        metadataVersion: 1,
        runnerState: null,
        runnerStateVersion: 1,
        ...overrides
    }
    store.machines.getOrCreateMachine(
        machine.id,
        machine.metadata,
        machine.runnerState,
        machine.namespace,
        { ownerUserId: machine.ownerUserId, teamId: machine.teamId }
    )
    return machine
}

function createApp(store: Store, userId: number, machines: Machine[]) {
    const machinesById = new Map(machines.map((machine) => [machine.id, machine]))
    const engine = {
        resolveMachineAccessForUser: async (machineId: string, namespace: string, actorUserId: number) => {
            const machine = machinesById.get(machineId)
            if (!machine) return { ok: false as const, reason: 'not-found' as const }
            if (machine.namespace !== namespace || machine.ownerUserId !== actorUserId) {
                return { ok: false as const, reason: 'access-denied' as const }
            }
            return { ok: true as const, machine }
        },
        getSessionsByNamespace: (namespace: string) => store.sessions.getSessionsByNamespace(namespace) as unknown[],
        assignSessionProject: (sessionId: string, namespace: string, projectId: string, createdByUserId: number) =>
            store.sessions.assignSessionProject(sessionId, namespace, projectId, createdByUserId),
        addProjectWorkspace: (projectId: string, machineId: string, rootPath: string, createdByUserId: number) =>
            store.projects.addProjectWorkspace(projectId, machineId, rootPath, createdByUserId)
    } as Partial<SyncEngine>
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        c.set('userId', userId)
        await next()
    })
    app.route('/api', createProjectsRoutes(store, () => engine as SyncEngine, {
        getOwnerUserId: async () => 1
    }))
    return app
}

describe('projects routes', () => {
    it('creates a project with an owned workspace', async () => {
        const store = new Store(':memory:')
        try {
            const machine = createMachine(store)
            const app = createApp(store, 1, [machine])

            const response = await app.request('/api/projects', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    name: 'Shared Project',
                    machineId: machine.id,
                    rootPath: '/srv/projects/app'
                })
            })

            expect(response.status).toBe(201)
            const body = await response.json() as { project: { workspaces: Array<{ rootPath: string }> } }
            expect(body.project.workspaces).toEqual([
                expect.objectContaining({ rootPath: '/srv/projects/app' })
            ])
        } finally {
            store.close()
        }
    })

    it('accepts Windows workspace paths case-insensitively', async () => {
        const store = new Store(':memory:')
        try {
            const machine = createMachine(store, {
                metadata: {
                    host: 'winbox',
                    platform: 'win32',
                    happyCliVersion: '1.0.0',
                    workspaceRoots: ['C:\\Projects']
                }
            })
            const app = createApp(store, 1, [machine])

            const response = await app.request('/api/projects', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    name: 'Windows Project',
                    machineId: machine.id,
                    rootPath: 'c:\\projects\\app'
                })
            })

            expect(response.status).toBe(201)
            const body = await response.json() as { project: { workspaces: Array<{ rootPath: string }> } }
            expect(body.project.workspaces).toEqual([
                expect.objectContaining({ rootPath: 'c:\\projects\\app' })
            ])
        } finally {
            store.close()
        }
    })

    it('does not leave a project behind when initial workspace access is denied', async () => {
        const store = new Store(':memory:')
        try {
            const machine = createMachine(store, { ownerUserId: 1 })
            const app = createApp(store, 2, [machine])

            const response = await app.request('/api/projects', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    name: 'Denied Project',
                    machineId: machine.id,
                    rootPath: '/srv/projects/app'
                })
            })

            expect(response.status).toBe(403)
            expect(store.projects.listProjectsForUser('default', 2)).toHaveLength(0)
        } finally {
            store.close()
        }
    })

    it('requires machine ownership before adding a workspace to a project', async () => {
        const store = new Store(':memory:')
        try {
            const machine = createMachine(store, { ownerUserId: 1 })
            const project = store.projects.createProject('default', 'Shared Project', 1)
            store.projects.addProjectMember(project.id, 2, 'admin')
            const app = createApp(store, 2, [machine])

            const response = await app.request(`/api/projects/${project.id}/workspaces`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    machineId: machine.id,
                    rootPath: '/srv/projects/app'
                })
            })

            expect(response.status).toBe(403)
            expect(store.projects.listProjectWorkspaces(project.id)).toHaveLength(0)
        } finally {
            store.close()
        }
    })

    it('removes project workspaces', async () => {
        const store = new Store(':memory:')
        try {
            const machine = createMachine(store)
            const project = store.projects.createProject('default', 'Shared Project', 1)
            const workspace = store.projects.addProjectWorkspace(project.id, machine.id, '/srv/projects/app', 1)
            const app = createApp(store, 1, [machine])

            const response = await app.request(`/api/projects/${project.id}/workspaces/${workspace.id}`, {
                method: 'DELETE'
            })

            expect(response.status).toBe(200)
            expect(store.projects.listProjectWorkspaces(project.id)).toHaveLength(0)

            const missing = await app.request(`/api/projects/${project.id}/workspaces/${workspace.id}`, {
                method: 'DELETE'
            })
            expect(missing.status).toBe(404)
        } finally {
            store.close()
        }
    })

    it('moves a workspace between projects when the actor can administer both', async () => {
        const store = new Store(':memory:')
        try {
            const machine = createMachine(store)
            const sourceProject = store.projects.createProject('default', 'Source Project', 1)
            const targetProject = store.projects.createProject('default', 'Target Project', 1)
            const workspace = store.projects.addProjectWorkspace(sourceProject.id, machine.id, '/srv/projects/app', 1)
            const session = store.sessions.getOrCreateSession(
                'session-tag',
                { path: '/srv/projects/app/src', host: 'workstation', machineId: machine.id },
                null,
                'default',
                undefined,
                undefined,
                undefined,
                undefined,
                { projectId: sourceProject.id, createdByUserId: 1 }
            )
            const app = createApp(store, 1, [machine])

            const response = await app.request(`/api/projects/${sourceProject.id}/workspaces/${workspace.id}/move`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ targetProjectId: targetProject.id })
            })

            expect(response.status).toBe(200)
            const body = await response.json() as { workspace: { projectId: string; machineId: string; rootPath: string } }
            expect(body.workspace).toEqual(expect.objectContaining({
                projectId: targetProject.id,
                machineId: machine.id,
                rootPath: '/srv/projects/app'
            }))
            expect(store.projects.listProjectWorkspaces(sourceProject.id)).toHaveLength(0)
            expect(store.projects.listProjectWorkspaces(targetProject.id)).toEqual([
                expect.objectContaining({ rootPath: '/srv/projects/app' })
            ])
            expect(store.sessions.getSession(session.id)?.projectId).toBe(targetProject.id)
        } finally {
            store.close()
        }
    })

    it('moves a directory between projects even when neither project has a workspace yet', async () => {
        const store = new Store(':memory:')
        try {
            const machine = createMachine(store)
            const sourceProject = store.projects.createProject('default', 'Source Project', 1)
            const targetProject = store.projects.createProject('default', 'Target Project', 1)
            const session = store.sessions.getOrCreateSession(
                'session-tag',
                { path: '/srv/projects/app', host: 'workstation', machineId: machine.id },
                null,
                'default',
                undefined,
                undefined,
                undefined,
                undefined,
                { projectId: sourceProject.id, createdByUserId: 1 }
            )
            const app = createApp(store, 1, [machine])

            const response = await app.request(`/api/projects/${sourceProject.id}/directories/move`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    targetProjectId: targetProject.id,
                    machineId: machine.id,
                    rootPath: '/srv/projects/app'
                })
            })

            expect(response.status).toBe(200)
            const body = await response.json() as { workspace: { projectId: string; machineId: string; rootPath: string } }
            expect(body.workspace).toEqual(expect.objectContaining({
                projectId: targetProject.id,
                machineId: machine.id,
                rootPath: '/srv/projects/app'
            }))
            expect(store.projects.listProjectWorkspaces(sourceProject.id)).toHaveLength(0)
            expect(store.projects.listProjectWorkspaces(targetProject.id)).toEqual([
                expect.objectContaining({ rootPath: '/srv/projects/app' })
            ])
            expect(store.sessions.getSession(session.id)?.projectId).toBe(targetProject.id)
        } finally {
            store.close()
        }
    })

    it('does not move a workspace into a project the actor cannot administer', async () => {
        const store = new Store(':memory:')
        try {
            const machine = createMachine(store)
            const sourceProject = store.projects.createProject('default', 'Source Project', 1)
            const targetProject = store.projects.createProject('default', 'Target Project', 2)
            store.projects.addProjectMember(sourceProject.id, 2, 'admin')
            store.projects.addProjectMember(targetProject.id, 1, 'viewer')
            const workspace = store.projects.addProjectWorkspace(sourceProject.id, machine.id, '/srv/projects/app', 1)
            const app = createApp(store, 1, [machine])

            const response = await app.request(`/api/projects/${sourceProject.id}/workspaces/${workspace.id}/move`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ targetProjectId: targetProject.id })
            })

            expect(response.status).toBe(403)
            expect(store.projects.listProjectWorkspaces(sourceProject.id)).toHaveLength(1)
            expect(store.projects.listProjectWorkspaces(targetProject.id)).toHaveLength(0)
        } finally {
            store.close()
        }
    })

    it('rejects direct member grants for unknown users', async () => {
        const store = new Store(':memory:')
        try {
            const project = store.projects.createProject('default', 'Shared Project', 1)
            const app = createApp(store, 1, [])

            const response = await app.request(`/api/projects/${project.id}/members`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ userId: 999, role: 'viewer' })
            })

            expect(response.status).toBe(404)
            expect(store.projects.getProjectMemberRole(project.id, 999)).toBeNull()
        } finally {
            store.close()
        }
    })

    it('allows direct member grants for bound users in the same namespace', async () => {
        const store = new Store(':memory:')
        try {
            const member = store.users.addUser('telegram', 'telegram-2', 'default')
            const project = store.projects.createProject('default', 'Shared Project', 10)
            const app = createApp(store, 10, [])

            const response = await app.request(`/api/projects/${project.id}/members`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ userId: member.id, role: 'editor' })
            })

            expect(response.status).toBe(200)
            expect(store.projects.getProjectMemberRole(project.id, member.id)).toBe('editor')
        } finally {
            store.close()
        }
    })

    it('lists project member candidates for project admins without access tokens', async () => {
        const store = new Store(':memory:')
        try {
            const admin = store.users.createLocalUser({
                namespace: 'default',
                username: 'admin-user',
                passwordHash: 'hash',
                displayName: 'Admin User',
                role: 'user'
            })
            const candidate = store.users.createLocalUser({
                namespace: 'default',
                username: 'candidate',
                passwordHash: 'hash',
                displayName: 'Candidate User',
                role: 'user'
            })
            const otherNamespace = store.users.createLocalUser({
                namespace: 'other',
                username: 'outside',
                passwordHash: 'hash',
                displayName: 'Outside User',
                role: 'user'
            })
            const project = store.projects.createProject('default', 'Shared Project', 1)
            store.projects.addProjectMember(project.id, admin.id, 'admin')
            const app = createApp(store, admin.id, [])

            const response = await app.request(`/api/projects/${project.id}/member-candidates`)

            expect(response.status).toBe(200)
            const body = await response.json() as {
                users: Array<{ id: number; username: string | null; accessToken?: string | null }>
            }
            expect(body.users.map((user) => user.id)).toContain(1)
            expect(body.users.map((user) => user.id)).toContain(candidate.id)
            expect(body.users.map((user) => user.id)).toContain(admin.id)
            expect(body.users.map((user) => user.id)).not.toContain(otherNamespace.id)
            expect(body.users.some((user) => 'accessToken' in user)).toBe(false)
        } finally {
            store.close()
        }
    })

    it('keeps at least one owner on each project', async () => {
        const store = new Store(':memory:')
        try {
            const project = store.projects.createProject('default', 'Shared Project', 1)
            const app = createApp(store, 1, [])

            const demote = await app.request(`/api/projects/${project.id}/members`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ userId: 1, role: 'admin' })
            })
            expect(demote.status).toBe(400)

            const remove = await app.request(`/api/projects/${project.id}/members/1`, {
                method: 'DELETE'
            })
            expect(remove.status).toBe(400)
            expect(store.projects.countProjectOwners(project.id)).toBe(1)
        } finally {
            store.close()
        }
    })
})
