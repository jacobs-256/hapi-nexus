import {
    MACHINE_DISPLAY_NAME_MAX_LENGTH,
    MachineListDirectoryRequestSchema,
    MachinePathsExistsRequestSchema,
    RenameMachineRequestSchema,
    SpawnSessionRequestSchema
} from '@hapi/protocol'
import { Hono, type Context } from 'hono'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { RpcTargetMissingError } from '../../sync/rpcGateway'
import type { Machine, SyncEngine } from '../../sync/syncEngine'
import type { StoredProject } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import { requireMachine, requireSession } from './guards'
import { findWorkspaceForPath, isPathInsideMachineRoots, machineAllowsWorkspace } from './workspaceAccess'
import type { ProjectRole } from '../../store/projectStore'

function canAccessMachinePath(machine: Machine, path: string): boolean {
    const roots = machine.metadata?.workspaceRoots ?? []
    return roots.length === 0 || isPathInsideMachineRoots(machine, path, roots)
}

function parseBooleanQuery(value: string | undefined): boolean {
    return value === '1' || value === 'true'
}

function resolveSpawnProject(
    c: Context<WebAppEnv>,
    engine: SyncEngine,
    machine: Machine,
    input: {
        projectId?: string
        directory: string
    }
): { project: StoredProject | null } | Response {
    const userId = c.get('userId')
    const namespace = c.get('namespace')
    if (typeof userId !== 'number') {
        return { project: null }
    }

    const isMachineOwner = machine.ownerUserId === userId
    const projects = engine
        .getProjectsForUser(namespace, userId)
        .filter((project) => engine.hasProjectRole(project.id, userId, 'editor'))

    if (input.projectId) {
        const project = engine.getProjectByNamespace(input.projectId, namespace)
        if (!project || project.archivedAt !== null) {
            return c.json({ error: 'Project not found' }, 404)
        }
        if (!engine.hasProjectRole(project.id, userId, 'editor')) {
            return c.json({ error: 'Project access denied' }, 403)
        }
        if (!isMachineOwner) {
            const workspace = findWorkspaceForPath(machine, engine.listProjectWorkspaces(project.id), input.directory)
            if (!workspace) {
                return c.json({ error: 'Directory is outside project workspaces' }, 403)
            }
        }
        return { project }
    }

    if (isMachineOwner) {
        const project = projects[0]
        if (!project) {
            return c.json({ error: 'No editable project available' }, 403)
        }
        return { project }
    }

    const workspaces = engine.listProjectWorkspacesForUser(namespace, userId, 'editor')
    const matchingProjectIds = new Set(
        workspaces
            .filter((workspace) => findWorkspaceForPath(machine, [workspace], input.directory))
            .map((workspace) => workspace.projectId)
    )
    const matches = projects.filter((project) => matchingProjectIds.has(project.id))
    if (matches.length === 1) {
        return { project: matches[0] }
    }
    if (matches.length > 1) {
        return c.json({ error: 'projectId is required when multiple projects match this directory' }, 400)
    }
    return c.json({ error: 'Directory is outside editable project workspaces' }, 403)
}

function getMachineInNamespace(
    c: Context<WebAppEnv>,
    engine: SyncEngine,
    machineId: string
): Machine | Response {
    const machine = engine.getMachine(machineId)
    if (!machine) {
        return c.json({ error: 'Machine not found' }, 404)
    }
    if (machine.namespace !== c.get('namespace')) {
        return c.json({ error: 'Machine access denied' }, 403)
    }
    return machine
}

