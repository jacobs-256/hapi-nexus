import type { ScratchlistAttachmentMetadata } from '@hapi/protocol'
import type { DeleteMachineResult } from '../machines'
import type { CreateScratchlistResult } from '../scratchlist'
import type { StoredCodexImportJobRecord } from '../codexImportJobStore'
import type { ProjectRole } from '../projects'
import type { CreateLocalUserInput, UpdateLocalUsernameResult, UpdateUserInput } from '../users'
import type { StoredFcmDevice, StoredMachine, StoredProject, StoredProjectInvite, StoredProjectMember, StoredProjectWorkspace, StoredPushSubscription, StoredScratchlistEntry, StoredSession, StoredUser, VersionedUpdateResult } from '../types'
import type { MaybePromise } from './types'


export type SessionCreateOptions = {
    projectId?: string | null
    createdByUserId?: number | null
}

export type TouchUpdatedAtOptions = {
    touchUpdatedAt?: boolean
}

export interface SessionStorePort {
    getOrCreateSession(
        tag: string,
        metadata: unknown,
        agentState: unknown,
        namespace: string,
        model?: string,
        effort?: string,
        modelReasoningEffort?: string,
        requestedId?: string,
        options?: SessionCreateOptions
    ): MaybePromise<StoredSession>
    assignSessionProject(id: string, namespace: string, projectId: string, createdByUserId: number): MaybePromise<StoredSession | null>
    updateSessionMetadata(id: string, metadata: unknown, expectedVersion: number, namespace: string, options?: TouchUpdatedAtOptions): MaybePromise<VersionedUpdateResult<unknown | null>>
    updateSessionAgentState(id: string, agentState: unknown, expectedVersion: number, namespace: string): MaybePromise<VersionedUpdateResult<unknown | null>>
    setSessionTodos(id: string, todos: unknown, todosUpdatedAt: number, namespace: string): MaybePromise<boolean>
    setSessionTeamState(id: string, teamState: unknown, updatedAt: number, namespace: string): MaybePromise<boolean>
    setSessionModel(id: string, model: string | null, namespace: string, options?: TouchUpdatedAtOptions): MaybePromise<boolean>
    setSessionModelReasoningEffort(id: string, modelReasoningEffort: string | null, namespace: string, options?: TouchUpdatedAtOptions): MaybePromise<boolean>
    setSessionEffort(id: string, effort: string | null, namespace: string, options?: TouchUpdatedAtOptions): MaybePromise<boolean>
    setSessionServiceTier(id: string, serviceTier: string | null, namespace: string, options?: TouchUpdatedAtOptions): MaybePromise<boolean>
    setSessionActive(id: string, active: boolean, activeAt: number, namespace: string): MaybePromise<boolean>
    touchSessionUpdatedAt(id: string, updatedAt: number, namespace: string): MaybePromise<boolean>
    getSession(id: string): MaybePromise<StoredSession | null>
    getSessionByNamespace(id: string, namespace: string): MaybePromise<StoredSession | null>
    getSessions(): MaybePromise<StoredSession[]>
    getSessionsByNamespace(namespace: string): MaybePromise<StoredSession[]>
    deleteSession(id: string, namespace: string): MaybePromise<boolean>
}

export type MachineOwnershipOptions = {
    ownerUserId?: number | null
    teamId?: string | null
}

export interface MachineStorePort {
    getOrCreateMachine(id: string, metadata: unknown, runnerState: unknown, namespace: string, options?: MachineOwnershipOptions): MaybePromise<StoredMachine>
    updateMachineMetadata(id: string, metadata: unknown, expectedVersion: number, namespace: string): MaybePromise<VersionedUpdateResult<unknown | null>>
    updateMachineRunnerState(id: string, runnerState: unknown, expectedVersion: number, namespace: string): MaybePromise<VersionedUpdateResult<unknown | null>>
    getMachine(id: string): MaybePromise<StoredMachine | null>
    getMachineByNamespace(id: string, namespace: string): MaybePromise<StoredMachine | null>
    getMachines(): MaybePromise<StoredMachine[]>
    getMachinesByNamespace(namespace: string): MaybePromise<StoredMachine[]>
    deleteMachineByNamespace(id: string, namespace: string): MaybePromise<DeleteMachineResult>
}

export type ProjectOptions = {
    repoUrl?: string | null
    teamId?: string | null
}

export type ProjectWorkspaceInput = {
    machineId: string
    rootPath: string
}

export type AcceptProjectInviteResult =
    | { ok: true; projectId: string; role: ProjectRole }
    | { ok: false; reason: 'not-found' | 'expired' }

