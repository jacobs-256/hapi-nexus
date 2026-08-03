import { Hono } from 'hono'
import {
    CreateProjectRequestSchema,
    ProjectInviteCreateRequestSchema,
    ProjectMemberUpsertRequestSchema,
    ProjectWorkspaceCreateRequestSchema,
    UpdateProjectRequestSchema
} from '@hapi/protocol'
import type { ProjectRole } from '../../store/projectStore'
import type { Store, StoredProject } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireMachine, requireSyncEngine } from './guards'
import { machineAllowsWorkspace } from './workspaceAccess'

const DEFAULT_INVITE_EXPIRES_IN_HOURS = 72

function roleCanManageMembers(role: ProjectRole | null): boolean {
    return role === 'owner' || role === 'admin'
}

function canReferenceUser(store: Store, namespace: string, actorUserId: number, targetUserId: number): boolean {
    return targetUserId === actorUserId || store.users.getUserById(targetUserId, namespace) !== null
}

function toProjectDetails(store: Store, project: StoredProject, userId: number) {
    const role = store.projects.getProjectMemberRole(project.id, userId) ?? 'viewer'
    return {
        id: project.id,
        namespace: project.namespace,
        name: project.name,
        repoUrl: project.repoUrl,
        createdByUserId: project.createdByUserId,
        createdAt: project.createdAt,
        archivedAt: project.archivedAt,
        role,
        members: store.projects.listProjectMembers(project.id),
        workspaces: store.projects.listProjectWorkspaces(project.id)
    }
}

function requireProjectRole(
    store: Store,
    namespace: string,
    userId: number,
    projectId: string,
    requiredRole: ProjectRole
): { project: StoredProject; role: ProjectRole } | Response {
    const project = store.projects.getProjectByNamespace(projectId, namespace)
    if (!project || project.archivedAt !== null) {
        return new Response(JSON.stringify({ error: 'Project not found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' }
        })
    }
    const role = store.projects.getProjectMemberRole(projectId, userId)
    if (!store.projects.hasProjectRole(projectId, userId, requiredRole)) {
        return new Response(JSON.stringify({ error: 'Project access denied' }), {
            status: 403,
            headers: { 'content-type': 'application/json' }
        })
    }
    return { project, role: role ?? 'viewer' }
}

