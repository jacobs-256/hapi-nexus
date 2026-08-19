import { Hono } from 'hono'
import { z } from 'zod'
import {
    CreateOrLoadMachineRequestSchema,
    CreateOrLoadSessionRequestSchema,
    CursorMigrateToAcpRequestSchema,
    PROTOCOL_VERSION
} from '@hapi/protocol'
import { resolveCliAuthToken, type CliAuthContext } from '../../cliAuth'
import type { Store, StoredProject } from '../../store'
import type { Machine, Session, SyncEngine } from '../../sync/syncEngine'
import { SessionIdentityConflictError } from '../../store/sessions'

const bearerSchema = z.string().regex(/^Bearer\s+(.+)$/i)

const getMessagesQuerySchema = z.object({
    afterSeq: z.coerce.number().int().min(0),
    limit: z.coerce.number().int().min(1).max(200).optional()
})

type CliEnv = {
    Variables: {
        namespace: string
        userId: number
        authPlatform: CliAuthContext['authPlatform']
        cliRole: CliAuthContext['role']
        cliAuthSource: CliAuthContext['source']
    }
}

type CliRouteOptions = {
    store: Store
    getOwnerUserId?: () => Promise<number>
}

async function resolveSessionForNamespace(
    engine: SyncEngine,
    sessionId: string,
    auth: CliAuthContext
): Promise<{ ok: true; session: Session; sessionId: string } | { ok: false; status: 403 | 404; error: string }> {
    const asyncEngine = engine as SyncEngine & {
        resolveSessionAccessAsync?: SyncEngine['resolveSessionAccessAsync']
        resolveSessionAccessForUserAsync?: SyncEngine['resolveSessionAccessForUserAsync']
    }
    const access = auth.source === 'system'
        ? asyncEngine.resolveSessionAccessAsync
            ? await asyncEngine.resolveSessionAccessAsync(sessionId, auth.namespace)
            : engine.resolveSessionAccess(sessionId, auth.namespace)
        : asyncEngine.resolveSessionAccessForUserAsync
            ? await asyncEngine.resolveSessionAccessForUserAsync(sessionId, auth.namespace, auth.userId, 'editor')
            : engine.resolveSessionAccessForUser(sessionId, auth.namespace, auth.userId, 'editor')
    if (access.ok) {
        return { ok: true, session: access.session, sessionId: access.sessionId }
    }
    return {
        ok: false,
        status: access.reason === 'access-denied' ? 403 : 404,
        error: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found'
    }
}

async function resolveMachineForNamespace(
    engine: SyncEngine,
    machineId: string,
    auth: CliAuthContext
): Promise<{ ok: true; machine: Machine } | { ok: false; status: 403 | 404; error: string }> {
    if (auth.source === 'system') {
        const machine = engine.getMachineByNamespace(machineId, auth.namespace)
        if (machine) {
            return { ok: true, machine }
        }
        if (engine.getMachine(machineId)) {
            return { ok: false, status: 403, error: 'Machine access denied' }
        }
        return { ok: false, status: 404, error: 'Machine not found' }
    }

    const access = await engine.resolveMachineAccessForUser(machineId, auth.namespace, auth.userId, 'editor')
    if (access.ok && access.machine.ownerUserId === auth.userId) {
        return { ok: true, machine: access.machine }
    }
    if (access.ok || access.reason === 'access-denied') {
        return { ok: false, status: 403, error: 'Machine access denied' }
    }
    return { ok: false, status: 404, error: 'Machine not found' }
}

function getCliAuth(c: { get: <K extends keyof CliEnv['Variables']>(key: K) => CliEnv['Variables'][K] }): CliAuthContext {
    return {
        namespace: c.get('namespace'),
        userId: c.get('userId'),
        authPlatform: c.get('authPlatform'),
        role: c.get('cliRole'),
        source: c.get('cliAuthSource')
    }
}

async function ensureCliProject(engine: SyncEngine, store: Store, auth: CliAuthContext): Promise<StoredProject> {
    if (auth.source === 'system') {
        return await engine.ensureNamespaceDefaults(auth.namespace, auth.userId)
    }
    return await store.projects.ensurePersonalProject(auth.namespace, auth.userId)
}

function canUseExistingMachineForAuth(machine: Machine, auth: CliAuthContext): boolean {
    if (machine.namespace !== auth.namespace) {
        return false
    }
    if (auth.source === 'system') {
        return true
    }
    return machine.ownerUserId === null || machine.ownerUserId === auth.userId
}

