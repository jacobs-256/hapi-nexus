import axios from 'axios'
import type { AgentState, CreateMachineResponse, CreateSessionResponse, RunnerState, Machine, MachineMetadata, Metadata, Session } from '@/api/types'
import type { LocalResumeTarget, ResumableSession } from '@hapi/protocol'
import { CodexCollaborationModeSchema, PermissionModeSchema, TodosSchema } from '@hapi/protocol/schemas'
import {
    AgentStateSchema,
    CreateMachineResponseSchema,
    LocalHandoffResponseSchema,
    LocalResumeTargetResponseSchema,
    RunnerStateSchema,
    MachineMetadataSchema,
    MetadataSchema,
    ResumableSessionsResponseSchema
} from '@/api/types'
import { z } from 'zod'
import { configuration } from '@/configuration'
import { getAuthToken } from '@/api/auth'
import { apiValidationError } from '@/utils/errorUtils'
import { ApiMachineClient } from './apiMachine'
import { ApiSessionClient, type ApiSessionClientOptions } from './apiSession'
import { buildHubRequestHeaders } from './hubExtraHeaders'

const numberFromTransportSchema = z.preprocess((value) => {
    if (typeof value === 'bigint') return Number(value)
    return value
}, z.coerce.number())

const nullableNumberFromTransportSchema = z.preprocess((value) => {
    if (value === null || value === undefined || value === '') return null
    if (typeof value === 'bigint') return Number(value)
    return value
}, z.coerce.number().nullable())

const boolFromTransportSchema = z.preprocess((value) => {
    if (value === 1 || value === '1' || value === 'true') return true
    if (value === 0 || value === '0' || value === 'false') return false
    return value
}, z.boolean())

const nullableStringSchema = z.string().nullable().optional().default(null)

const ApiSessionWireSchema = z.object({
    id: z.string(),
    namespace: z.string(),
    projectId: z.string().nullable().optional().default(null),
    createdByUserId: nullableNumberFromTransportSchema.optional().default(null),
    seq: numberFromTransportSchema.catch(0),
    createdAt: numberFromTransportSchema.catch(0),
    updatedAt: numberFromTransportSchema.catch(0),
    active: boolFromTransportSchema.catch(false),
    activeAt: nullableNumberFromTransportSchema.transform((value) => value ?? 0).catch(0),
    metadata: z.unknown().nullable().optional().default(null),
    metadataVersion: numberFromTransportSchema.catch(0),
    agentState: z.unknown().nullable().optional().default(null),
    agentStateVersion: numberFromTransportSchema.catch(0),
    thinking: boolFromTransportSchema.catch(false),
    thinkingAt: numberFromTransportSchema.catch(0),
    backgroundTaskCount: numberFromTransportSchema.optional(),
    todos: z.unknown().optional(),
    model: nullableStringSchema,
    modelReasoningEffort: nullableStringSchema,
    effort: nullableStringSchema,
    serviceTier: nullableStringSchema,
    permissionMode: z.unknown().optional(),
    collaborationMode: z.unknown().optional()
})

const ApiSessionResponseWireSchema = z.object({
    session: ApiSessionWireSchema
})

type ApiSessionWire = z.infer<typeof ApiSessionWireSchema>

function parseApiSessionResponse(data: unknown, response: Parameters<typeof apiValidationError>[1], message: string): Session {
    const parsed = ApiSessionResponseWireSchema.safeParse(data)
    if (!parsed.success) {
        throw apiValidationError(message, response, parsed.error.issues)
    }
    return normalizeApiSession(parsed.data.session)
}

function normalizeApiSession(raw: ApiSessionWire): Session {
    const metadata = (() => {
        if (raw.metadata == null) return null
        const parsedMetadata = MetadataSchema.safeParse(raw.metadata)
        return parsedMetadata.success ? parsedMetadata.data : null
    })()

    const agentState = (() => {
        if (raw.agentState == null) return null
        const parsedAgentState = AgentStateSchema.safeParse(raw.agentState)
        return parsedAgentState.success ? parsedAgentState.data : null
    })()

    const todos = (() => {
        if (raw.todos == null) return undefined
        const parsedTodos = TodosSchema.safeParse(raw.todos)
        return parsedTodos.success ? parsedTodos.data : undefined
    })()

    const permissionMode = (() => {
        const parsedPermissionMode = PermissionModeSchema.safeParse(raw.permissionMode)
        return parsedPermissionMode.success ? parsedPermissionMode.data : undefined
    })()

    const collaborationMode = (() => {
        const parsedCollaborationMode = CodexCollaborationModeSchema.safeParse(raw.collaborationMode)
        return parsedCollaborationMode.success ? parsedCollaborationMode.data : undefined
    })()

    return {
        id: raw.id,
        namespace: raw.namespace,
        projectId: raw.projectId,
        createdByUserId: raw.createdByUserId,
        seq: raw.seq,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        active: raw.active,
        activeAt: raw.activeAt,
        metadata,
        metadataVersion: raw.metadataVersion,
        agentState,
        agentStateVersion: raw.agentStateVersion,
        thinking: raw.thinking,
        thinkingAt: raw.thinkingAt,
        backgroundTaskCount: raw.backgroundTaskCount,
        todos,
        model: raw.model,
        modelReasoningEffort: raw.modelReasoningEffort,
        effort: raw.effort,
        serviceTier: raw.serviceTier,
        permissionMode,
        collaborationMode
    }
}

