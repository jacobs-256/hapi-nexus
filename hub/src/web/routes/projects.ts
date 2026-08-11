import { Hono } from 'hono'
import {
    CreateProjectRequestSchema,
    ProjectDirectoryMoveRequestSchema,
    ProjectInviteCreateRequestSchema,
    ProjectMemberUpsertRequestSchema,
    ProjectWorkspaceCreateRequestSchema,
    ProjectWorkspaceMoveRequestSchema,
    UpdateProjectRequestSchema,
    type EnterpriseUser
} from '@hapi/protocol'
import type { ProjectRole } from '../../store/projectStore'
import type { Store, StoredProject, StoredUser } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireMachine, requireSyncEngine } from './guards'
import { isPathInsideRoot, machineAllowsWorkspace } from './workspaceAccess'
import { getOrCreateOwnerId } from '../../config/ownerId'

const DEFAULT_INVITE_EXPIRES_IN_HOURS = 72

type ProjectsRouteOptions = {
    getOwnerUserId?: () => Promise<number>
}

function roleCanManageMembers(role: ProjectRole | null): boolean {
    return role === 'owner' || role === 'admin'
}

function canReferenceUser(store: Store, namespace: string, actorUserId: number, targetUserId: number): boolean {
    return targetUserId === actorUserId || store.users.getUserById(targetUserId, namespace) !== null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWindowsMachineMetadata(metadata: unknown, fallbackPath: string): boolean {
    if (!isPlainObject(metadata)) return /^[a-zA-Z]:[\\/]/.test(fallbackPath)
    if (metadata.platform === 'win32') return true
    const roots = Array.isArray(metadata.workspaceRoots) ? metadata.workspaceRoots : []
    return roots.some((root) => typeof root === 'string' && /^[a-zA-Z]:[\\/]/.test(root))
        || /^[a-zA-Z]:[\\/]/.test(fallbackPath)
}

function getSessionDirectory(session: ReturnType<SyncEngine['getSessionsByNamespace']>[number]): string | null {
    return session.metadata?.worktree?.basePath ?? session.metadata?.path ?? null
}

function samePathForMachine(a: string, b: string, windows: boolean): boolean {
    return isPathInsideRoot(a, b, windows) && isPathInsideRoot(b, a, windows)
}

function toEnterpriseUser(user: StoredUser): EnterpriseUser {
    return {
        id: user.id,
        platform: user.platform,
        platformUserId: user.platformUserId,
        namespace: user.namespace,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        disabledAt: user.disabledAt,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
    }
}

function toOwnerEnterpriseUser(ownerId: number, namespace: string): EnterpriseUser {
    return {
        id: ownerId,
        platform: 'owner',
        platformUserId: 'hub-owner',
        namespace,
        username: 'admin',
        displayName: 'Hub Owner',
        role: 'admin',
        disabledAt: null,
        createdAt: 0,
        updatedAt: null
    }
}

async function resolveEnterpriseUser(
    store: Store,
    namespace: string,
    userId: number | null,
    getOwnerUserId: () => Promise<number>
): Promise<EnterpriseUser | null> {
    if (userId === null) return null
    const ownerId = await getOwnerUserId()
    if (userId === ownerId) {
        return toOwnerEnterpriseUser(ownerId, namespace)
    }
    const user = store.users.getUserById(userId, namespace)
    return user ? toEnterpriseUser(user) : null
}

async function toProjectDetails(
    store: Store,
    project: StoredProject,
    userId: number,
    getOwnerUserId: () => Promise<number>
) {
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
        workspaces: store.projects.listProjectWorkspaces(project.id),
        createdByUser: await resolveEnterpriseUser(store, project.namespace, project.createdByUserId, getOwnerUserId)
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
    getSyncEngine: () => SyncEngine | null,
    options?: ProjectsRouteOptions
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const getOwnerUserId = options?.getOwnerUserId ?? getOrCreateOwnerId

    app.get('/projects', async (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const projects = await Promise.all(store.projects
            .listProjectsForUser(namespace, userId)
            .map((project) => toProjectDetails(store, project, userId, getOwnerUserId)))
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

        return c.json({ project: await toProjectDetails(store, project, userId, getOwnerUserId) }, 201)
    })

    app.get('/projects/:id', async (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const result = requireProjectRole(store, namespace, userId, c.req.param('id'), 'viewer')
        if (result instanceof Response) return result
        return c.json({ project: await toProjectDetails(store, result.project, userId, getOwnerUserId) })
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
        return c.json({ project: await toProjectDetails(store, project, userId, getOwnerUserId) })
    })

    app.get('/projects/:id/members', (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const access = requireProjectRole(store, namespace, userId, c.req.param('id'), 'viewer')
        if (access instanceof Response) return access
        return c.json({ members: store.projects.listProjectMembers(access.project.id) })
    })

    app.get('/projects/:id/member-candidates', async (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const access = requireProjectRole(store, namespace, userId, c.req.param('id'), 'admin')
        if (access instanceof Response) return access
        if (!roleCanManageMembers(access.role)) {
            return c.json({ error: 'Project access denied' }, 403)
        }

        const ownerId = await getOwnerUserId()
        const localUsers = store.users.listUsersByNamespace(namespace).map(toEnterpriseUser)
        const users = [
            toOwnerEnterpriseUser(ownerId, namespace),
            ...localUsers.filter((user) => user.id !== ownerId)
        ]
        return c.json({ users })
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

    app.post('/projects/:id/workspaces/:workspaceId/move', async (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const sourceAccess = requireProjectRole(store, namespace, userId, c.req.param('id'), 'admin')
        if (sourceAccess instanceof Response) return sourceAccess

        const body = await c.req.json().catch(() => null)
        const parsed = ProjectWorkspaceMoveRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }
        if (parsed.data.targetProjectId === sourceAccess.project.id) {
            return c.json({ error: 'Target project must be different' }, 400)
        }

        const sourceWorkspace = store.projects
            .listProjectWorkspaces(sourceAccess.project.id)
            .find((workspace) => workspace.id === c.req.param('workspaceId'))
        if (!sourceWorkspace) {
            return c.json({ error: 'Workspace not found' }, 404)
        }

        const targetAccess = requireProjectRole(store, namespace, userId, parsed.data.targetProjectId, 'admin')
        if (targetAccess instanceof Response) return targetAccess

        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        let workspace
        try {
            workspace = engine.addProjectWorkspace(
                targetAccess.project.id,
                sourceWorkspace.machineId,
                sourceWorkspace.rootPath,
                userId
            )
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to move workspace' }, 400)
        }
        store.projects.removeProjectWorkspace(sourceAccess.project.id, sourceWorkspace.id)

        const sourceMachine = store.machines.getMachineByNamespace(sourceWorkspace.machineId, namespace)
        const windows = isWindowsMachineMetadata(sourceMachine?.metadata, sourceWorkspace.rootPath)
        for (const session of engine.getSessionsByNamespace(namespace)) {
            const directory = getSessionDirectory(session)
            if (
                session.projectId === sourceAccess.project.id
                && session.metadata?.machineId === sourceWorkspace.machineId
                && directory
                && isPathInsideRoot(directory, sourceWorkspace.rootPath, windows)
            ) {
                engine.assignSessionProject(session.id, namespace, targetAccess.project.id, userId)
            }
        }

        return c.json({ workspace })
    })

    app.post('/projects/:id/directories/move', async (c) => {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const sourceAccess = requireProjectRole(store, namespace, userId, c.req.param('id'), 'admin')
        if (sourceAccess instanceof Response) return sourceAccess

        const body = await c.req.json().catch(() => null)
        const parsed = ProjectDirectoryMoveRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }
        if (parsed.data.targetProjectId === sourceAccess.project.id) {
            return c.json({ error: 'Target project must be different' }, 400)
        }

        const targetAccess = requireProjectRole(store, namespace, userId, parsed.data.targetProjectId, 'admin')
        if (targetAccess instanceof Response) return targetAccess

        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const machine = requireMachine(c, engine, parsed.data.machineId, { ownerOnly: true })
        if (machine instanceof Response) return machine
        if (!machineAllowsWorkspace(machine, parsed.data.rootPath)) {
            return c.json({ error: 'Directory is outside runner workspace roots' }, 400)
        }

        const windows = isWindowsMachineMetadata(machine.metadata, parsed.data.rootPath)
        const sourceWorkspace = parsed.data.sourceWorkspaceId
            ? store.projects
                .listProjectWorkspaces(sourceAccess.project.id)
                .find((workspace) => workspace.id === parsed.data.sourceWorkspaceId)
            : null
        if (parsed.data.sourceWorkspaceId && !sourceWorkspace) {
            return c.json({ error: 'Source directory not found' }, 404)
        }

        let workspace
        try {
            workspace = engine.addProjectWorkspace(
                targetAccess.project.id,
                machine.id,
                parsed.data.rootPath,
                userId
            )
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to move directory' }, 400)
        }

        if (
            sourceWorkspace
            && sourceWorkspace.machineId === machine.id
            && samePathForMachine(sourceWorkspace.rootPath, parsed.data.rootPath, windows)
        ) {
            store.projects.removeProjectWorkspace(sourceAccess.project.id, sourceWorkspace.id)
        }

        for (const session of engine.getSessionsByNamespace(namespace)) {
            const directory = getSessionDirectory(session)
            if (
                session.projectId === sourceAccess.project.id
                && session.metadata?.machineId === machine.id
                && directory
                && isPathInsideRoot(directory, parsed.data.rootPath, windows)
            ) {
                engine.assignSessionProject(session.id, namespace, targetAccess.project.id, userId)
            }
        }

        return c.json({ workspace })
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