export function createCliRoutes(getSyncEngine: () => SyncEngine | null, options: CliRouteOptions): Hono<CliEnv> {
    const app = new Hono<CliEnv>()

    app.use('*', async (c, next) => {
        c.header('X-Hapi-Protocol-Version', String(PROTOCOL_VERSION))

        const raw = c.req.header('authorization')
        if (!raw) {
            return c.json({ error: 'Missing Authorization header' }, 401)
        }

        const parsed = bearerSchema.safeParse(raw)
        if (!parsed.success) {
            return c.json({ error: 'Invalid Authorization header' }, 401)
        }

        const token = parsed.data.replace(/^Bearer\s+/i, '')
        const auth = await resolveCliAuthToken(options.store, token, {
            getOwnerUserId: options.getOwnerUserId
        })
        if (!auth) {
            return c.json({ error: 'Invalid token' }, 401)
        }

        c.set('namespace', auth.namespace)
        c.set('userId', auth.userId)
        c.set('authPlatform', auth.authPlatform)
        c.set('cliRole', auth.role)
        c.set('cliAuthSource', auth.source)
        return await next()
    })

    app.post('/sessions', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = CreateOrLoadSessionRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const auth = getCliAuth(c)
        const defaultProject = await ensureCliProject(engine, options.store, auth)
        const machineInput = parsed.data.machine
        if (machineInput) {
            const existingMachine = engine.getMachine(machineInput.id)
            if (existingMachine && !canUseExistingMachineForAuth(existingMachine, auth)) {
                return c.json({ error: 'Machine access denied' }, 403)
            }
            await engine.getOrCreateMachine(
                machineInput.id,
                machineInput.metadata,
                machineInput.runnerState ?? null,
                auth.namespace,
                { ownerUserId: auth.userId, teamId: defaultProject.teamId }
            )
        }

        try {
            const asyncEngine = engine as SyncEngine & { getOrCreateSessionAsync?: SyncEngine['getOrCreateSessionAsync'] }
            const session = asyncEngine.getOrCreateSessionAsync
                ? await asyncEngine.getOrCreateSessionAsync(
                    parsed.data.tag,
                    parsed.data.metadata,
                    parsed.data.agentState ?? null,
                    auth.namespace,
                    parsed.data.model,
                    parsed.data.effort,
                    parsed.data.modelReasoningEffort,
                    parsed.data.id,
                    { projectId: defaultProject.id, createdByUserId: auth.userId }
                )
                : engine.getOrCreateSession(
                parsed.data.tag,
                parsed.data.metadata,
                parsed.data.agentState ?? null,
                auth.namespace,
                parsed.data.model,
                parsed.data.effort,
                parsed.data.modelReasoningEffort,
                parsed.data.id,
                { projectId: defaultProject.id, createdByUserId: auth.userId }
            )
            return c.json({ session })
        } catch (error) {
            if (error instanceof SessionIdentityConflictError) {
                return c.json({ error: error.message }, 409)
            }
            throw error
        }
    })

    app.get('/sessions/resumable', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }

        const auth = getCliAuth(c)
        const machineId = c.req.query('machineId') || undefined
        const resumableSessions = await Promise.resolve(engine.listLocalResumableSessions(auth.namespace, { machineId }))
        const asyncEngine = engine as SyncEngine & { resolveSessionAccessForUserAsync?: SyncEngine['resolveSessionAccessForUserAsync'] }
        const sessions = auth.source === 'system'
            ? resumableSessions
            : (await Promise.all(resumableSessions.map(async (session) => {
                const access = asyncEngine.resolveSessionAccessForUserAsync
                    ? await asyncEngine.resolveSessionAccessForUserAsync(session.sessionId, auth.namespace, auth.userId, 'editor')
                    : engine.resolveSessionAccessForUser(session.sessionId, auth.namespace, auth.userId, 'editor')
                return access.ok ? session : null
            }))).filter((session): session is NonNullable<typeof session> => session !== null)
        return c.json({ sessions })
    })

    app.get('/sessions/:id/resume-target', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }

        const auth = getCliAuth(c)
        const result = await Promise.resolve(engine.resolveLocalResumeTarget(c.req.param('id'), auth.namespace))
        if (result.type === 'error') {
            const status = result.code === 'access_denied' ? 403
                : result.code === 'session_not_found' ? 404
                    : 409
            return c.json({ error: result.message, code: result.code }, status)
        }
        if (auth.source !== 'system') {
            const asyncEngine = engine as SyncEngine & { resolveSessionAccessForUserAsync?: SyncEngine['resolveSessionAccessForUserAsync'] }
            const access = asyncEngine.resolveSessionAccessForUserAsync
                ? await asyncEngine.resolveSessionAccessForUserAsync(result.target.sessionId, auth.namespace, auth.userId, 'editor')
                : engine.resolveSessionAccessForUser(result.target.sessionId, auth.namespace, auth.userId, 'editor')
            if (!access.ok) {
                const status = access.reason === 'access-denied' ? 403 : 404
                return c.json({ error: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found' }, status)
            }
        }

        return c.json({ target: result.target })
    })

    app.post('/sessions/:id/handoff-local', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }

        const auth = getCliAuth(c)
        if (auth.source !== 'system') {
            const asyncEngine = engine as SyncEngine & { resolveSessionAccessForUserAsync?: SyncEngine['resolveSessionAccessForUserAsync'] }
            const access = asyncEngine.resolveSessionAccessForUserAsync
                ? await asyncEngine.resolveSessionAccessForUserAsync(c.req.param('id'), auth.namespace, auth.userId, 'editor')
                : engine.resolveSessionAccessForUser(c.req.param('id'), auth.namespace, auth.userId, 'editor')
            if (!access.ok) {
                const status = access.reason === 'access-denied' ? 403 : 404
                return c.json({ error: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found' }, status)
            }
        }
        const result = await engine.handoffSessionToLocal(c.req.param('id'), auth.namespace)
        if (result.type === 'error') {
            const status = result.code === 'access_denied' ? 403
                : result.code === 'session_not_found' ? 404
                    : result.code === 'already_local' ? 409
                        : 500
            return c.json({ error: result.message, code: result.code }, status)
        }

        return c.json({ ok: true })
    })

    app.get('/sessions/:id', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const auth = getCliAuth(c)
        const resolved = await resolveSessionForNamespace(engine, sessionId, auth)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        return c.json({ session: resolved.session })
    })

    app.get('/sessions/:id/messages', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const auth = getCliAuth(c)
        const resolved = await resolveSessionForNamespace(engine, sessionId, auth)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }

        const parsed = getMessagesQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const limit = parsed.data.limit ?? 200
        // Future-scheduled rows are excluded from CLI backfill — see
        // messages.ts:getDeliverableMessagesAfter for the rationale.  The
        // mature-scan path (releaseMatureScheduledMessages) is the sole
        // emit channel for scheduled rows.
        const asyncEngine = engine as SyncEngine & { getDeliverableMessagesAfterAsync?: SyncEngine['getDeliverableMessagesAfterAsync'] }
        const messages = asyncEngine.getDeliverableMessagesAfterAsync
            ? await asyncEngine.getDeliverableMessagesAfterAsync(resolved.sessionId, {
                afterSeq: parsed.data.afterSeq,
                limit,
                now: Date.now()
            })
            : engine.getDeliverableMessagesAfter(resolved.sessionId, {
                afterSeq: parsed.data.afterSeq,
                limit,
                now: Date.now()
            })
        return c.json({ messages })
    })

    app.post('/sessions/:id/migrate-to-acp', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const auth = getCliAuth(c)
        const resolved = await resolveSessionForNamespace(engine, sessionId, auth)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        // Codex #34 P2 (round 13): mirror the sessions.ts route hardening —
        // distinguish "no body" from "malformed JSON". A silent fallback to
        // {} would run the migration with destructive defaults even when
        // the operator's intended body was mangled in transit.
        const rawBody = await c.req.text()
        let body: unknown = {}
        if (rawBody.trim().length > 0) {
            try {
                body = JSON.parse(rawBody)
            } catch {
                return c.json({ error: 'Invalid JSON body' }, 400)
            }
        }
        const parsed = CursorMigrateToAcpRequestSchema.safeParse(body ?? {})
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400)
        }
        const outcome = await engine.migrateLegacyCursorSession(resolved.sessionId, auth.namespace, parsed.data)
        const status = outcome.ok ? 200
            : outcome.reason === 'already_acp' || outcome.reason === 'not_cursor_session' || outcome.reason === 'no_cursor_session_id' ? 409
                : outcome.reason === 'running_refused' ? 409
                    : outcome.reason === 'target_already_exists' ? 409
                        : outcome.reason === 'no_legacy_store_on_disk' ? 404
                            : 500
        return c.json(outcome, status)
    })

    app.post('/machines', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = CreateOrLoadMachineRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const auth = getCliAuth(c)
        const defaultProject = await ensureCliProject(engine, options.store, auth)
        const existing = engine.getMachine(parsed.data.id)
        if (existing && !canUseExistingMachineForAuth(existing, auth)) {
            return c.json({ error: 'Machine access denied' }, 403)
        }
        const machine = await engine.getOrCreateMachine(
            parsed.data.id,
            parsed.data.metadata,
            parsed.data.runnerState ?? null,
            auth.namespace,
            { ownerUserId: auth.userId, teamId: defaultProject.teamId }
        )
        return c.json({ machine })
    })

    app.get('/machines/:id', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const machineId = c.req.param('id')
        const auth = getCliAuth(c)
        const resolved = await resolveMachineForNamespace(engine, machineId, auth)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        return c.json({ machine: resolved.machine })
    })

    return app
}