export class ApiClient {
    static async create(): Promise<ApiClient> {
        return new ApiClient(getAuthToken())
    }

    private constructor(private readonly token: string) { }

    private authHeaders(): Record<string, string> {
        return buildHubRequestHeaders({
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json'
        })
    }

    async getOrCreateSession(opts: {
        id?: string
        tag: string
        metadata: Metadata
        state: AgentState | null
        model?: string
        modelReasoningEffort?: string
        effort?: string
        machine?: {
            id: string
            metadata: MachineMetadata
            runnerState?: RunnerState
        }
        timeoutMs?: number
        signal?: AbortSignal
    }): Promise<Session> {
        const response = await axios.post<CreateSessionResponse>(
            `${configuration.apiUrl}/cli/sessions`,
            {
                id: opts.id,
                tag: opts.tag,
                metadata: opts.metadata,
                agentState: opts.state,
                model: opts.model,
                modelReasoningEffort: opts.modelReasoningEffort,
                effort: opts.effort,
                machine: opts.machine
                    ? {
                        id: opts.machine.id,
                        metadata: opts.machine.metadata,
                        runnerState: opts.machine.runnerState ?? null
                    }
                    : undefined
            },
            {
                headers: buildHubRequestHeaders({
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }),
                timeout: opts.timeoutMs ?? 60_000,
                signal: opts.signal
            }
        )

        return parseApiSessionResponse(response.data, response, 'Invalid /cli/sessions response')
    }

    async getSession(sessionId: string): Promise<Session> {
        const response = await axios.get(
            `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(sessionId)}`,
            {
                headers: this.authHeaders(),
                timeout: 60_000
            }
        )

        return parseApiSessionResponse(response.data, response, 'Invalid /cli/sessions/:id response')
    }

    async getOrCreateMachine(opts: {
        machineId: string
        metadata: MachineMetadata
        runnerState?: RunnerState
    }): Promise<Machine> {
        const response = await axios.post<CreateMachineResponse>(
            `${configuration.apiUrl}/cli/machines`,
            {
                id: opts.machineId,
                metadata: opts.metadata,
                runnerState: opts.runnerState ?? null
            },
            {
                headers: buildHubRequestHeaders({
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }),
                timeout: 60_000
            }
        )

        const parsed = CreateMachineResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/machines response', response, parsed.error.issues)
        }

        const raw = parsed.data.machine

        const metadata = (() => {
            if (raw.metadata == null) return null
            const parsedMetadata = MachineMetadataSchema.safeParse(raw.metadata)
            return parsedMetadata.success ? parsedMetadata.data : null
        })()

        const runnerState = (() => {
            if (raw.runnerState == null) return null
            const parsedRunnerState = RunnerStateSchema.safeParse(raw.runnerState)
            return parsedRunnerState.success ? parsedRunnerState.data : null
        })()

        return {
            id: raw.id,
            namespace: raw.namespace,
            ownerUserId: raw.ownerUserId,
            teamId: raw.teamId,
            seq: raw.seq,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            active: raw.active,
            activeAt: raw.activeAt,
            metadata,
            metadataVersion: raw.metadataVersion,
            runnerState,
            runnerStateVersion: raw.runnerStateVersion
        }
    }

    async listResumableSessions(machineId?: string): Promise<ResumableSession[]> {
        const qs = machineId ? `?machineId=${encodeURIComponent(machineId)}` : ''
        const response = await axios.get(
            `${configuration.apiUrl}/cli/sessions/resumable${qs}`,
            {
                headers: this.authHeaders(),
                timeout: 60_000
            }
        )
        const parsed = ResumableSessionsResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/sessions/resumable response', response, parsed.error.issues)
        }
        return parsed.data.sessions
    }

    async getLocalResumeTarget(sessionId: string): Promise<LocalResumeTarget> {
        const response = await axios.get(
            `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(sessionId)}/resume-target`,
            {
                headers: this.authHeaders(),
                timeout: 60_000
            }
        )
        const parsed = LocalResumeTargetResponseSchema.safeParse(response.data)
        if (!parsed.success) {
            throw apiValidationError('Invalid /cli/sessions/:id/resume-target response', response, parsed.error.issues)
        }
        return parsed.data.target
    }

    async handoffSessionToLocal(sessionId: string): Promise<void> {
        const response = await axios.post(
            `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(sessionId)}/handoff-local`,
            {},
            {
                headers: this.authHeaders(),
                timeout: 60_000
            }
        )
        const parsed = LocalHandoffResponseSchema.safeParse(response.data)
        if (!parsed.success || !parsed.data.ok) {
            throw apiValidationError('Invalid /cli/sessions/:id/handoff-local response', response, parsed.success ? undefined : parsed.error.issues)
        }
    }

    sessionSyncClient(session: Session, options?: ApiSessionClientOptions): ApiSessionClient {
        return new ApiSessionClient(this.token, session, options)
    }

    machineSyncClient(machine: Machine, options?: { workspaceRoots?: string[] }): ApiMachineClient {
        return new ApiMachineClient(this.token, machine, options?.workspaceRoots)
    }
}
