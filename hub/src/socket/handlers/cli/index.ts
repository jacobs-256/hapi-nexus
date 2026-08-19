import type { CodexCollaborationMode, PermissionMode } from '@hapi/protocol/types'
import type { Store, StoredMachine, StoredSession } from '../../../store'
import type { RpcRegistry } from '../../rpcRegistry'
import type { SyncEvent } from '../../../sync/syncEngine'
import type { TerminalRegistry } from '../../terminalRegistry'
import type { CliSocketWithData, SocketServer } from '../../socketTypes'
import type { AccessErrorReason, AccessResult } from './types'
import { registerMachineHandlers } from './machineHandlers'
import { registerRpcHandlers } from './rpcHandlers'
import { registerSessionHandlers } from './sessionHandlers'
import { cleanupTerminalHandlers, registerTerminalHandlers } from './terminalHandlers'

type SessionAlivePayload = {
    sid: string
    time: number
    thinking?: boolean
    mode?: 'local' | 'remote'
    permissionMode?: PermissionMode
    model?: string | null
    modelReasoningEffort?: string | null
    effort?: string | null
    collaborationMode?: CodexCollaborationMode
}

type SessionEndPayload = {
    sid: string
    time: number
}

type SessionReadyPayload = {
    sid: string
    time: number
}

type MachineAlivePayload = {
    machineId: string
    time: number
}

export type CliHandlersDeps = {
    io: SocketServer
    store: Store
    rpcRegistry: RpcRegistry
    terminalRegistry: TerminalRegistry
    onSessionAlive?: (payload: SessionAlivePayload) => void | Promise<void>
    onSessionReady?: (payload: SessionReadyPayload) => void | Promise<void>
    onSessionEnd?: (payload: SessionEndPayload) => void | Promise<void>
    onMachineAlive?: (payload: MachineAlivePayload) => void
    onWebappEvent?: (event: SyncEvent) => void | Promise<void>
    onBackgroundTaskDelta?: (sessionId: string, delta: { started: number; completed: number }) => void
    onSessionActivity?: (sessionId: string, updatedAt: number) => unknown | Promise<unknown>
    onSweepImmediateQueued?: (sessionId: string, now: number) => void | Promise<void>
    onMessagesConsumed?: (sessionId: string) => void
}

export function registerCliHandlers(socket: CliSocketWithData, deps: CliHandlersDeps): void {
    const { io, store, rpcRegistry, terminalRegistry, onSessionAlive, onSessionReady, onSessionEnd, onMachineAlive, onWebappEvent, onBackgroundTaskDelta, onSessionActivity, onSweepImmediateQueued, onMessagesConsumed } = deps
    const terminalNamespace = io.of('/terminal')
    const namespace = typeof socket.data.namespace === 'string' ? socket.data.namespace : null
    const userId = typeof socket.data.userId === 'number' ? socket.data.userId : null
    const isUserToken = socket.data.cliAuthSource === 'user'

    const resolveSessionAccess = async (sessionId: string): Promise<AccessResult<StoredSession>> => {
        if (!namespace) {
            return { ok: false, reason: 'namespace-missing' }
        }
        const session = await store.sessions.getSessionByNamespace(sessionId, namespace)
        if (session) {
            if (isUserToken) {
                if (userId === null || session.projectId === null) {
                    return { ok: false, reason: 'access-denied' }
                }
                if (!await store.projects.hasProjectRole(session.projectId, userId, 'editor')) {
                    return { ok: false, reason: 'access-denied' }
                }
            }
            return { ok: true, value: session }
        }
        if (await store.sessions.getSession(sessionId)) {
            return { ok: false, reason: 'access-denied' }
        }
        return { ok: false, reason: 'not-found' }
    }

    const resolveMachineAccess = async (machineId: string): Promise<AccessResult<StoredMachine>> => {
        if (!namespace) {
            return { ok: false, reason: 'namespace-missing' }
        }
        const machine = await store.machines.getMachineByNamespace(machineId, namespace)
        if (machine) {
            if (isUserToken && machine.ownerUserId !== userId) {
                return { ok: false, reason: 'access-denied' }
            }
            return { ok: true, value: machine }
        }
        if (await store.machines.getMachine(machineId)) {
            return { ok: false, reason: 'access-denied' }
        }
        return { ok: false, reason: 'not-found' }
    }

    const auth = socket.handshake.auth as Record<string, unknown> | undefined
    const sessionId = typeof auth?.sessionId === 'string' ? auth.sessionId : null
    if (sessionId) {
        void resolveSessionAccess(sessionId).then((access) => {
            if (access.ok) socket.join(`session:${sessionId}`)
        })
    }

    const machineId = typeof auth?.machineId === 'string' ? auth.machineId : null
    if (machineId) {
        void resolveMachineAccess(machineId).then((access) => {
            if (access.ok) socket.join(`machine:${machineId}`)
        })
    }

    const emitAccessError = (scope: 'session' | 'machine', id: string, reason: AccessErrorReason) => {
        const message = reason === 'access-denied'
            ? `${scope} access denied`
            : reason === 'not-found'
                ? `${scope} not found`
                : 'Namespace missing'
        socket.emit('error', { message, code: reason, scope, id })
    }

    registerRpcHandlers(socket, rpcRegistry)
    registerSessionHandlers(socket, {
        store,
        resolveSessionAccess,
        emitAccessError,
        onSessionAlive,
        onSessionReady,
        onSessionEnd,
        onWebappEvent,
        onBackgroundTaskDelta,
        onSessionActivity,
        onSweepImmediateQueued,
        onMessagesConsumed
    })
    registerMachineHandlers(socket, {
        store,
        resolveMachineAccess,
        emitAccessError,
        onMachineAlive,
        onWebappEvent
    })
    registerTerminalHandlers(socket, {
        terminalRegistry,
        terminalNamespace,
        resolveSessionAccess,
        emitAccessError
    })

    socket.on('ping', (callback: () => void) => {
        callback()
    })

    socket.on('disconnect', () => {
        rpcRegistry.unregisterAll(socket)
        cleanupTerminalHandlers(socket, { terminalRegistry, terminalNamespace })
    })
}