export function createProjectsRoutes(
    store: Store,
    getSyncEngine: () => SyncEngine | null
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/projects', (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const projects = store.projects
            .listProjectsForUser(namespace, userId)
            .map((project) => toProjectDetails(store, project, userId))
        return c.json({ projects })
    })

    app.post('/projects', async (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const body = await c.req.json().catch(() => null)
        const parsed = CreateProjectRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }

        let initialWorkspace: { machineId: string; rootPath: string } | null = null
        if (parsed.data.machineId && parsed.data.rootPath) {
            const engine = requireSyncEngine(c, getSyncEngine)
            if (engine instanceof Response) {
                return engine
            }
            const machine = requireMachine(c, engine, parsed.data.machineId, { ownerOnly: true })
            if (machine instanceof Response) return machine
            if (!machineAllowsWorkspace(machine, parsed.data.rootPath)) {
                return c.json({ error: 'Workspace path is outside runner workspace roots' }, 400)
            }
            initialWorkspace = { machineId: machine.id, rootPath: parsed.data.rootPath }
        }

        let project: StoredProject
        try {
            const options = { repoUrl: parsed.data.repoUrl ?? null }
            project = initialWorkspace
                ? store.projects.createProjectWithWorkspace(namespace, parsed.data.name, userId, initialWorkspace, options)
                : store.projects.createProject(namespace, parsed.data.name, userId, options)
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to create project' }, 400)
        }

        return c.json({ project: toProjectDetails(store, project, userId) }, 201)
    })

    app.get('/projects/:id', (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const result = requireProjectRole(store, namespace, userId, c.req.param('id'), 'viewer')
        if (result instanceof Response) return result
        return c.json({ project: toProjectDetails(store, result.project, userId) })
    })

    app.patch('/projects/:id', async (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const access = requireProjectRole(store, namespace, userId, c.req.param('id'), 'admin')
        if (access instanceof Response) return access
        const body = await c.req.json().catch(() => null)
        const parsed = UpdateProjectRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }
        const project = store.projects.updateProjectName(access.project.id, namespace, parsed.data.name)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }
        return c.json({ project: toProjectDetails(store, project, userId) })
    })

    app.get('/projects/:id/members', (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const access = requireProjectRole(store, namespace, userId, c.req.param('id'), 'viewer')
        if (access instanceof Response) return access
        return c.json({ members: store.projects.listProjectMembers(access.project.id) })
    })

    app.post('/projects/:id/members', async (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const access = requireProjectRole(store, namespace, userId, c.req.param('id'), 'admin')
        if (access instanceof Response) return access
        if (!roleCanManageMembers(access.role)) {
            return c.json({ error: 'Project access denied' }, 403)
        }
        const body = await c.req.json().catch(() => null)
        const parsed = ProjectMemberUpsertRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }
        if (!canReferenceUser(store, namespace, userId, parsed.data.userId)) {
            return c.json({ error: 'User not found' }, 404)
        }
        if (parsed.data.role === 'owner' && access.role !== 'owner') {
            return c.json({ error: 'Only owners can grant owner role' }, 403)
        }
        const targetRole = store.projects.getProjectMemberRole(access.project.id, parsed.data.userId)
        if (targetRole === 'owner' && access.role !== 'owner') {
            return c.json({ error: 'Only owners can change owners' }, 403)
        }
        if (
            targetRole === 'owner'
            && parsed.data.role !== 'owner'
            && store.projects.countProjectOwners(access.project.id) <= 1
        ) {
            return c.json({ error: 'Project must keep at least one owner' }, 400)
        }
        const member = store.projects.addProjectMember(access.project.id, parsed.data.userId, parsed.data.role)
        return c.json({ member })
    })

    app.delete('/projects/:id/members/:userId', (c) => {
        const namespace = c.get('namespace')
        const actorUserId = c.get('userId')
        const access = requireProjectRole(store, namespace, actorUserId, c.req.param('id'), 'admin')
        if (access instanceof Response) return access
        const targetUserId = Number(c.req.param('userId'))
        if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
            return c.json({ error: 'Invalid user id' }, 400)
        }
        const targetRole = store.projects.getProjectMemberRole(access.project.id, targetUserId)
        if (targetRole === 'owner' && access.role !== 'owner') {
            return c.json({ error: 'Only owners can remove owners' }, 403)
        }
        if (targetRole === 'owner' && store.projects.countProjectOwners(access.project.id) <= 1) {
            return c.json({ error: 'Project must keep at least one owner' }, 400)
        }
        store.projects.removeProjectMember(access.project.id, targetUserId)
        return c.json({ ok: true })
    })

    app.get('/projects/:id/workspaces', (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const access = requireProjectRole(store, namespace, userId, c.req.param('id'), 'viewer')
        if (access instanceof Response) return access
        return c.json({ workspaces: store.projects.listProjectWorkspaces(access.project.id) })
    })

    app.post('/projects/:id/workspaces', async (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const access = requireProjectRole(store, namespace, userId, c.req.param('id'), 'admin')
        if (access instanceof Response) return access
        const body = await c.req.json().catch(() => null)
        const parsed = ProjectWorkspaceCreateRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }
        const machine = requireMachine(c, engine, parsed.data.machineId, { ownerOnly: true })
        if (machine instanceof Response) return machine
        if (!machineAllowsWorkspace(machine, parsed.data.rootPath)) {
            return c.json({ error: 'Workspace path is outside runner workspace roots' }, 400)
        }
        const workspace = store.projects.addProjectWorkspace(
            access.project.id,
            parsed.data.machineId,
            parsed.data.rootPath,
            userId
        )
        return c.json({ workspace }, 201)
    })

    app.delete('/projects/:id/workspaces/:workspaceId', (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const access = requireProjectRole(store, namespace, userId, c.req.param('id'), 'admin')
        if (access instanceof Response) return access
        const removed = store.projects.removeProjectWorkspace(access.project.id, c.req.param('workspaceId'))
        if (!removed) {
            return c.json({ error: 'Workspace not found' }, 404)
        }
        return c.json({ ok: true })
    })

    app.post('/projects/:id/invites', async (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const access = requireProjectRole(store, namespace, userId, c.req.param('id'), 'admin')
        if (access instanceof Response) return access
        const body = await c.req.json().catch(() => null)
        const parsed = ProjectInviteCreateRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }
        if (parsed.data.role === 'owner' && access.role !== 'owner') {
            return c.json({ error: 'Only owners can invite owners' }, 403)
        }
        const expiresAt = Date.now() + (parsed.data.expiresInHours ?? DEFAULT_INVITE_EXPIRES_IN_HOURS) * 60 * 60 * 1000
        const { invite, token } = store.projects.createProjectInvite(access.project.id, parsed.data.role, expiresAt, userId)
        return c.json({
            invite: {
                id: invite.id,
                projectId: invite.projectId,
                role: invite.role,
                expiresAt: invite.expiresAt,
                createdAt: invite.createdAt
            },
            token
        }, 201)
    })

    app.post('/project-invites/:token/accept', (c) => {
        const userId = c.get('userId')
        const namespace = c.get('namespace')
        const result = store.projects.acceptProjectInvite(c.req.param('token'), userId, namespace)
        if (!result.ok) {
            const status = result.reason === 'not-found' ? 404 : 409
            return c.json({ error: result.reason }, status)
        }
        return c.json(result)
    })

    return app
}