function requireMachineForDiscovery(
    c: Context<WebAppEnv>,
    engine: SyncEngine,
    machineId: string,
    requiredRole: ProjectRole = 'viewer'
): Machine | Response {
    const sessionId = c.req.query('sessionId')?.trim()
    if (sessionId) {
        const sessionAccess = requireSession(c, engine, sessionId, { role: requiredRole })
        if (sessionAccess instanceof Response) return sessionAccess
        if (sessionAccess.session.metadata?.machineId !== machineId) {
            return c.json({ error: 'Machine access denied' }, 403)
        }
        return getMachineInNamespace(c, engine, machineId)
    }

    const projectId = c.req.query('projectId')?.trim()
    if (projectId) {
        const namespace = c.get('namespace')
        const userId = c.get('userId')
        if (typeof userId !== 'number') {
            return c.json({ error: 'Project access denied' }, 403)
        }

        const project = engine.getProjectByNamespace(projectId, namespace)
        if (!project || project.archivedAt !== null) {
            return c.json({ error: 'Project not found' }, 404)
        }
        if (!engine.hasProjectRole(project.id, userId, requiredRole)) {
            return c.json({ error: 'Project access denied' }, 403)
        }

        const machine = getMachineInNamespace(c, engine, machineId)
        if (machine instanceof Response) return machine
        if (machine.ownerUserId === userId) {
            return machine
        }
        if (!engine.listProjectWorkspaces(project.id).some((workspace) => workspace.machineId === machineId)) {
            return c.json({ error: 'Machine access denied' }, 403)
        }
        return machine
    }

    return requireMachine(c, engine, machineId, { role: requiredRole })
}

