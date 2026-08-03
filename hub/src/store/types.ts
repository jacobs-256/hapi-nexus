export type StoredSession = {
    id: string
    tag: string | null
    namespace: string
    projectId: string | null
    createdByUserId: number | null
    machineId: string | null
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    agentState: unknown | null
    agentStateVersion: number
    model: string | null
    modelReasoningEffort: string | null
    effort: string | null
    serviceTier: string | null
    todos: unknown | null
    todosUpdatedAt: number | null
    teamState: unknown | null
    teamStateUpdatedAt: number | null
    active: boolean
    activeAt: number | null
    seq: number
}

export type StoredMachine = {
    id: string
    namespace: string
    ownerUserId: number | null
    teamId: string | null
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    runnerState: unknown | null
    runnerStateVersion: number
    active: boolean
    activeAt: number | null
    seq: number
}

export type StoredMessage = {
    id: string
    sessionId: string
    content: unknown
    createdAt: number
    seq: number
    localId: string | null
    invokedAt: number | null
    scheduledAt: number | null
}

export type StoredUser = {
    id: number
    platform: string
    platformUserId: string
    namespace: string
    username: string | null
    usernameNormalized: string | null
    displayName: string | null
    passwordHash: string | null
    accessToken: string | null
    accessTokenHash: string | null
    role: 'admin' | 'user'
    disabledAt: number | null
    createdAt: number
    updatedAt: number | null
}

export type StoredTeam = {
    id: string
    namespace: string
    name: string
    createdByUserId: number | null
    createdAt: number
}

export type StoredTeamMember = {
    teamId: string
    userId: number
    role: 'owner' | 'admin' | 'editor' | 'viewer'
    createdAt: number
}

export type StoredProject = {
    id: string
    namespace: string
    teamId: string
    name: string
    repoUrl: string | null
    createdByUserId: number | null
    createdAt: number
    archivedAt: number | null
}

export type StoredProjectMember = {
    projectId: string
    userId: number
    role: 'owner' | 'admin' | 'editor' | 'viewer'
    createdAt: number
}

export type StoredProjectWorkspace = {
    id: string
    projectId: string
    machineId: string
    rootPath: string
    createdByUserId: number | null
    createdAt: number
}

export type StoredProjectInvite = {
    id: string
    projectId: string
    tokenHash: string
    role: 'owner' | 'admin' | 'editor' | 'viewer'
    expiresAt: number
    createdByUserId: number | null
    createdAt: number
    acceptedAt: number | null
}

export type StoredPushSubscription = {
    id: number
    namespace: string
    endpoint: string
    p256dh: string
    auth: string
    createdAt: number
}

export type StoredFcmDevice = {
    id: number
    namespace: string
    token: string
    platform: 'phone' | 'wear'
    deviceId: string
    createdAt: number
    updatedAt: number
}

export type StoredScratchlistEntry = {
    sessionId: string
    entryId: string
    text: string
    createdAt: number
    updatedAt: number
    attachments: import('@hapi/protocol').ScratchlistAttachmentMetadata[]
}

export type VersionedUpdateResult<T> =
    | { result: 'success'; version: number; value: T }
    | { result: 'version-mismatch'; version: number; value: T }
    | { result: 'error' }