export interface ProjectStorePort {
    ensureDefaults(namespace: string, ownerUserId: number): MaybePromise<StoredProject>
    ensureDefaultProject(namespace: string, ownerUserId: number): MaybePromise<StoredProject>
    ensurePersonalProject(namespace: string, ownerUserId: number): MaybePromise<StoredProject>
    assignLegacySessionsToDefaultProject(namespace: string, ownerUserId: number): MaybePromise<string>
    assignLegacyMachinesToOwner(namespace: string, ownerUserId: number): MaybePromise<void>
    createProject(namespace: string, name: string, createdByUserId: number, options?: ProjectOptions): MaybePromise<StoredProject>
    createProjectWithWorkspace(namespace: string, name: string, createdByUserId: number, workspace: ProjectWorkspaceInput, options?: ProjectOptions): MaybePromise<StoredProject>
    updateProjectName(projectId: string, namespace: string, name: string): MaybePromise<StoredProject | null>
    getProjectByNamespace(projectId: string, namespace: string): MaybePromise<StoredProject | null>
    listProjectsForUser(namespace: string, userId: number): MaybePromise<StoredProject[]>
    listProjectMembers(projectId: string): MaybePromise<StoredProjectMember[]>
    addProjectMember(projectId: string, userId: number, role: ProjectRole): MaybePromise<StoredProjectMember>
    removeProjectMember(projectId: string, userId: number): MaybePromise<boolean>
    countProjectOwners(projectId: string): MaybePromise<number>
    getProjectMemberRole(projectId: string, userId: number): MaybePromise<ProjectRole | null>
    hasProjectRole(projectId: string, userId: number, role: ProjectRole): MaybePromise<boolean>
    listProjectWorkspaces(projectId: string): MaybePromise<StoredProjectWorkspace[]>
    listProjectWorkspacesForUser(namespace: string, userId: number, requiredRole?: ProjectRole): MaybePromise<StoredProjectWorkspace[]>
    addProjectWorkspace(projectId: string, machineId: string, rootPath: string, createdByUserId: number): MaybePromise<StoredProjectWorkspace>
    removeProjectWorkspace(projectId: string, workspaceId: string): MaybePromise<boolean>
    createProjectInvite(projectId: string, role: ProjectRole, expiresAt: number, createdByUserId: number): MaybePromise<{ invite: StoredProjectInvite; token: string }>
    acceptProjectInvite(token: string, userId: number, namespace: string, now?: number): MaybePromise<AcceptProjectInviteResult>
}

export interface UserStorePort {
    getUser(platform: string, platformUserId: string): MaybePromise<StoredUser | null>
    getUserById(userId: number, namespace: string): MaybePromise<StoredUser | null>
    getLocalUserByUsername(namespace: string, username: string): MaybePromise<StoredUser | null>
    getUserByAccessToken(accessToken: string): MaybePromise<StoredUser | null>
    getUsersByPlatform(platform: string): MaybePromise<StoredUser[]>
    listUsersByNamespace(namespace: string): MaybePromise<StoredUser[]>
    getUsersByPlatformAndNamespace(platform: string, namespace: string): MaybePromise<StoredUser[]>
    addUser(platform: string, platformUserId: string, namespace: string): MaybePromise<StoredUser>
    createLocalUser(input: CreateLocalUserInput): MaybePromise<StoredUser>
    updateUser(userId: number, namespace: string, input: UpdateUserInput): MaybePromise<StoredUser | null>
    updateUserPassword(userId: number, namespace: string, passwordHash: string): MaybePromise<StoredUser | null>
    updateLocalUsername(userId: number, namespace: string, username: string): MaybePromise<UpdateLocalUsernameResult>
    regenerateUserAccessToken(userId: number, namespace: string): MaybePromise<StoredUser | null>
    removeLocalUserById(userId: number, namespace: string, replacementOwnerUserId: number): MaybePromise<StoredUser | null>
    removeUser(platform: string, platformUserId: string): MaybePromise<boolean>
}

export interface AppSettingsStorePort {
    getJson<T>(key: string, fallback: T): MaybePromise<T>
    setJson(key: string, value: unknown, updatedAt?: number): MaybePromise<void>
}

export type CodexImportJobInput = {
    id: string
    namespace: string
    userId?: number
    status: string
    createdAt: number
}

export interface CodexImportJobStorePort {
    listAll(): MaybePromise<StoredCodexImportJobRecord[]>
    save(job: CodexImportJobInput, payload: unknown, updatedAt?: number): MaybePromise<void>
    delete(id: string): MaybePromise<boolean>
    prune(maxRows: number): MaybePromise<void>
}

export type PushSubscriptionInput = {
    endpoint: string
    p256dh: string
    auth: string
}

export interface PushStorePort {
    addPushSubscription(namespace: string, subscription: PushSubscriptionInput): MaybePromise<void>
    removePushSubscription(namespace: string, endpoint: string): MaybePromise<void>
    getPushSubscriptionsByNamespace(namespace: string): MaybePromise<StoredPushSubscription[]>
}

export type FcmDeviceInput = {
    token: string
    platform: 'phone' | 'wear'
    deviceId: string
}

export interface FcmStorePort {
    upsertDevice(namespace: string, device: FcmDeviceInput): MaybePromise<void>
    removeDeviceByToken(namespace: string, token: string): MaybePromise<void>
    getDevicesByNamespace(namespace: string): MaybePromise<StoredFcmDevice[]>
}

export type ScratchlistCreateOptions = {
    entryId?: string
    createdAt?: number
    attachments?: ScratchlistAttachmentMetadata[]
}

export type ScratchlistPatch = {
    text?: string
    attachments?: ScratchlistAttachmentMetadata[]
}

export interface ScratchlistStorePort {
    list(sessionId: string): MaybePromise<StoredScratchlistEntry[]>
    count(sessionId: string): MaybePromise<number>
    get(sessionId: string, entryId: string): MaybePromise<StoredScratchlistEntry | null>
    create(sessionId: string, text: string, options?: ScratchlistCreateOptions): MaybePromise<CreateScratchlistResult>
    update(sessionId: string, entryId: string, patch: ScratchlistPatch): MaybePromise<StoredScratchlistEntry | null>
    sumAttachmentBytes(sessionId: string): MaybePromise<number>
    delete(sessionId: string, entryId: string): MaybePromise<boolean>
    transfer(fromSessionId: string, toSessionId: string): MaybePromise<{ moved: number; collided: number }>
}

export type CoreStores = {
    sessions: SessionStorePort
    machines: MachineStorePort
    users: UserStorePort
    projects: ProjectStorePort
    appSettings: AppSettingsStorePort
    codexImportJobs: CodexImportJobStorePort
    push: PushStorePort
    fcm: FcmStorePort
    scratchlist: ScratchlistStorePort
}