export function createMachinesRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/machines', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const namespace = c.get('namespace')
        const userId = c.get('userId')
        const includeOffline = parseBooleanQuery(c.req.query('includeOffline'))
        const machines = typeof userId === 'number'
            ? (includeOffline
                ? engine.getMachinesForUser(namespace, userId)
                : engine.getOnlineMachinesForUser(namespace, userId))
            : (includeOffline
                ? engine.getMachinesByNamespace(namespace)
                : engine.getOnlineMachinesByNamespace(namespace))
        return c.json({ machines })
    })

    app.patch('/machines/:id', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId, { ownerOnly: true })
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = RenameMachineRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body: displayName is required' }, 400)
        }

        // Trim first: a name is stored trimmed, so the ceiling applies to what
        // actually gets stored. An empty result clears the custom name.
        const displayName = parsed.data.displayName.trim()
        if (displayName.length > MACHINE_DISPLAY_NAME_MAX_LENGTH) {
            return c.json({ error: `displayName must be at most ${MACHINE_DISPLAY_NAME_MAX_LENGTH} characters` }, 400)
        }

        try {
            await engine.renameMachine(machineId, displayName)
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to rename machine'
            // Match the session rename contract: contention maps to 409.
            if (message.includes('concurrently') || message.includes('version')) {
                return c.json({ error: message }, 409)
            }
            return c.json({ error: message }, 500)
        }
    })

    app.delete('/machines/:id', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId, { ownerOnly: true })
        if (machine instanceof Response) {
            return machine
        }
        if (machine.active) {
            return c.json({
                error: 'Stop this runner before deleting the machine',
                code: 'machine_online'
            }, 409)
        }

        try {
            const result = await engine.deleteMachine(machineId, c.get('namespace'))
            return c.json({
                ok: true,
                deletedSessionCount: result.deletedSessionCount,
                deletedProjectCount: result.deletedProjectCount,
                deletedProjectWorkspaceCount: result.deletedProjectWorkspaceCount
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to delete machine'
            if (message === 'Machine not found') {
                return c.json({ error: message }, 404)
            }
            return c.json({ error: message }, 500)
        }
    })

    app.post('/machines/:id/spawn', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = SpawnSessionRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        if (!canAccessMachinePath(machine, parsed.data.directory)) {
            return c.json({ error: 'Directory is outside accessible workspace roots' }, 403)
        }

        const spawnProject = resolveSpawnProject(c, engine, machine, {
            projectId: parsed.data.projectId,
            directory: parsed.data.directory
        })
        if (spawnProject instanceof Response) {
            return spawnProject
        }

        const result = await engine.spawnSession(
            machineId,
            parsed.data.directory,
            parsed.data.agent,
            parsed.data.model,
            parsed.data.modelReasoningEffort,
            parsed.data.yolo,
            parsed.data.sessionType,
            parsed.data.worktreeName,
            undefined,
            parsed.data.effort,
            parsed.data.permissionMode,
            parsed.data.serviceTier,
            undefined,
            parsed.data.collaborationMode
        )
        if (result.type === 'success' && spawnProject.project) {
            const assigned = await engine.assignSessionProjectWhenAvailable(
                result.sessionId,
                c.get('namespace'),
                spawnProject.project.id,
                c.get('userId')
            )
            if (!assigned) {
                return c.json({ type: 'error', message: 'Session started but project assignment failed' }, 500)
            }
            const existingWorkspace = findWorkspaceForPath(
                machine,
                engine.listProjectWorkspaces(spawnProject.project.id),
                parsed.data.directory
            )
            if (!existingWorkspace && machine.ownerUserId === c.get('userId') && machineAllowsWorkspace(machine, parsed.data.directory)) {
                engine.addProjectWorkspace(
                    spawnProject.project.id,
                    machine.id,
                    parsed.data.directory,
                    c.get('userId')
                )
            }
        }
        return c.json(result)
    })

    app.post('/machines/:id/list-directory', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = MachineListDirectoryRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        if (!canAccessMachinePath(machine, parsed.data.path)) {
            return c.json({ error: 'Path is outside accessible workspace roots' }, 403)
        }

        try {
            const result = await engine.listMachineDirectory(machineId, parsed.data.path)
            return c.json(result)
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to list directory' }, 500)
        }
    })

    app.post('/machines/:id/paths/exists', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = MachinePathsExistsRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const uniquePaths = Array.from(new Set(parsed.data.paths.map((path) => path.trim()).filter(Boolean)))
        if (uniquePaths.length === 0) {
            return c.json({ exists: {} })
        }
        if (uniquePaths.some((path) => !canAccessMachinePath(machine, path))) {
            return c.json({ error: 'Path is outside accessible workspace roots' }, 403)
        }

        try {
            const exists = await engine.checkPathsExist(machineId, uniquePaths)
            return c.json({ exists })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to check paths' }, 500)
        }
    })

    app.get('/machines/:id/codex-models', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ success: false, error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachineForDiscovery(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        try {
            const result = await engine.listCodexModelsForMachine(machineId)
            return c.json(result)
        } catch (error) {
            if (error instanceof RpcTargetMissingError && error.method === `${machineId}:${RPC_METHODS.ListCodexModels}`) {
                return c.json({ success: true, models: [] })
            }
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list Codex models'
            }, 500)
        }
    })

    app.get('/machines/:id/opencode-models', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ success: false, error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const cwd = (c.req.query('cwd') ?? '').trim()
        if (!cwd) {
            return c.json({ success: false, error: 'cwd query parameter is required' }, 400)
        }
        if (!canAccessMachinePath(machine, cwd)) {
            return c.json({ success: false, error: 'cwd is outside accessible workspace roots' }, 403)
        }

        try {
            const result = await engine.listOpencodeModelsForCwd(machineId, cwd)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list OpenCode models'
            }, 500)
        }
    })

    app.get('/machines/:id/grok-models', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ success: false, error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) return machine

        const cwd = (c.req.query('cwd') ?? '').trim()
        if (!cwd) {
            return c.json({ success: false, error: 'cwd query parameter is required' }, 400)
        }
        if (!canAccessMachinePath(machine, cwd)) {
            return c.json({ success: false, error: 'cwd is outside accessible workspace roots' }, 403)
        }

        try {
            return c.json(await engine.listGrokModelsForCwd(machineId, cwd))
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list Grok models'
            }, 500)
        }
    })

    app.get('/machines/:id/cursor-models', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ success: false, error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        try {
            const result = await engine.listCursorModelsForMachine(machineId)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list Cursor models'
            }, 500)
        }
    })

    return app
}
