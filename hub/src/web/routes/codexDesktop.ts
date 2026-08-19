import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir, hostname, platform } from 'node:os'
import { AGENT_MESSAGE_PAYLOAD_TYPE } from '@hapi/protocol'
import type { CodexCollaborationMode } from '@hapi/protocol/types'
import { Hono, type Context } from 'hono'
import type { Machine, SyncEngine, SyncEvent } from '../../sync/syncEngine'
import type { Store, StoredMessage, StoredProject } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import { findWorkspaceForPath, machineAllowsWorkspace } from './workspaceAccess'

type ScriptLogKind = 'sync' | 'restart'

const DIRECT_IMPORT_COMMAND = 'direct-import'
const RESTART_SCRIPT_ENV_NAME = 'HAPI_CODEX_RESTART_SCRIPT'
const RESTART_SCRIPT_DEFAULT_FILE = 'Restart-CodexDesktop.ps1'
const RESTART_SCRIPT_ARGS = ['-Apply']
const RESTART_SCRIPT_MESSAGE = 'Codex Desktop restart script started'

type ScriptLaunchResponse = {
    success: true
    message: string
    pid: number
    command: string
    script?: string
    cwd: string
    output?: string
    codexDesktopRunning?: boolean
    codexClientAvailable?: boolean
    syncedCount?: number
    matchedCount?: number
    sessionIds?: string[]
    hapiSessionIds?: string[]
    latestCodexSessionId?: string
    latestHapiSessionId?: string
} | {
    success: false
    error: string
    script?: string
    cwd: string
    output?: string
    codexDesktopRunning?: boolean
    codexClientAvailable?: boolean
    syncedCount?: number
    matchedCount?: number
    sessionIds?: string[]
    hapiSessionIds?: string[]
    latestCodexSessionId?: string
    latestHapiSessionId?: string
}

type CodexDesktopStatus = {
    running: boolean
    clientAvailable: boolean
}

type CodexDesktopStatusResponse = {
    success: true
    codexDesktopRunning: boolean
    codexClientAvailable: boolean
}

type CodexLocalSessionSummary = {
    id: string
    title: string
    lastUserMessage?: string | null
    cwd?: string | null
    file: string
    modifiedAt: number
    originator?: string | null
    cliVersion?: string | null
    source?: string | null
    threadSource?: string | null
    forkedFromId?: string | null
    imported?: boolean
    hapiSessionIds?: string[]
}

type CodexLocalSessionsResponse = {
    success: true
    sessions: CodexLocalSessionSummary[]
    machineId?: string
} | {
    success: false
    error: string
    sessions: []
    machineId?: string
}

type CodexImportedMessageContent = {
    role: 'user'
    content: {
        type: 'text'
        text: string
    }
    meta: {
        sentFrom: 'cli'
    }
} | {
    role: 'agent'
    content: {
        type: typeof AGENT_MESSAGE_PAYLOAD_TYPE
        data: unknown
    }
    meta: {
        sentFrom: 'cli'
    }
}

type CodexImportedMessageSource = 'event_msg' | 'response_item'
type CodexImportedMessageEntry = {
    source: CodexImportedMessageSource
    message: CodexImportedMessageContent
}

type CodexTranscriptImportData = CodexLocalSessionSummary & {
    messages: CodexImportedMessageContent[]
}

type CodexSessionIndexTitle = {
    threadName: string
    updatedAt: string
}
type RemoteCodexSession = CodexTranscriptImportData

type RemoteCodexSessionMessagePage = CodexTranscriptImportData & {
    totalMessages: number
    offset: number
    hasMore: boolean
    nextOffset: number | null
}

type ImportCandidate = {
    sessionId: string
    active: boolean
    updatedAt: number
    metadata: Record<string, unknown> | null
    projectId: string | null
    persisted: boolean
}

type ImportTargetSelection = {
    sessionId: string | null
    comparablePrefixCount: number
}

type SyncSessionRequestParseResult = {
    sessionIds: string[]
    projectId?: string | null
    cwd?: string | null
    machineId?: string | null
    model?: string | null
    modelReasoningEffort?: string | null
    serviceTier?: string | null
    collaborationMode?: CodexCollaborationMode
    yolo?: boolean
    error?: string
}

type SyncFolderRequestParseResult = Omit<SyncSessionRequestParseResult, 'sessionIds'> & {
    cwd?: string | null
    includeSubdirs: boolean
}

type CodexDuplicateSessionGroup = {
    codexSessionId: string
    hapiSessionIds: string[]
    canonicalSessionId?: string
    removedSessionIds?: string[]
}

type CodexDuplicateSessionsResponse = {
    success: true
    duplicates: CodexDuplicateSessionGroup[]
} | {
    success: false
    error: string
}

type CodexMergeDuplicateSessionsResponse = {
    success: true
    merged: CodexDuplicateSessionGroup[]
    mergedCount: number
} | {
    success: false
    error: string
}

type DuplicateSessionGroupCandidate = {
    codexSessionId: string
    sessions: ImportCandidate[]
}

type CodexImportItemStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'canceled'
type CodexImportJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

type CodexImportJobLog = {
    at: number
    level: 'info' | 'error'
    message: string
    codexSessionId?: string
}

type CodexImportJobItem = {
    codexSessionId: string
    title?: string
    status: CodexImportItemStatus
    totalMessages: number
    messagesToImport: number
    importedMessages: number
    appendedMessages: number
    hapiSessionId?: string
    error?: string
    startedAt?: number
    finishedAt?: number
}

type CodexImportJob = {
    id: string
    namespace: string
    userId?: number
    projectId?: string | null
    cwd?: string | null
    machineId?: string | null
    status: CodexImportJobStatus
    createdAt: number
    startedAt?: number
    finishedAt?: number
    totalItems: number
    completedItems: number
    failedItems: number
    skippedItems: number
    totalMessages: number
    importedMessages: number
    items: CodexImportJobItem[]
    logs: CodexImportJobLog[]
    error?: string
}

type CodexImportJobResponse = {
    success: true
    job: CodexImportJob
} | {
    success: false
    error: string
}

type CodexImportJobsResponse = {
    success: true
    jobs: CodexImportJob[]
} | {
    success: false
    error: string
}

const CODEX_DESKTOP_NOT_FOUND_ERROR = '尝试重启codex客户端失败，未安装/找不到codex客户端'
const SCRIPT_TIMEOUT_ERROR = '执行超时'
const NO_SYNC_SESSION_SELECTED_ERROR = '未选择需要导入的 Codex 会话'
const CODEX_TRANSCRIPT_IMPORT_NAMESPACE_ERROR = 'Codex transcript import is not available outside the default namespace'
const DEFAULT_SCRIPT_TIMEOUT_MS = 60_000
const DEFAULT_CODEX_SESSION_SCAN_LIMIT = 500
const CODEX_IMPORT_CHUNK_SIZE = 200
const CODEX_IMPORT_RPC_MESSAGE_CHUNK_SIZE = 200
const MAX_CODEX_IMPORT_JOBS = 50

function resolveLocalPath(pathValue: string): string {
    return isAbsolute(pathValue) ? pathValue : resolve(process.cwd(), pathValue)
}

function getScriptRoot(): string {
    const configured = process.env.HAPI_CODEX_SCRIPT_ROOT?.trim()
    return configured ? resolveLocalPath(configured) : process.cwd()
}

function getDefaultScriptPath(defaultFile: string): string {
    const configuredRoot = process.env.HAPI_CODEX_SCRIPT_ROOT?.trim()
    if (configuredRoot) {
        return join(resolveLocalPath(configuredRoot), defaultFile)
    }

    const cwd = process.cwd()
    const candidateRoots = [
        cwd,
        resolve(cwd, '..'),
        resolve(cwd, '..', '..')
    ]

    for (const root of candidateRoots) {
        const candidate = join(root, defaultFile)
        if (existsSync(candidate)) {
            return candidate
        }
    }

    return join(getScriptRoot(), defaultFile)
}

function getRestartScriptPath(): string {
    const configured = process.env[RESTART_SCRIPT_ENV_NAME]?.trim()
    return configured ? resolveLocalPath(configured) : getDefaultScriptPath(RESTART_SCRIPT_DEFAULT_FILE)
}

function getWorkspace(scriptPath: string): string {
    const configured = process.env.HAPI_CODEX_WORKSPACE?.trim()
    return configured ? resolveLocalPath(configured) : dirname(scriptPath)
}

function getDirectImportWorkspace(): string {
    const configured = process.env.HAPI_CODEX_WORKSPACE?.trim()
    return configured ? resolveLocalPath(configured) : process.cwd()
}

function expandHomePath(pathValue: string): string {
    return pathValue.replace(/^~(?=$|[\\/])/, homedir())
}

function getCodexHome(): string {
    const configured = process.env.CODEX_HOME?.trim()
    return configured ? resolveLocalPath(expandHomePath(configured)) : join(homedir(), '.codex')
}

function getCodexSessionRoots(): string[] {
    const codexHome = getCodexHome()
    // Direct import only reads transcripts from the active sessions directory; archived_sessions is intentionally excluded.
    return [join(codexHome, 'sessions')]
}

function getCodexSessionIndexPath(): string {
    return join(getCodexHome(), 'session_index.jsonl')
}

function collectJsonlFiles(root: string, files: string[]): void {
    if (!existsSync(root)) return
    let entries
    try {
        entries = readdirSync(root, { withFileTypes: true })
    } catch {
        return
    }

    for (const entry of entries) {
        const fullPath = join(root, entry.name)
        if (entry.isDirectory()) {
            collectJsonlFiles(fullPath, files)
            continue
        }
        if (entry.isFile() && fullPath.toLowerCase().endsWith('.jsonl')) {
            files.push(fullPath)
        }
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

function extractCodexText(value: unknown): string {
    if (typeof value === 'string') {
        return value.trim()
    }
    if (Array.isArray(value)) {
        return value
            .map((item) => {
                const record = asRecord(item)
                if (record?.type === 'text' && typeof record.text === 'string') return record.text
                if (record?.type === 'input_text' && typeof record.text === 'string') return record.text
                if (record?.type === 'output_text' && typeof record.text === 'string') return record.text
                return null
            })
            .filter((part): part is string => Boolean(part))
            .join(' ')
            .trim()
    }
    const record = asRecord(value)
    if (record?.type === 'text' && typeof record.text === 'string') {
        return record.text.trim()
    }
    if (record?.type === 'input_text' && typeof record.text === 'string') {
        return record.text.trim()
    }
    if (record?.type === 'output_text' && typeof record.text === 'string') {
        return record.text.trim()
    }
    return ''
}

function truncateText(value: string, maxLength: number): string {
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

function shouldIgnoreInjectedResponseUserMessage(text: string): boolean {
    const normalized = text.trim()
    const lower = normalized.toLowerCase()
    const isAgentInstructions = lower.startsWith('# agents.md instructions')
    const isEnvironmentContext = lower.startsWith('<environment_context>')
        && lower.endsWith('</environment_context>')
    return isAgentInstructions || isEnvironmentContext
}

function inferSessionIdFromFileName(filePath: string): string | null {
    const match = /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/.exec(filePath)
    return match?.[1] ?? null
}

function parseCodexFunctionArguments(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value
    }

    const trimmed = value.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return value
    }

    try {
        return JSON.parse(trimmed)
    } catch {
        return value
    }
}

function extractCodexToolCallId(payload: Record<string, unknown>): string | null {
    const candidates = ['call_id', 'callId', 'tool_call_id', 'toolCallId', 'id']
    for (const key of candidates) {
        const value = payload[key]
        if (typeof value === 'string' && value.length > 0) {
            return value
        }
    }
    return null
}

function extractCodexChangedTitle(record: Record<string, unknown>): string | null {
    const type = typeof record.type === 'string' ? record.type : null
    if (type === 'response_item') {
        const payload = asRecord(record.payload)
        if (payload?.type === 'function_call' && payload.name === 'change_title') {
            const argumentsText = typeof payload.arguments === 'string' ? payload.arguments : null
            if (!argumentsText) return null
            try {
                const parsedArguments = JSON.parse(argumentsText) as { title?: unknown }
                return typeof parsedArguments.title === 'string' && parsedArguments.title.trim()
                    ? parsedArguments.title.trim()
                    : null
            } catch {
                return null
            }
        }
    }

    if (type === 'event_msg') {
        const payload = asRecord(record.payload)
        if (payload?.type === 'mcp_tool_call_end') {
            const invocation = asRecord(payload.invocation)
            const argumentsRecord = asRecord(invocation?.arguments)
            if (invocation?.tool === 'change_title' && typeof argumentsRecord?.title === 'string' && argumentsRecord.title.trim()) {
                return argumentsRecord.title.trim()
            }
        }
    }

    return null
}

function getLatestCodexChangedTitle(lines: string[]): string | null {
    // Codex records change_title calls in transcripts; use the latest successful title for the dialog heading.
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
            const parsed = JSON.parse(lines[index])
            const record = asRecord(parsed)
            if (!record) continue
            const title = extractCodexChangedTitle(record)
            if (title) {
                return title
            }
        } catch {
            continue
        }
    }
    return null
}

function getLatestCodexUserMessage(lines: string[]): string | null {
    // Show the latest real user prompt as the dialog subtitle so users identify sessions by content, not paths.
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
            const parsed = JSON.parse(lines[index])
            const record = asRecord(parsed)
            if (!record || record.type !== 'response_item') continue
            const payload = asRecord(record.payload)
            if (payload?.type !== 'message' || payload.role !== 'user') continue
            const text = extractCodexText(payload.content)
            if (text && !shouldIgnoreInjectedResponseUserMessage(text)) {
                return truncateText(text, 140)
            }
        } catch {
            continue
        }
    }
    return null
}

function getCodexSessionTitle(
    cwd: string | null | undefined,
    sessionId: string,
    sessionIndexTitle: string | null,
    changedTitle: string | null,
    firstUserMessage: string | null
): string {
    if (sessionIndexTitle) {
        return truncateText(sessionIndexTitle, 80)
    }

    if (changedTitle) {
        return truncateText(changedTitle, 80)
    }

    if (firstUserMessage) {
        return truncateText(firstUserMessage, 80)
    }

    if (cwd) {
        const parts = cwd.split(/[\\/]+/).filter(Boolean)
        if (parts.length > 0) {
            return parts[parts.length - 1]
        }
    }

    return sessionId.slice(0, 8)
}

function isSubagentSource(value: unknown): boolean {
    const record = asRecord(value)
    return record ? Object.prototype.hasOwnProperty.call(record, 'subagent') : false
}

function readCodexSessionIndexTitles(): Map<string, CodexSessionIndexTitle> {
    let content: string
    try {
        content = readFileSync(getCodexSessionIndexPath(), 'utf-8')
    } catch {
        return new Map()
    }

    const titles = new Map<string, CodexSessionIndexTitle>()
    for (const line of content.split(/\r?\n/).filter(Boolean)) {
        let parsed: unknown
        try {
            parsed = JSON.parse(line)
        } catch {
            continue
        }

        const record = asRecord(parsed)
        const id = typeof record?.id === 'string' ? record.id : null
        const threadName = typeof record?.thread_name === 'string' && record.thread_name.trim()
            ? record.thread_name.trim()
            : null
        const updatedAt = typeof record?.updated_at === 'string' && record.updated_at.trim()
            ? record.updated_at.trim()
            : null
        if (!id || !threadName || !updatedAt) {
            continue
        }

        const previous = titles.get(id)
        if (!previous || previous.updatedAt < updatedAt) {
            titles.set(id, { threadName, updatedAt })
        }
    }

    return titles
}

function parseCodexLocalSession(
    filePath: string,
    sessionIndexTitles = new Map<string, CodexSessionIndexTitle>()
): CodexLocalSessionSummary | null {
    let content: string
    try {
        content = readFileSync(filePath, 'utf-8')
    } catch {
        return null
    }

    const allLines = content.split(/\r?\n/).filter(Boolean)
    const headLines = allLines.slice(0, 200)
    let sessionId: string | null = null
    let cwd: string | null = null
    let originator: string | null = null
    let cliVersion: string | null = null
    let firstUserMessage: string | null = null

    for (const line of headLines) {
        let parsed: unknown
        try {
            parsed = JSON.parse(line)
        } catch {
            continue
        }

        const record = asRecord(parsed)
        const type = typeof record?.type === 'string' ? record.type : null
        if (type === 'session_meta') {
            const payload = asRecord(record?.payload)
            if (payload) {
                if (isSubagentSource(payload.source)) {
                    return null
                }
                if (!sessionId && typeof payload.id === 'string') {
                    sessionId = payload.id
                }
                if (!cwd && typeof payload.cwd === 'string') {
                    cwd = payload.cwd
                }
                if (!originator && typeof payload.originator === 'string') {
                    originator = payload.originator
                }
                if (!cliVersion && typeof payload.cli_version === 'string') {
                    cliVersion = payload.cli_version
                }
            }
        }

        if (!firstUserMessage && type === 'response_item') {
            const payload = asRecord(record?.payload)
            if (payload?.type === 'message' && payload.role === 'user') {
                const text = extractCodexText(payload.content)
                if (text && !shouldIgnoreInjectedResponseUserMessage(text)) {
                    firstUserMessage = text
                }
            }
        }
    }

    const changedTitle = getLatestCodexChangedTitle(allLines)
    const lastUserMessage = getLatestCodexUserMessage(allLines)

    sessionId = sessionId ?? inferSessionIdFromFileName(filePath)
    if (!sessionId) return null
    const sessionIndexTitle = sessionIndexTitles.get(sessionId)?.threadName ?? null

    let modifiedAt = Date.now()
    try {
        modifiedAt = statSync(filePath).mtimeMs
    } catch {
        // Fall back to current time if stat fails during a concurrent file change.
    }

    return {
        id: sessionId,
        title: getCodexSessionTitle(cwd, sessionId, sessionIndexTitle, changedTitle, firstUserMessage),
        lastUserMessage,
        cwd,
        file: filePath,
        modifiedAt,
        originator,
        cliVersion
    }
}

function listLocalCodexSessions(limit = DEFAULT_CODEX_SESSION_SCAN_LIMIT): CodexLocalSessionSummary[] {
    const files: string[] = []
    for (const root of getCodexSessionRoots()) {
        collectJsonlFiles(root, files)
    }

    const sessionIndexTitles = readCodexSessionIndexTitles()
    const deduped = new Map<string, CodexLocalSessionSummary>()
    for (const filePath of files) {
        const session = parseCodexLocalSession(filePath, sessionIndexTitles)
        if (!session) continue
        const previous = deduped.get(session.id)
        if (!previous || previous.modifiedAt < session.modifiedAt) {
            deduped.set(session.id, session)
        }
    }

    return Array.from(deduped.values())
        .sort((a, b) => b.modifiedAt - a.modifiedAt)
        .slice(0, limit)
}

function buildImportedUserMessage(text: string): CodexImportedMessageContent {
    return {
        role: 'user',
        content: {
            type: 'text',
            text
        },
        meta: {
            sentFrom: 'cli'
        }
    }
}

function buildImportedAgentMessage(data: unknown): CodexImportedMessageContent {
    return {
        role: 'agent',
        content: {
            type: AGENT_MESSAGE_PAYLOAD_TYPE,
            data
        },
        meta: {
            sentFrom: 'cli'
        }
    }
}

function convertCodexRecordToImportedMessage(record: Record<string, unknown>): CodexImportedMessageContent | null {
    const type = asString(record.type)
    const payload = asRecord(record.payload)
    if (!type || !payload) {
        return null
    }

    if (type === 'event_msg') {
        const eventType = asString(payload.type)
        if (!eventType) {
            return null
        }

        if (eventType === 'user_message') {
            const text = asString(payload.message)
                ?? asString(payload.text)
                ?? asString(payload.content)
            if (!text) {
                return null
            }
            return buildImportedUserMessage(text)
        }

        if (eventType === 'agent_message') {
            const message = asString(payload.message)
            return message ? buildImportedAgentMessage({ type: 'message', message, id: randomUUID() }) : null
        }

        if (eventType === 'agent_reasoning') {
            const message = asString(payload.text) ?? asString(payload.message)
            return message ? buildImportedAgentMessage({ type: 'reasoning', message, id: randomUUID() }) : null
        }

        if (eventType === 'agent_reasoning_delta') {
            const delta = asString(payload.delta) ?? asString(payload.text) ?? asString(payload.message)
            return delta ? buildImportedAgentMessage({ type: 'reasoning-delta', delta }) : null
        }

        if (eventType === 'token_count') {
            const info = asRecord(payload.info)
            return info ? buildImportedAgentMessage({ type: 'token_count', info, id: randomUUID() }) : null
        }

        return null
    }

    if (type === 'response_item') {
        const itemType = asString(payload.type)
        if (!itemType) {
            return null
        }

        if (itemType === 'message') {
            const role = asString(payload.role)
            const text = extractCodexText(payload.content)
            if (!text) {
                return null
            }
            if (role === 'user') {
                return shouldIgnoreInjectedResponseUserMessage(text) ? null : buildImportedUserMessage(text)
            }
            if (role === 'assistant') {
                return buildImportedAgentMessage({ type: 'message', message: text, id: randomUUID() })
            }
            return null
        }

        if (itemType === 'function_call') {
            const name = asString(payload.name)
            const callId = extractCodexToolCallId(payload)
            if (!name || !callId) {
                return null
            }
            return buildImportedAgentMessage({
                type: 'tool-call',
                name,
                callId,
                input: parseCodexFunctionArguments(payload.arguments),
                id: randomUUID()
            })
        }

        if (itemType === 'function_call_output') {
            const callId = extractCodexToolCallId(payload)
            if (!callId) {
                return null
            }
            return buildImportedAgentMessage({
                type: 'tool-call-result',
                callId,
                output: payload.output,
                id: randomUUID()
            })
        }
    }

    return null
}

function getCodexImportedMessageSource(record: Record<string, unknown>): CodexImportedMessageSource | null {
    const type = asString(record.type)
    return type === 'event_msg' || type === 'response_item' ? type : null
}

function normalizeComparableUserMessage(content: unknown): string | null {
    const record = asRecord(content)
    if (!record || record.role !== 'user') {
        return null
    }

    const body = asRecord(record.content)
    if (body?.type !== 'text' || typeof body.text !== 'string') {
        return null
    }

    return stableSerialize({
        role: 'user',
        text: body.text.trimEnd()
    })
}

function normalizeComparableAgentMessage(content: unknown): string | null {
    const record = asRecord(content)
    if (!record || record.role !== 'agent') {
        return null
    }

    const body = asRecord(record.content)
    if (!body || body.type !== AGENT_MESSAGE_PAYLOAD_TYPE) {
        return null
    }

    const data = asRecord(body.data)
    if (data?.type !== 'message' || typeof data.message !== 'string') {
        return null
    }

    return stableSerialize({
        role: 'agent',
        type: 'message',
        message: data.message
    })
}

function normalizeAdjacentDuplicateMessage(content: unknown): string | null {
    return normalizeComparableUserMessage(content) ?? normalizeComparableAgentMessage(content)
}

function isAdjacentDuplicateImportedMessage(
    previous: CodexImportedMessageContent,
    next: CodexImportedMessageContent
): boolean {
    const previousKey = normalizeAdjacentDuplicateMessage(previous)
    const nextKey = normalizeAdjacentDuplicateMessage(next)
    return previousKey !== null && previousKey === nextKey
}

function isMirroredAdjacentDuplicate(
    previous: CodexImportedMessageEntry | undefined,
    next: CodexImportedMessageEntry
): boolean {
    return Boolean(
        previous
        && previous.source !== next.source
        && isAdjacentDuplicateImportedMessage(previous.message, next.message)
    )
}

function isResponseItemDuplicateOfEventUserMessage(
    entry: CodexImportedMessageEntry,
    recentEventUserMessageKey: string | null
): boolean {
    if (entry.source !== 'response_item' || recentEventUserMessageKey === null) {
        return false
    }

    return normalizeComparableUserMessage(entry.message) === recentEventUserMessageKey
}

function parseCodexTranscriptImportData(summary: CodexLocalSessionSummary): CodexTranscriptImportData | null {
    let content: string
    try {
        content = readFileSync(summary.file, 'utf-8')
    } catch {
        return null
    }

    const lines = content.split(/\r?\n/).filter(Boolean)
    const entries: CodexImportedMessageEntry[] = []
    let recentEventUserMessageKey: string | null = null

    for (const line of lines) {
        let parsed: unknown
        try {
            parsed = JSON.parse(line)
        } catch {
            continue
        }

        const record = asRecord(parsed)
        if (!record) continue
        const source = getCodexImportedMessageSource(record)
        if (!source) continue
        const message = convertCodexRecordToImportedMessage(record)
        if (message) {
            const entry = { source, message }
            const userMessageKey = normalizeComparableUserMessage(message)
            if (source === 'event_msg' && userMessageKey !== null) {
                const previous = entries[entries.length - 1]
                if (previous?.source === 'response_item' && isMirroredAdjacentDuplicate(previous, entry)) {
                    entries[entries.length - 1] = entry
                } else {
                    entries.push(entry)
                }
                recentEventUserMessageKey = userMessageKey
                continue
            }
            if (isResponseItemDuplicateOfEventUserMessage(entry, recentEventUserMessageKey)) {
                continue
            }
            const previous = entries[entries.length - 1]
            if (isMirroredAdjacentDuplicate(previous, entry)) {
                recentEventUserMessageKey = null
                continue
            }
            entries.push(entry)
            recentEventUserMessageKey = null
        }
    }

    return {
        ...summary,
        messages: entries.map((entry) => entry.message)
    }
}

function normalizeComparablePath(pathValue: string, options?: { caseInsensitive?: boolean }): string {
    let normalized = pathValue.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
    if (normalized.length > 1) {
        normalized = normalized.replace(/\/+$/, '')
    }
    return options?.caseInsensitive ? normalized.toLowerCase() : normalized
}

function shouldCompareCaseInsensitive(...pathValues: string[]): boolean {
    return pathValues.some((pathValue) => /^[a-z]:[\\/]/i.test(pathValue) || pathValue.includes('\\'))
}

function isPathInsideWorkspaceRoot(pathValue: string, rootValue: string): boolean {
    if (!pathValue.trim() || !rootValue.trim()) {
        return false
    }

    const caseInsensitive = shouldCompareCaseInsensitive(pathValue, rootValue)
    const path = normalizeComparablePath(pathValue, { caseInsensitive })
    const root = normalizeComparablePath(rootValue, { caseInsensitive })
    if (!path || !root) {
        return false
    }
    if (path === root) {
        return true
    }
    if (root === '/') {
        return path.startsWith('/')
    }
    return path.startsWith(`${root}/`)
}

function machineOwnsCodexCwd(machine: Machine, cwd: string): boolean {
    const workspaceRoots = machine.metadata?.workspaceRoots ?? []
    return workspaceRoots.some((workspaceRoot) => isPathInsideWorkspaceRoot(cwd, workspaceRoot))
}

function resolveImportMachineId(
    cwd: string | null | undefined,
    namespace: string,
    engine: SyncEngine | null
): string | undefined {
    if (!cwd || !engine) {
        return undefined
    }

    const matches = engine.getOnlineMachinesByNamespace(namespace)
        .filter((machine) => machineOwnsCodexCwd(machine, cwd))
    const machineIds = Array.from(new Set(matches.map((machine) => machine.id)))
    return machineIds.length === 1 ? machineIds[0] : undefined
}


function resolveCodexImportMachineId(
    cwd: string | null | undefined,
    namespace: string,
    engine: SyncEngine | null,
    requestedMachineId?: string | null
): string | null {
    if (!engine) return null
    const onlineMachines = engine.getOnlineMachinesByNamespace(namespace)
    if (requestedMachineId) {
        return onlineMachines.some((machine) => machine.id === requestedMachineId)
            ? requestedMachineId
            : null
    }
    if (cwd) {
        const resolved = resolveImportMachineId(cwd, namespace, engine)
        if (resolved) return resolved
    }
    return onlineMachines.length === 1 ? onlineMachines[0].id : null
}

function asRemoteCodexSessions(value: unknown, requireMessages: boolean): RemoteCodexSession[] {
    if (!Array.isArray(value)) return []
    return value.filter((session): session is RemoteCodexSession => {
        const record = asRecord(session)
        return typeof record?.id === 'string'
            && typeof record.title === 'string'
            && typeof record.file === 'string'
            && typeof record.modifiedAt === 'number'
            && (!requireMessages || Array.isArray(record.messages))
    })
}

function asRemoteCodexSessionMessagePage(value: unknown): RemoteCodexSessionMessagePage | null {
    const record = asRecord(value)
    if (
        typeof record?.id !== 'string'
        || typeof record.title !== 'string'
        || typeof record.file !== 'string'
        || typeof record.modifiedAt !== 'number'
        || !Array.isArray(record.messages)
        || typeof record.totalMessages !== 'number'
        || typeof record.offset !== 'number'
        || typeof record.hasMore !== 'boolean'
        || !(record.nextOffset === null || typeof record.nextOffset === 'number')
    ) {
        return null
    }
    return record as RemoteCodexSessionMessagePage
}

async function listCodexSessionsViaMachine(options: {
    engine: SyncEngine | null
    namespace: string
    cwd?: string | null
    machineId?: string | null
    sessionIds?: string[]
}): Promise<{ sessions: RemoteCodexSession[]; machineId?: string; error?: string }> {
    const machineId = resolveCodexImportMachineId(options.cwd, options.namespace, options.engine, options.machineId)
    if (!machineId || !options.engine) {
        return { sessions: [], error: 'No online machine available for Codex history import' }
    }
    const result = await options.engine.listCodexSessionsForMachine(machineId, options.cwd, options.sessionIds)
    if (!result || typeof result !== 'object') {
        return { sessions: [], machineId, error: 'Unexpected Codex sessions RPC response' }
    }
    if ((result as { success?: unknown }).success !== true) {
        return { sessions: [], machineId, error: typeof (result as { error?: unknown }).error === 'string' ? (result as { error: string }).error : 'Failed to list local Codex sessions' }
    }
    return { sessions: asRemoteCodexSessions((result as { sessions?: unknown }).sessions, Boolean(options.sessionIds?.length)), machineId }
}

async function fetchCodexTranscriptViaMachine(options: {
    engine: SyncEngine | null
    namespace: string
    cwd?: string | null
    machineId?: string | null
    sessionId: string
}): Promise<{ session?: RemoteCodexSession; machineId?: string; error?: string }> {
    const machineId = resolveCodexImportMachineId(options.cwd, options.namespace, options.engine, options.machineId)
    if (!machineId || !options.engine) {
        return { error: 'No online machine available for Codex history import' }
    }

    const engineWithPages = options.engine as SyncEngine & {
        getCodexSessionMessagesForMachine?: (
            machineId: string,
            sessionId: string,
            offset: number,
            limit: number
        ) => Promise<unknown>
    }
    if (typeof engineWithPages.getCodexSessionMessagesForMachine !== 'function') {
        const legacy = await listCodexSessionsViaMachine({
            engine: options.engine,
            namespace: options.namespace,
            cwd: options.cwd,
            machineId,
            sessionIds: [options.sessionId]
        })
        return {
            session: legacy.sessions.find((session) => session.id === options.sessionId),
            machineId: legacy.machineId,
            error: legacy.error
        }
    }

    const messages: CodexImportedMessageContent[] = []
    let summary: CodexLocalSessionSummary | null = null
    let offset = 0
    while (true) {
        const result = await engineWithPages.getCodexSessionMessagesForMachine(
            machineId,
            options.sessionId,
            offset,
            CODEX_IMPORT_RPC_MESSAGE_CHUNK_SIZE
        )
        if (!result || typeof result !== 'object') {
            return { machineId, error: 'Unexpected Codex session messages RPC response' }
        }
        if ((result as { success?: unknown }).success !== true) {
            return {
                machineId,
                error: typeof (result as { error?: unknown }).error === 'string'
                    ? (result as { error: string }).error
                    : 'Failed to read local Codex session messages'
            }
        }

        const page = asRemoteCodexSessionMessagePage((result as { session?: unknown }).session)
        if (!page || page.id !== options.sessionId) {
            return { machineId, error: 'Unexpected Codex session messages RPC payload' }
        }
        if (!summary) {
            const {
                messages: _messages,
                totalMessages: _totalMessages,
                offset: _offset,
                hasMore: _hasMore,
                nextOffset: _nextOffset,
                ...pageSummary
            } = page
            summary = pageSummary
        }
        messages.push(...page.messages)

        if (!page.hasMore || page.nextOffset === null) {
            break
        }
        if (page.nextOffset <= offset) {
            return { machineId, error: 'Invalid Codex session messages pagination state' }
        }
        offset = page.nextOffset
    }

    if (!summary) {
        return { machineId, error: `Transcript not found for Codex session: ${options.sessionId}` }
    }

    return {
        machineId,
        session: {
            ...summary,
            messages
        }
    }
}

async function fetchCodexTranscriptsViaMachine(options: {
    engine: SyncEngine | null
    namespace: string
    cwd?: string | null
    machineId?: string | null
    sessionIds: string[]
}): Promise<{ sessions: RemoteCodexSession[]; machineId?: string; error?: string }> {
    const engineWithPages = options.engine as (SyncEngine & { getCodexSessionMessagesForMachine?: unknown }) | null
    if (options.engine && typeof engineWithPages?.getCodexSessionMessagesForMachine !== 'function') {
        return listCodexSessionsViaMachine(options)
    }

    const sessions: RemoteCodexSession[] = []
    let resolvedMachineId = options.machineId ?? null
    for (const sessionId of options.sessionIds) {
        const result = await fetchCodexTranscriptViaMachine({
            engine: options.engine,
            namespace: options.namespace,
            cwd: options.cwd,
            machineId: resolvedMachineId,
            sessionId
        })
        if (result.error) {
            return { sessions, machineId: result.machineId ?? resolvedMachineId ?? undefined, error: result.error }
        }
        if (result.machineId) {
            resolvedMachineId = result.machineId
        }
        if (result.session) {
            sessions.push(result.session)
        }
    }
    return { sessions, machineId: resolvedMachineId ?? undefined }
}

function buildImportedSessionMetadata(
    data: CodexTranscriptImportData,
    existingMetadata?: Record<string, unknown> | null,
    resolvedMachineId?: string,
    permissionMode?: string
): Record<string, unknown> {
    const now = Date.now()
    const path = data.cwd ?? (typeof existingMetadata?.path === 'string' ? existingMetadata.path : dirname(data.file))
    const host = typeof existingMetadata?.host === 'string' ? existingMetadata.host : (process.env.HAPI_HOSTNAME || hostname())
    const osValue = typeof existingMetadata?.os === 'string' ? existingMetadata.os : platform()
    const summaryText = data.lastUserMessage ?? data.title
    const machineId = typeof existingMetadata?.machineId === 'string'
        ? existingMetadata.machineId
        : resolvedMachineId
    const currentCodexSessionId = typeof existingMetadata?.codexSessionId === 'string'
        ? existingMetadata.codexSessionId
        : data.id

    return {
        ...(existingMetadata ?? {}),
        path,
        host,
        os: osValue,
        name: data.title,
        summary: summaryText
            ? {
                text: summaryText,
                updatedAt: now
            }
            : existingMetadata?.summary,
        flavor: 'codex',
        codexSessionId: currentCodexSessionId,
        codexSourceSessionId: typeof existingMetadata?.codexSourceSessionId === 'string'
            ? existingMetadata.codexSourceSessionId
            : data.id,
        ...(permissionMode ? { preferredPermissionMode: permissionMode } : {}),
        ...(machineId ? { machineId } : {}),
        lifecycleState: typeof existingMetadata?.lifecycleState === 'string'
            ? existingMetadata.lifecycleState
            : 'imported',
        lifecycleStateSince: typeof existingMetadata?.lifecycleStateSince === 'number'
            ? existingMetadata.lifecycleStateSince
            : now
    }
}

function stableSerialize(value: unknown): string {
    if (value === null || value === undefined) {
        return String(value)
    }
    if (typeof value === 'string') {
        return JSON.stringify(value)
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return JSON.stringify(value)
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableSerialize(item)).join(',')}]`
    }
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>
        const keys = Object.keys(record).sort()
        return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`
    }
    return JSON.stringify(value)
}

function normalizeComparableText(value: string): string {
    return value.replace(/\s+$/u, '')
}

function normalizeComparableAgentData(value: unknown): unknown {
    const record = asRecord(value)
    if (!record) {
        return value
    }

    const normalized = { ...record }
    if ('id' in normalized) {
        delete normalized.id
    }
    return normalized
}

function normalizeComparableContent(content: unknown): string | null {
    const record = asRecord(content)
    if (!record) {
        return null
    }

    if (record.role === 'user') {
        const body = asRecord(record.content)
        if (body?.type !== 'text' || typeof body.text !== 'string') {
            return null
        }
        return stableSerialize({
            role: 'user',
            text: normalizeComparableText(body.text)
        })
    }

    if (record.role === 'agent') {
        const body = asRecord(record.content)
        if (!body || body.type !== AGENT_MESSAGE_PAYLOAD_TYPE) {
            return null
        }
        return stableSerialize({
            role: 'agent',
            data: normalizeComparableAgentData(body.data)
        })
    }

    return null
}

function getComparableStoredMessageKey(message: StoredMessage): string {
    // During duplicate-session merge, prefer structured user/agent de-duplication and fall back to stable serialization for non-standard messages.
    return normalizeComparableContent(message.content) ?? stableSerialize(message.content)
}

async function getStoredMessagesInImportOrder(store: Store, sessionId: string): Promise<StoredMessage[]> {
    const messages = store.messages.getAllMessagesAsync
        ? await store.messages.getAllMessagesAsync(sessionId)
        : store.messages.getAllMessages(sessionId)
    return messages
        .slice()
        .sort((a, b) => {
            const aAt = a.invokedAt ?? a.createdAt
            const bAt = b.invokedAt ?? b.createdAt
            if (aAt !== bAt) return aAt - bAt
            return a.seq - b.seq
        })
}

async function collectImportCandidates(
    store: Store,
    namespace: string,
    getSyncEngine?: () => SyncEngine | null,
    userId?: number
): Promise<ImportCandidate[]> {
    const candidatesBySessionId = new Map<string, ImportCandidate>()
    for (const session of await store.sessions.getSessionsByNamespace(namespace)) {
        if (typeof userId === 'number' && (!session.projectId || !await store.projects.hasProjectRole(session.projectId, userId, 'viewer'))) {
            continue
        }
        candidatesBySessionId.set(session.id, {
            sessionId: session.id,
            active: session.active,
            updatedAt: session.updatedAt,
            metadata: asRecord(session.metadata),
            projectId: session.projectId,
            persisted: true
        })
    }

    const engineSessions = getSyncEngine?.()?.getSessionsByNamespace(namespace) ?? []
    for (const session of engineSessions) {
        if (typeof userId === 'number' && (!session.projectId || !await store.projects.hasProjectRole(session.projectId, userId, 'viewer'))) {
            continue
        }
        const existing = candidatesBySessionId.get(session.id)
        candidatesBySessionId.set(session.id, {
            sessionId: session.id,
            active: session.active || Boolean(existing?.active),
            updatedAt: Math.max(session.updatedAt, existing?.updatedAt ?? 0),
            metadata: asRecord(session.metadata) ?? existing?.metadata ?? null,
            projectId: session.projectId ?? existing?.projectId ?? null,
            persisted: Boolean(existing?.persisted)
        })
    }

    return Array.from(candidatesBySessionId.values())
}

function getCodexImportIds(metadata: Record<string, unknown> | null | undefined): string[] {
    return Array.from(new Set([metadata?.codexSessionId, metadata?.codexSourceSessionId]
        .filter((id): id is string => typeof id === 'string' && id.length > 0)))
}

async function listImportedCodexSessionMatches(options: {
    store: Store
    namespace: string
    machineId?: string | null
    getSyncEngine?: () => SyncEngine | null
    userId?: number
}): Promise<Map<string, string[]>> {
    const matches = new Map<string, string[]>()

    for (const candidate of await collectImportCandidates(options.store, options.namespace, options.getSyncEngine, options.userId)) {
        if (!candidate.persisted || !isImportCandidateReusable(candidate)) {
            continue
        }
        const candidateMachineId = typeof candidate.metadata?.machineId === 'string'
            ? candidate.metadata.machineId
            : null
        if (options.machineId && candidateMachineId && candidateMachineId !== options.machineId) {
            continue
        }

        for (const codexSessionId of getCodexImportIds(candidate.metadata)) {
            const current = matches.get(codexSessionId) ?? []
            if (!current.includes(candidate.sessionId)) {
                current.push(candidate.sessionId)
            }
            matches.set(codexSessionId, current)
        }
    }

    return matches
}

function isImportCandidateReusable(candidate: ImportCandidate): boolean {
    const lifecycleState = candidate.metadata?.lifecycleState
    if (lifecycleState === 'archived' || lifecycleState === 'deleted') {
        return false
    }
    return true
}

async function selectImportTargetSession(
    store: Store,
    candidates: ImportCandidate[],
    codexSessionId: string,
    importedComparableMessages: string[],
    sourceMachineId?: string | null
): Promise<ImportTargetSelection> {
    const relatedCandidates = candidates
        .filter((candidate) => candidate.persisted && isImportCandidateReusable(candidate))
        .filter((candidate) => (
            candidate.metadata?.codexSessionId === codexSessionId
            || candidate.metadata?.codexSourceSessionId === codexSessionId
        ))
        .filter((candidate) => (
            !sourceMachineId
            || typeof candidate.metadata?.machineId !== 'string'
            || candidate.metadata.machineId === sourceMachineId
        ))
        .sort((a, b) => b.updatedAt - a.updatedAt)

    let bestSessionId: string | null = null
    let bestPrefixCount = -1

    for (const candidate of relatedCandidates) {
        const comparableMessages = (await getStoredMessagesInImportOrder(store, candidate.sessionId))
            .map((message) => normalizeComparableContent(message.content))
            .filter((value): value is string => value !== null)

        if (comparableMessages.length > importedComparableMessages.length) {
            continue
        }

        let prefixMatches = true
        for (let index = 0; index < comparableMessages.length; index += 1) {
            if (comparableMessages[index] !== importedComparableMessages[index]) {
                prefixMatches = false
                break
            }
        }

        if (!prefixMatches) {
            continue
        }

        if (comparableMessages.length > bestPrefixCount) {
            bestPrefixCount = comparableMessages.length
            bestSessionId = candidate.sessionId
        }
    }

    return {
        sessionId: bestSessionId,
        comparablePrefixCount: Math.max(0, bestPrefixCount)
    }
}

async function resolveImportProject(
    store: Store,
    namespace: string,
    userId: number | undefined,
    projectId?: string | null
): Promise<StoredProject | null> {
    if (typeof userId !== 'number') {
        return null
    }
    if (projectId) {
        const project = await store.projects.getProjectByNamespace(projectId, namespace)
        if (!project || project.archivedAt !== null) {
            throw new Error('Project not found')
        }
        if (!await store.projects.hasProjectRole(project.id, userId, 'editor')) {
            throw new Error('Project access denied')
        }
        return project
    }
    for (const project of await store.projects.listProjectsForUser(namespace, userId)) {
        if (await store.projects.hasProjectRole(project.id, userId, 'editor')) {
            return project
        }
    }
    return null
}

async function ensureImportedProjectDirectory(options: {
    engine: SyncEngine | null
    namespace: string
    userId?: number
    project: StoredProject | null
    machineId: unknown
    cwd: string | null | undefined
}): Promise<void> {
    if (
        !options.engine
        || typeof options.userId !== 'number'
        || !options.project
        || typeof options.machineId !== 'string'
        || !options.cwd
    ) {
        return
    }
    const machine = options.engine.getMachineByNamespace(options.machineId, options.namespace)
    if (!machine || machine.ownerUserId !== options.userId || !machineAllowsWorkspace(machine, options.cwd)) {
        return
    }
    const existingWorkspace = findWorkspaceForPath(
        machine,
        await options.engine.listProjectWorkspacesAsync(options.project.id),
        options.cwd
    )
    if (!existingWorkspace) {
        await options.engine.addProjectWorkspaceAsync(options.project.id, machine.id, options.cwd, options.userId)
    }
}

async function listDuplicateCodexSessionGroups(
    store: Store,
    namespace: string,
    codexSessionIds: string[],
    getSyncEngine?: () => SyncEngine | null,
    userId?: number
): Promise<DuplicateSessionGroupCandidate[]> {
    const requestedSessionIds = new Set(codexSessionIds)
    if (requestedSessionIds.size === 0) {
        return []
    }

    const groups = new Map<string, ImportCandidate[]>()
    for (const candidate of await collectImportCandidates(store, namespace, getSyncEngine, userId)) {
        if (!candidate.persisted || !isImportCandidateReusable(candidate)) {
            continue
        }
        for (const codexSessionId of getCodexImportIds(candidate.metadata)) {
            if (!requestedSessionIds.has(codexSessionId)) {
                continue
            }

            const existing = groups.get(codexSessionId)
            if (existing) {
                existing.push(candidate)
            } else {
                groups.set(codexSessionId, [candidate])
            }
        }
    }

    return Array.from(groups.entries())
        .map(([codexSessionId, sessions]) => ({
            codexSessionId,
            sessions: sessions.sort((a, b) => b.updatedAt - a.updatedAt)
        }))
        .filter((group) => group.sessions.length > 1)
}

async function mergeDuplicateCodexSessionGroups(options: {
    store: Store
    namespace: string
    codexSessionIds: string[]
    getSyncEngine?: () => SyncEngine | null
    userId?: number
}): Promise<CodexMergeDuplicateSessionsResponse> {
    const groups = await listDuplicateCodexSessionGroups(
        options.store,
        options.namespace,
        options.codexSessionIds,
        options.getSyncEngine,
        options.userId
    )
    if (groups.length === 0) {
        return {
            success: true,
            merged: [],
            mergedCount: 0
        }
    }

    const merged: CodexDuplicateSessionGroup[] = []
    for (const group of groups) {
        const result = await mergeSingleDuplicateCodexSessionGroup({
            group,
            store: options.store,
            namespace: options.namespace,
            getSyncEngine: options.getSyncEngine
        })
        merged.push(result)
    }

    return {
        success: true,
        merged,
        mergedCount: merged.length
    }
}

async function mergeSingleDuplicateCodexSessionGroup(options: {
    group: DuplicateSessionGroupCandidate
    store: Store
    namespace: string
    userId?: number
    getSyncEngine?: () => SyncEngine | null
}): Promise<CodexDuplicateSessionGroup> {
    const engine = options.getSyncEngine?.() ?? null
    const uniqueSessions = Array.from(new Map(options.group.sessions.map((session) => [session.sessionId, session])).values())
    const sessionStates = (await Promise.all(uniqueSessions
        .map(async (candidate) => ({
            ...candidate,
            storedMessages: options.store.messages.getAllMessagesAsync
                ? await options.store.messages.getAllMessagesAsync(candidate.sessionId)
                : options.store.messages.getAllMessages(candidate.sessionId),
        }))))
        .map((candidate) => ({
            ...candidate,
            comparableKeys: candidate.storedMessages.map((message) => getComparableStoredMessageKey(message))
        }))
        .sort((a, b) => {
            if (b.comparableKeys.length !== a.comparableKeys.length) {
                return b.comparableKeys.length - a.comparableKeys.length
            }
            if (b.updatedAt !== a.updatedAt) {
                return b.updatedAt - a.updatedAt
            }
            return a.sessionId.localeCompare(b.sessionId)
        })

    if (sessionStates.some((candidate) => candidate.active)) {
        throw new Error('当前会话仍处于活跃状态，请等待会话结束后重试')
    }

    const canonical = sessionStates[0]
    if (!canonical) {
        throw new Error(`No duplicate Hapi session found for Codex thread: ${options.group.codexSessionId}`)
    }

    const knownKeys = new Set(canonical.comparableKeys)
    const removedSessionIds: string[] = []
    const appendedMessages: StoredMessage[] = []
    let latestActivity = canonical.updatedAt

    for (const source of sessionStates.slice(1)) {
        latestActivity = Math.max(latestActivity, source.updatedAt)
        for (const message of source.storedMessages) {
            const comparableKey = getComparableStoredMessageKey(message)
            if (knownKeys.has(comparableKey)) {
                continue
            }

            const messageInput = {
                content: message.content,
                createdAt: message.createdAt,
                localId: message.localId,
                invokedAt: message.invokedAt,
                scheduledAt: message.scheduledAt
            }
            const copied = options.store.messages.copyMessageToSessionAsync
                ? await options.store.messages.copyMessageToSessionAsync(canonical.sessionId, messageInput)
                : options.store.messages.copyMessageToSession(canonical.sessionId, messageInput)
            knownKeys.add(comparableKey)
            appendedMessages.push(copied)
            latestActivity = Math.max(latestActivity, copied.invokedAt ?? copied.createdAt)
        }

        if (engine) {
            await engine.deleteSession(source.sessionId)
        } else {
            const deleted = await options.store.sessions.deleteSession(source.sessionId, options.namespace)
            if (!deleted) {
                throw new Error(`Failed to delete duplicate Hapi session: ${source.sessionId}`)
            }
        }
        removedSessionIds.push(source.sessionId)
    }

    if (appendedMessages.length > 0) {
        emitImportedMessageEvents(engine, canonical.sessionId, appendedMessages)
    }

    if (engine) {
        engine.recordSessionActivity(canonical.sessionId, latestActivity)
        // Refresh the canonical session even when only duplicate siblings were removed so the list converges immediately.
        engine.handleRealtimeEvent({
            type: 'session-updated',
            sessionId: canonical.sessionId
        })
    } else {
        await options.store.sessions.touchSessionUpdatedAt(canonical.sessionId, latestActivity, options.namespace)
    }

    return {
        codexSessionId: options.group.codexSessionId,
        hapiSessionIds: sessionStates.map((candidate) => candidate.sessionId),
        canonicalSessionId: canonical.sessionId,
        removedSessionIds
    }
}

function emitImportedMessageEvents(
    engine: SyncEngine | null,
    sessionId: string,
    appendedMessages: StoredMessage[]
): void {
    if (!engine) {
        return
    }

    // Broadcast appended messages only when importing into an existing HAPI session so the open chat view refreshes immediately.
    for (const message of appendedMessages) {
        engine.handleRealtimeEvent({
            type: 'message-received',
            sessionId,
            message: {
                id: message.id,
                seq: message.seq,
                localId: message.localId ?? null,
                content: message.content,
                createdAt: message.createdAt,
                invokedAt: message.invokedAt
            }
        })
    }
}

function getPathExts(): string[] {
    if (process.platform !== 'win32') {
        return ['']
    }
    const fromEnv = (process.env.PATHEXT ?? '')
        .split(';')
        .map(ext => ext.trim().toLowerCase())
        .filter(Boolean)
    return Array.from(new Set(['', '.exe', '.cmd', '.bat', '.ps1', ...fromEnv]))
}

function findOnPath(commandName: string): string | null {
    if (commandName.includes('\\') || commandName.includes('/')) {
        return existsSync(commandName) ? commandName : null
    }

    const pathDirs = (process.env.PATH ?? '')
        .split(process.platform === 'win32' ? ';' : ':')
        .map(part => part.trim())
        .filter(Boolean)
    const extensions = getPathExts()

    for (const dir of pathDirs) {
        for (const ext of extensions) {
            const candidate = join(dir, commandName.endsWith(ext) ? commandName : `${commandName}${ext}`)
            if (existsSync(candidate)) {
                return candidate
            }
        }
    }

    return null
}

function getCodexLauncherCandidates(): string[] {
    return [
        process.env.HAPI_CODEX_COMMAND?.trim() ?? '',
        findOnPath('codex') ?? '',
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'codex.exe') : ''
    ].filter(Boolean)
}

function isCodexLauncherAvailable(): boolean {
    return getCodexLauncherCandidates().some(candidate => {
        try {
            return existsSync(candidate)
        } catch {
            return false
        }
    })
}

function isCodexDesktopPath(pathValue: string): boolean {
    return /\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\(?:Codex|resources\\codex)\.exe$/i.test(pathValue)
}

function isCodexDesktopPackageInstalled(): boolean {
    if (process.platform !== 'win32') {
        return false
    }

    const command = [
        "$package = Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue",
        "if ($package) { 'true' } else { 'false' }"
    ].join('\n')

    for (const shell of ['pwsh', 'powershell.exe']) {
        try {
            const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-Command', command], {
                encoding: 'utf-8',
                timeout: 5000,
                windowsHide: true
            })
            if (result.status === 0) {
                return result.stdout.trim().toLowerCase().includes('true')
            }
        } catch {
            // Try next shell.
        }
    }

    return false
}

function isCodexDesktopInstallAvailable(): boolean {
    if (process.platform !== 'win32') {
        return isCodexLauncherAvailable()
    }

    if (isCodexDesktopPackageInstalled()) {
        return true
    }

    return getCodexLauncherCandidates().some(candidate => {
        try {
            return isCodexDesktopPath(candidate) && existsSync(candidate)
        } catch {
            return false
        }
    })
}

function isCodexDesktopRunning(): boolean {
    if (process.platform !== 'win32') {
        return false
    }

    const command = [
        "$targets = @(Get-CimInstance Win32_Process | Where-Object {",
        "    ($_.Name -ieq 'Codex.exe' -or $_.Name -ieq 'codex.exe') -and",
        "    $_.ExecutablePath -match '\\\\WindowsApps\\\\OpenAI\\.Codex_'",
        '})',
        "if ($targets.Count -gt 0) { 'true' } else { 'false' }"
    ].join('\n')

    for (const shell of ['pwsh', 'powershell.exe']) {
        try {
            const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-Command', command], {
                encoding: 'utf-8',
                timeout: 5000,
                windowsHide: true
            })
            if (result.status === 0) {
                return result.stdout.trim().toLowerCase().includes('true')
            }
        } catch {
            // Try next shell.
        }
    }

    return false
}

function getCodexDesktopStatus(): CodexDesktopStatus {
    const running = isCodexDesktopRunning()
    return {
        running,
        clientAvailable: running || isCodexDesktopInstallAvailable()
    }
}

function getScriptTimeoutMs(): number {
    const configured = Number(process.env.HAPI_CODEX_SCRIPT_TIMEOUT_MS)
    if (Number.isFinite(configured) && configured > 0) {
        return configured
    }
    return DEFAULT_SCRIPT_TIMEOUT_MS
}

function createLaunchArgs(scriptPath: string, workspace: string, scriptArgs: string[]): string[] {
    return [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-Workspace',
        workspace,
        ...scriptArgs
    ]
}

function appendScriptLog(workspace: string, kind: ScriptLogKind, message: string): void {
    try {
        const logDir = join(workspace, 'logs')
        mkdirSync(logDir, { recursive: true })
        const line = `[${new Date().toISOString()}] [${kind}] ${message}\n`
        appendFileSync(join(logDir, 'CodexDesktopScript.log'), line, 'utf-8')
    } catch {
        // Best-effort logging only; API response still carries the error.
    }
}

async function runPowerShellScript(scriptPath: string, workspace: string, scriptArgs: string[]): Promise<{ pid: number; command: string; output: string }> {
    const configuredPwsh = process.env.HAPI_PWSH_PATH?.trim()
    const candidates = Array.from(new Set([
        configuredPwsh || 'pwsh',
        'powershell.exe'
    ]))
    const args = createLaunchArgs(scriptPath, workspace, scriptArgs)
    let lastError: unknown = null

    for (const command of candidates) {
        try {
            return await new Promise((resolvePromise, rejectPromise) => {
                const output: string[] = []
                let settled = false
                let didSpawn = false
                let timeout: ReturnType<typeof setTimeout> | null = null
                const child = spawn(command, args, {
                    cwd: workspace,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    windowsHide: true
                })

                const cleanup = () => {
                    if (timeout) {
                        clearTimeout(timeout)
                    }
                    child.off('spawn', onSpawn)
                    child.off('error', onError)
                    child.off('exit', onExit)
                }

                const settleResolve = (value: { pid: number; command: string; output: string }) => {
                    if (settled) return
                    settled = true
                    cleanup()
                    resolvePromise(value)
                }

                const settleReject = (error: Error) => {
                    if (settled) return
                    settled = true
                    cleanup()
                    rejectPromise(error)
                }

                const onSpawn = () => {
                    didSpawn = true
                }

                const onError = (error: Error) => {
                    if (!didSpawn) {
                        ;(error as Error & { shellLaunchFailed?: boolean }).shellLaunchFailed = true
                    }
                    settleReject(error)
                }

                const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
                    const combinedOutput = output.join('').trim()
                    if (code === 0) {
                        settleResolve({ pid: child.pid ?? 0, command, output: combinedOutput })
                        return
                    }
                    const detail = combinedOutput ? `\n${combinedOutput}` : ''
                    settleReject(new Error(`${command} exited with code ${code ?? 'null'}${signal ? ` signal ${signal}` : ''}.${detail}`))
                }

                timeout = setTimeout(() => {
                    child.kill()
                    settleReject(new Error(SCRIPT_TIMEOUT_ERROR))
                }, getScriptTimeoutMs())

                child.stdout?.on('data', (chunk) => output.push(String(chunk)))
                child.stderr?.on('data', (chunk) => output.push(String(chunk)))
                child.once('spawn', onSpawn)
                child.once('error', onError)
                child.once('exit', onExit)
            })
        } catch (error) {
            lastError = error
            if (!(error instanceof Error && (error as Error & { shellLaunchFailed?: boolean }).shellLaunchFailed)) {
                throw error instanceof Error ? error : new Error(String(error))
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function launchRestartScript(): Promise<ScriptLaunchResponse> {
    const scriptPath = getRestartScriptPath()
    const workspace = getWorkspace(scriptPath)

    if (!existsSync(scriptPath)) {
        appendScriptLog(workspace, 'restart', `FAILED: Script not found: ${scriptPath}`)
        return {
            success: false,
            error: `Script not found: ${scriptPath}`,
            script: scriptPath,
            cwd: workspace
        }
    }

    if (!existsSync(workspace)) {
        appendScriptLog(workspace, 'restart', `FAILED: Workspace not found: ${workspace}`)
        return {
            success: false,
            error: `Workspace not found: ${workspace}`,
            script: scriptPath,
            cwd: workspace
        }
    }

    try {
        const launched = await runPowerShellScript(scriptPath, workspace, RESTART_SCRIPT_ARGS)
        const output = launched.output
        appendScriptLog(
            workspace,
            'restart',
            `SUCCESS: ${RESTART_SCRIPT_MESSAGE}; pid=${launched.pid}; command=${launched.command}; script=${scriptPath}${output ? `; output=${output}` : ''}`
        )
        return {
            success: true,
            message: RESTART_SCRIPT_MESSAGE,
            pid: launched.pid,
            command: launched.command,
            script: scriptPath,
            cwd: workspace,
            output
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        appendScriptLog(workspace, 'restart', `FAILED: ${message}; script=${scriptPath}`)
        return {
            success: false,
            error: message,
            script: scriptPath,
            cwd: workspace
        }
    }
}

function parseSyncSessionRequest(body: unknown): SyncSessionRequestParseResult {
    // The import dialog submits explicit Codex thread IDs; a missing body means no session was selected.
    if (body === null || typeof body !== 'object' || Array.isArray(body) || !('sessionIds' in body)) {
        return { sessionIds: [] }
    }

    const bodyRecord = body as { sessionIds?: unknown; projectId?: unknown; cwd?: unknown; machineId?: unknown; model?: unknown; modelReasoningEffort?: unknown; serviceTier?: unknown; collaborationMode?: unknown; yolo?: unknown }
    const rawSessionIds = bodyRecord.sessionIds
    if (!Array.isArray(rawSessionIds)) {
        return { sessionIds: [], error: 'Invalid sessionIds' }
    }

    const sessionIds: string[] = []
    for (const value of rawSessionIds) {
        if (typeof value !== 'string') {
            return { sessionIds: [], error: 'Invalid sessionIds' }
        }
        const trimmed = value.trim()
        if (trimmed) {
            sessionIds.push(trimmed)
        }
    }

    const hasModel = Object.prototype.hasOwnProperty.call(bodyRecord, 'model')
    const hasModelReasoningEffort = Object.prototype.hasOwnProperty.call(bodyRecord, 'modelReasoningEffort')
    const hasServiceTier = Object.prototype.hasOwnProperty.call(bodyRecord, 'serviceTier')
    const hasCollaborationMode = Object.prototype.hasOwnProperty.call(bodyRecord, 'collaborationMode')
    if (hasServiceTier && bodyRecord.serviceTier !== null && bodyRecord.serviceTier !== 'fast' && bodyRecord.serviceTier !== 'standard') {
        return { sessionIds: [], error: 'Invalid serviceTier' }
    }
    if (hasCollaborationMode && bodyRecord.collaborationMode !== 'default' && bodyRecord.collaborationMode !== 'plan') {
        return { sessionIds: [], error: 'Invalid collaborationMode' }
    }

    // The UI allows multi-select; de-duplicate by Codex thread to avoid importing the same transcript twice.
    return {
        sessionIds: Array.from(new Set(sessionIds)),
        projectId: typeof bodyRecord.projectId === 'string' && bodyRecord.projectId.trim() ? bodyRecord.projectId.trim() : null,
        cwd: typeof bodyRecord.cwd === 'string' && bodyRecord.cwd.trim() ? bodyRecord.cwd.trim() : null,
        machineId: typeof bodyRecord.machineId === 'string' && bodyRecord.machineId.trim() ? bodyRecord.machineId.trim() : null,
        model: hasModel ? (typeof bodyRecord.model === 'string' && bodyRecord.model.trim() ? bodyRecord.model.trim() : null) : undefined,
        modelReasoningEffort: hasModelReasoningEffort ? (typeof bodyRecord.modelReasoningEffort === 'string' && bodyRecord.modelReasoningEffort.trim() ? bodyRecord.modelReasoningEffort.trim() : null) : undefined,
        serviceTier: hasServiceTier ? bodyRecord.serviceTier as 'fast' | 'standard' | null : undefined,
        collaborationMode: hasCollaborationMode ? bodyRecord.collaborationMode as CodexCollaborationMode : undefined,
        yolo: bodyRecord.yolo === true
    }
}

function parseSyncFolderRequest(body: unknown): SyncFolderRequestParseResult {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return { includeSubdirs: false, error: 'Invalid request body' }
    }

    const bodyRecord = body as {
        cwd?: unknown
        machineId?: unknown
        projectId?: unknown
        includeSubdirs?: unknown
        model?: unknown
        modelReasoningEffort?: unknown
        serviceTier?: unknown
        collaborationMode?: unknown
        yolo?: unknown
    }
    const cwd = typeof bodyRecord.cwd === 'string' && bodyRecord.cwd.trim()
        ? bodyRecord.cwd.trim()
        : null
    if (!cwd) {
        return { includeSubdirs: false, error: 'cwd is required' }
    }

    const hasModel = Object.prototype.hasOwnProperty.call(bodyRecord, 'model')
    const hasModelReasoningEffort = Object.prototype.hasOwnProperty.call(bodyRecord, 'modelReasoningEffort')
    const hasServiceTier = Object.prototype.hasOwnProperty.call(bodyRecord, 'serviceTier')
    const hasCollaborationMode = Object.prototype.hasOwnProperty.call(bodyRecord, 'collaborationMode')
    if (hasServiceTier && bodyRecord.serviceTier !== null && bodyRecord.serviceTier !== 'fast' && bodyRecord.serviceTier !== 'standard') {
        return { includeSubdirs: false, error: 'Invalid serviceTier' }
    }
    if (hasCollaborationMode && bodyRecord.collaborationMode !== 'default' && bodyRecord.collaborationMode !== 'plan') {
        return { includeSubdirs: false, error: 'Invalid collaborationMode' }
    }

    return {
        cwd,
        machineId: typeof bodyRecord.machineId === 'string' && bodyRecord.machineId.trim() ? bodyRecord.machineId.trim() : null,
        projectId: typeof bodyRecord.projectId === 'string' && bodyRecord.projectId.trim() ? bodyRecord.projectId.trim() : null,
        // Import only exact current-directory matches; do not recursively scan subdirectories.
        includeSubdirs: false,
        model: hasModel ? (typeof bodyRecord.model === 'string' && bodyRecord.model.trim() ? bodyRecord.model.trim() : null) : undefined,
        modelReasoningEffort: hasModelReasoningEffort ? (typeof bodyRecord.modelReasoningEffort === 'string' && bodyRecord.modelReasoningEffort.trim() ? bodyRecord.modelReasoningEffort.trim() : null) : undefined,
        serviceTier: hasServiceTier ? bodyRecord.serviceTier as 'fast' | 'standard' | null : undefined,
        collaborationMode: hasCollaborationMode ? bodyRecord.collaborationMode as CodexCollaborationMode : undefined,
        yolo: bodyRecord.yolo === true
    }
}

function codexSessionMatchesFolder(
    session: CodexLocalSessionSummary | RemoteCodexSession,
    cwd: string,
    includeSubdirs: boolean
): boolean {
    if (!session.cwd?.trim()) return false
    if (includeSubdirs) {
        return isPathInsideWorkspaceRoot(session.cwd, cwd)
    }
    const caseInsensitive = shouldCompareCaseInsensitive(session.cwd, cwd)
    return normalizeComparablePath(session.cwd, { caseInsensitive })
        === normalizeComparablePath(cwd, { caseInsensitive })
}

function createSyncFolderEmptyResponse(
    parsed: SyncFolderRequestParseResult,
    codexStatus: CodexDesktopStatus
): ScriptLaunchResponse {
    return {
        success: true,
        message: 'No Codex sessions found for this folder',
        pid: 0,
        command: DIRECT_IMPORT_COMMAND,
        cwd: parsed.cwd ?? getDirectImportRouteContext().workspace,
        output: `No Codex sessions found for folder: ${parsed.cwd ?? ''}`,
        codexDesktopRunning: codexStatus.running,
        codexClientAvailable: codexStatus.clientAvailable,
        syncedCount: 0,
        matchedCount: 0,
        sessionIds: [],
        hapiSessionIds: []
    }
}

function combineSyncOutputs(results: ScriptLaunchResponse[]): string | undefined {
    const output = results
        .map((result, index) => {
            // Direct import no longer relies on hidden scripts; format summaries as plain text for UI/log display.
            const detail = result.success ? (result.output ?? '') : (result.output ?? result.error)
            return detail ? `[${index + 1}] ${detail}` : ''
        })
        .filter(Boolean)
        .join('\n\n')
        .trim()
    return output || undefined
}

function getDirectImportRouteContext(): { workspace: string } {
    return {
        workspace: getDirectImportWorkspace()
    }
}

function createImportErrorResponse(
    codexSessionIds: string[],
    error: string,
    syncedCount = 0
): ScriptLaunchResponse {
    const { workspace } = getDirectImportRouteContext()
    appendScriptLog(workspace, 'sync', `FAILED: ${error}; sessionIds=${codexSessionIds.join(',') || '(none)'}`)
    return {
        success: false,
        error,
        cwd: workspace,
        sessionIds: codexSessionIds,
        syncedCount
    }
}

function parseImportedHapiSessionId(output?: string): string | null {
    if (!output) return null
    const match = /^Hapi session:\s*(.+)$/m.exec(output)
    return match?.[1]?.trim() || null
}

function createImportSuccessResponse(
    codexSessionIds: string[],
    results: ScriptLaunchResponse[]
): ScriptLaunchResponse {
    const { workspace } = getDirectImportRouteContext()
    appendScriptLog(
        workspace,
        'sync',
        `SUCCESS: imported ${results.length} Codex session(s); sessionIds=${codexSessionIds.join(',')}`
    )
    return {
        success: true,
        message: `Imported ${results.length} Codex session(s) into Hapi`,
        pid: 0,
        command: DIRECT_IMPORT_COMMAND,
        cwd: workspace,
        output: combineSyncOutputs(results),
        sessionIds: codexSessionIds,
        hapiSessionIds: results.map((result) => parseImportedHapiSessionId(result.output)).filter((id): id is string => Boolean(id)),
        syncedCount: results.length
    }
}

type PreparedCodexImportTarget = {
    transcript: CodexTranscriptImportData
    sessionId: string
    created: boolean
    messagesToAppend: CodexImportedMessageContent[]
    comparablePrefixCount: number
    engine: SyncEngine | null
}

async function prepareCodexImportTarget(options: {
    codexSessionId: string
    transcript: CodexTranscriptImportData
    store: Store
    namespace: string
    userId?: number
    getSyncEngine?: () => SyncEngine | null
    model?: string | null
    modelReasoningEffort?: string | null
    yolo?: boolean
    machineId?: string | null
    projectId?: string | null
}): Promise<PreparedCodexImportTarget> {
    const importedComparableMessages = options.transcript.messages
        .map((message) => normalizeComparableContent(message))
        .filter((value): value is string => value !== null)

    const importProject = await resolveImportProject(options.store, options.namespace, options.userId, options.projectId)
    const candidates = (await collectImportCandidates(options.store, options.namespace, options.getSyncEngine, options.userId))
        .filter((candidate) =>
            !options.projectId
            || candidate.projectId === null
            || candidate.projectId === importProject?.id
        )
    const target = await selectImportTargetSession(
        options.store,
        candidates,
        options.codexSessionId,
        importedComparableMessages,
        options.machineId
    )
    const engine = options.getSyncEngine?.() ?? null
    const existingStored = target.sessionId ? await options.store.sessions.getSessionByNamespace(target.sessionId, options.namespace) : null
    if (!existingStored && typeof options.userId === 'number' && !importProject) {
        throw new Error('No editable project available for Codex import')
    }
    const metadata = buildImportedSessionMetadata(
        options.transcript,
        asRecord(existingStored?.metadata),
        options.machineId ?? resolveImportMachineId(options.transcript.cwd, options.namespace, engine) ?? undefined,
        options.yolo ? 'yolo' : undefined
    )
    await ensureImportedProjectDirectory({
        engine,
        namespace: options.namespace,
        userId: options.userId,
        project: importProject,
        machineId: metadata.machineId,
        cwd: options.transcript.cwd
    })

    let sessionId = existingStored?.id ?? null
    let created = false
    if (!sessionId) {
        // Create a new HAPI session when no safe historical target exists, instead of forcing forked data into an old session.
        const asyncEngine = engine as (SyncEngine & { getOrCreateSessionAsync?: SyncEngine['getOrCreateSessionAsync'] }) | null
        const createdSession = engine
            ? asyncEngine?.getOrCreateSessionAsync
                ? await asyncEngine.getOrCreateSessionAsync(
                    randomUUID(),
                    metadata,
                    {},
                    options.namespace,
                    options.model ?? undefined,
                    undefined,
                    options.modelReasoningEffort ?? undefined,
                    undefined,
                    importProject && typeof options.userId === 'number'
                        ? { projectId: importProject.id, createdByUserId: options.userId }
                        : undefined
                )
                : engine.getOrCreateSession(
                randomUUID(),
                metadata,
                {},
                options.namespace,
                options.model ?? undefined,
                undefined,
                options.modelReasoningEffort ?? undefined,
                undefined,
                importProject && typeof options.userId === 'number'
                    ? { projectId: importProject.id, createdByUserId: options.userId }
                    : undefined
            )
            : await options.store.sessions.getOrCreateSession(
                randomUUID(),
                metadata,
                {},
                options.namespace,
                options.model ?? undefined,
                undefined,
                options.modelReasoningEffort ?? undefined,
                undefined,
                importProject && typeof options.userId === 'number'
                    ? { projectId: importProject.id, createdByUserId: options.userId }
                    : undefined
            )
        sessionId = createdSession.id
        created = true
    } else if (existingStored) {
        if (importProject && existingStored.projectId === null && typeof options.userId === 'number') {
            await options.store.sessions.assignSessionProject(existingStored.id, options.namespace, importProject.id, options.userId)
        }
        const updatedMetadata = await options.store.sessions.updateSessionMetadata(
            existingStored.id,
            metadata,
            existingStored.metadataVersion,
            options.namespace
        )
        if (updatedMetadata.result !== 'success') {
            throw new Error(`Failed to update metadata for Hapi session: ${existingStored.id}`)
        }
        if (options.model !== undefined) {
            await options.store.sessions.setSessionModel(existingStored.id, options.model, options.namespace, { touchUpdatedAt: false })
        }
        if (options.modelReasoningEffort !== undefined) {
            await options.store.sessions.setSessionModelReasoningEffort(existingStored.id, options.modelReasoningEffort, options.namespace, { touchUpdatedAt: false })
        }
        engine?.handleRealtimeEvent({ type: 'session-updated', sessionId: existingStored.id })
    }

    if (!sessionId) {
        throw new Error(`Failed to determine target Hapi session for Codex thread: ${options.codexSessionId}`)
    }

    const comparablePrefixCount = target.comparablePrefixCount
    const messagesToAppend = options.transcript.messages.slice(comparablePrefixCount)
    const targetIsActive = Boolean(candidates.find((candidate) => candidate.sessionId === sessionId)?.active)
    if (targetIsActive && messagesToAppend.length > 0) {
        throw new Error('当前会话正在运行且 Codex transcript 有新消息，停止或归档后再同步，避免消息顺序错乱')
    }

    return {
        transcript: options.transcript,
        sessionId,
        created,
        messagesToAppend,
        comparablePrefixCount,
        engine
    }
}

function buildSingleImportSuccessResponse(
    codexSessionId: string,
    sessionId: string,
    created: boolean,
    appendedMessagesCount: number
): ScriptLaunchResponse {
    const output = [
        `Codex thread: ${codexSessionId}`,
        `Hapi session: ${sessionId}`,
        `Action: ${created ? 'created' : 'updated'}`,
        `Appended messages: ${appendedMessagesCount}`
    ].join('\n')

    appendScriptLog(
        getDirectImportRouteContext().workspace,
        'sync',
        `SUCCESS: codexSessionId=${codexSessionId}; hapiSessionId=${sessionId}; created=${created}; appended=${appendedMessagesCount}`
    )

    return {
        success: true,
        message: created ? 'Codex session imported into a new Hapi session' : 'Codex session appended to existing Hapi session',
        pid: 0,
        command: DIRECT_IMPORT_COMMAND,
        cwd: getDirectImportRouteContext().workspace,
        output,
        sessionIds: [codexSessionId],
        hapiSessionIds: [sessionId],
        syncedCount: 1
    }
}

async function getImportChunkStartAt(store: Store, sessionId: string, totalToAppend: number): Promise<number> {
    const latestPosition = store.messages.getNewestMessagePositionAsync
        ? await store.messages.getNewestMessagePositionAsync(sessionId)
        : store.messages.getNewestMessagePosition(sessionId)
    const naturalStart = Date.now() - Math.max(0, totalToAppend - 1)
    const minimumStart = latestPosition ? latestPosition.at + 1 : 1
    return Math.max(1, naturalStart, minimumStart)
}

async function appendImportedMessagesNewestFirst(options: {
    store: Store
    sessionId: string
    messagesToAppend: CodexImportedMessageContent[]
    chunkSize?: number
    onChunk?: (state: { importedMessages: number; appendedMessages: StoredMessage[] }) => void | Promise<void>
}): Promise<StoredMessage[]> {
    const messagesToAppend = options.messagesToAppend
    if (messagesToAppend.length === 0) {
        return []
    }

    const chunkSize = Math.max(1, options.chunkSize ?? CODEX_IMPORT_CHUNK_SIZE)
    const startAt = await getImportChunkStartAt(options.store, options.sessionId, messagesToAppend.length)
    const appendedMessages: StoredMessage[] = []

    for (let end = messagesToAppend.length; end > 0; end -= chunkSize) {
        const start = Math.max(0, end - chunkSize)
        const chunk = messagesToAppend.slice(start, end)
        const chunkInputs = chunk.map((message, index) => {
            const createdAt = startAt + start + index
            return {
                content: message,
                createdAt,
                localId: null,
                invokedAt: createdAt,
                scheduledAt: null
            }
        })
        const chunkMessages = options.store.messages.copyMessagesToSessionAsync
            ? await options.store.messages.copyMessagesToSessionAsync(options.sessionId, chunkInputs)
            : options.store.messages.copyMessagesToSession
                ? options.store.messages.copyMessagesToSession(options.sessionId, chunkInputs)
            : chunkInputs.map((message) => options.store.messages.copyMessageToSession(options.sessionId, message))
        appendedMessages.push(...chunkMessages)
        await options.onChunk?.({
            importedMessages: appendedMessages.length,
            appendedMessages: chunkMessages
        })
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 0))
    }

    return appendedMessages
}

async function importSingleCodexSession(options: {
    codexSessionId: string
    localSessionsById: Map<string, CodexLocalSessionSummary | RemoteCodexSession>
    store: Store
    namespace: string
    userId?: number
    getSyncEngine?: () => SyncEngine | null
    model?: string | null
    modelReasoningEffort?: string | null
    yolo?: boolean
    machineId?: string | null
    projectId?: string | null
}): Promise<ScriptLaunchResponse> {
    const summary = options.localSessionsById.get(options.codexSessionId)
    if (!summary) {
        return {
            ...createImportErrorResponse([options.codexSessionId], `Transcript not found for Codex session: ${options.codexSessionId}`),
            output: `未找到对应的本地 transcript：${options.codexSessionId}`
        }
    }

    const transcript = 'messages' in summary && Array.isArray((summary as RemoteCodexSession).messages)
        ? summary as RemoteCodexSession
        : parseCodexTranscriptImportData(summary)
    if (!transcript) {
        return {
            ...createImportErrorResponse([options.codexSessionId], `Failed to parse Codex transcript: ${summary.file}`),
            output: `解析 transcript 失败：${summary.file}`
        }
    }

    if (transcript.messages.length === 0) {
        return {
            ...createImportErrorResponse([options.codexSessionId], `No importable conversation content found in transcript: ${summary.file}`),
            output: `transcript 中没有可导入的会话内容：${summary.file}`
        }
    }

    try {
        const prepared = await prepareCodexImportTarget({
            codexSessionId: options.codexSessionId,
            transcript,
            store: options.store,
            namespace: options.namespace,
            userId: options.userId,
            getSyncEngine: options.getSyncEngine,
            model: options.model,
            modelReasoningEffort: options.modelReasoningEffort,
            yolo: options.yolo,
            machineId: options.machineId,
            projectId: options.projectId
        })
        const importMessages = prepared.messagesToAppend.map((message, index) => {
            const createdAt = Date.now() + index
            return { content: message, createdAt, localId: null, invokedAt: createdAt, scheduledAt: null }
        })
        const appendedMessages = options.store.messages.copyMessagesToSessionAsync
            ? await options.store.messages.copyMessagesToSessionAsync(
                prepared.sessionId,
                importMessages
            )
            : options.store.messages.copyMessagesToSession
                ? options.store.messages.copyMessagesToSession(
                prepared.sessionId,
                importMessages
            )
            : prepared.messagesToAppend.map((message) => options.store.messages.addMessage(prepared.sessionId, message))

        // Update the HAPI session updatedAt and broadcast appended messages so the open chat page shows new local content immediately.
        const latestMessageCreatedAt = appendedMessages.length > 0
            ? Math.max(...appendedMessages.map((message) => message.invokedAt ?? message.createdAt))
            : Date.now()
        if (prepared.engine) {
            prepared.engine.recordSessionActivity(prepared.sessionId, latestMessageCreatedAt)
        } else {
            await options.store.sessions.touchSessionUpdatedAt(prepared.sessionId, latestMessageCreatedAt, options.namespace)
        }
        if (!prepared.created) {
            emitImportedMessageEvents(prepared.engine, prepared.sessionId, appendedMessages)
        }

        return buildSingleImportSuccessResponse(
            options.codexSessionId,
            prepared.sessionId,
            prepared.created,
            appendedMessages.length
        )
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
            ...createImportErrorResponse([options.codexSessionId], message),
            output: `Codex thread: ${options.codexSessionId}\n${message}`
        }
    }
}

export async function importSelectedCodexSessions(options: {
    codexSessionIds: string[]
    store: Store
    namespace: string
    userId?: number
    getSyncEngine?: () => SyncEngine | null
    localSessions?: RemoteCodexSession[]
    model?: string | null
    modelReasoningEffort?: string | null
    serviceTier?: string | null
    collaborationMode?: CodexCollaborationMode
    yolo?: boolean
    machineId?: string | null
    projectId?: string | null
}): Promise<ScriptLaunchResponse> {
    const codexSessionIds = options.codexSessionIds
    if (codexSessionIds.length === 0) {
        return createImportErrorResponse(codexSessionIds, NO_SYNC_SESSION_SELECTED_ERROR)
    }

    const localSessionsById = new Map((options.localSessions ?? listLocalCodexSessions()).map((session) => [session.id, session]))
    const results: ScriptLaunchResponse[] = []
    for (const codexSessionId of codexSessionIds) {
        const result = await importSingleCodexSession({
            codexSessionId,
            localSessionsById,
            store: options.store,
            namespace: options.namespace,
            userId: options.userId,
            getSyncEngine: options.getSyncEngine,
            model: options.model,
            modelReasoningEffort: options.modelReasoningEffort,
            yolo: options.yolo,
            machineId: options.machineId,
            projectId: options.projectId
        })
        results.push(result)

        if (result.success && (options.serviceTier !== undefined || options.collaborationMode !== undefined)) {
            const importedSessionId = result.hapiSessionIds?.[0]
            const engine = options.getSyncEngine?.() ?? null
            if (!importedSessionId || !engine) {
                return createImportErrorResponse(codexSessionIds, 'Imported session config could not be applied before resume')
            }
            try {
                await engine.applySessionConfig(importedSessionId, {
                    ...(options.serviceTier !== undefined ? { serviceTier: options.serviceTier } : {}),
                    ...(options.collaborationMode !== undefined ? { collaborationMode: options.collaborationMode } : {})
                })
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                return createImportErrorResponse(codexSessionIds, `Failed to apply imported session config: ${message}`)
            }
        }

        if (!result.success) {
            return {
                ...result,
                sessionIds: codexSessionIds,
                syncedCount: Math.max(0, results.length - 1),
                output: combineSyncOutputs(results) ?? result.output
            }
        }
    }

    return createImportSuccessResponse(codexSessionIds, results)
}

type CodexImportJobInternal = CodexImportJob & {
    cancelRequested?: boolean
    model?: string | null
    modelReasoningEffort?: string | null
    serviceTier?: string | null
    collaborationMode?: CodexCollaborationMode
    yolo?: boolean
}


function restorePersistedCodexImportJob(payload: unknown): CodexImportJobInternal | null {
    const record = asRecord(payload)
    if (!record) return null
    if (typeof record.id !== 'string' || typeof record.namespace !== 'string') return null
    if (typeof record.status !== 'string' || !['queued', 'running', 'succeeded', 'failed', 'canceled'].includes(record.status)) return null
    if (typeof record.createdAt !== 'number' || typeof record.totalItems !== 'number') return null
    if (!Array.isArray(record.items) || !Array.isArray(record.logs)) return null
    return payload as CodexImportJobInternal
}

function markInterruptedCodexImportJob(job: CodexImportJobInternal, now: number): boolean {
    if (!isActiveCodexImportStatus(job.status)) return false
    const error = 'Import job interrupted by server restart'
    job.status = 'failed'
    job.finishedAt = now
    job.error = job.error ?? error
    for (const item of job.items) {
        if (item.status !== 'queued' && item.status !== 'running') continue
        item.status = 'failed'
        item.error = item.error ?? error
        item.finishedAt = now
        job.completedItems += 1
        job.failedItems += 1
    }
    job.logs.push({ at: now, level: 'error', message: error })
    return true
}

function cloneCodexImportJob(job: CodexImportJobInternal): CodexImportJob {
    return {
        id: job.id,
        namespace: job.namespace,
        ...(job.userId !== undefined ? { userId: job.userId } : {}),
        projectId: job.projectId,
        cwd: job.cwd,
        machineId: job.machineId,
        status: job.status,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        totalItems: job.totalItems,
        completedItems: job.completedItems,
        failedItems: job.failedItems,
        skippedItems: job.skippedItems,
        totalMessages: job.totalMessages,
        importedMessages: job.importedMessages,
        error: job.error,
        items: job.items.map((item) => ({ ...item })),
        logs: job.logs.map((log) => ({ ...log }))
    }
}

function isActiveCodexImportStatus(status: CodexImportJobStatus): boolean {
    return status === 'queued' || status === 'running'
}

function isVisibleImportJob(job: CodexImportJobInternal, namespace: string, userId?: number): boolean {
    if (job.namespace !== namespace) return false
    return typeof userId === 'number' ? job.userId === userId : true
}

function createCodexImportToast(
    type: 'started' | 'succeeded' | 'failed',
    job: CodexImportJob
): Extract<SyncEvent, { type: 'toast' }> {
    const titles = {
        started: 'Codex import started',
        succeeded: 'Codex import completed',
        failed: 'Codex import failed'
    }
    const bodies = {
        started: `Queued ${job.totalItems} Codex conversation(s).`,
        succeeded: `Imported ${job.completedItems - job.skippedItems} conversation(s), skipped ${job.skippedItems}.`,
        failed: `Imported ${job.completedItems - job.failedItems - job.skippedItems} conversation(s), failed ${job.failedItems}.`
    }
    return {
        type: 'toast',
        namespace: job.namespace,
        data: {
            title: titles[type],
            body: bodies[type],
            sessionId: '',
            url: ''
        }
    }
}

class CodexImportQueue {
    private readonly jobs = new Map<string, CodexImportJobInternal>()
    private processing = false

    constructor(private readonly options: {
        store: Store
        getSyncEngine: () => SyncEngine | null
    }) {
        void this.loadPersistedJobs()
    }

    private async loadPersistedJobs(): Promise<void> {
        const now = Date.now()
        for (const record of await this.options.store.codexImportJobs.listAll()) {
            const job = restorePersistedCodexImportJob(record.payload)
            if (!job) continue
            const changed = markInterruptedCodexImportJob(job, now)
            this.jobs.set(job.id, job)
            if (changed) await this.persistJob(job)
        }
        await this.pruneJobs()
    }

    private async persistJob(job: CodexImportJobInternal): Promise<void> {
        await this.options.store.codexImportJobs.save(job, job)
    }

    async createJob(options: {
        codexSessionIds: string[]
        namespace: string
        userId?: number
        projectId?: string | null
        cwd?: string | null
        machineId?: string | null
        model?: string | null
        modelReasoningEffort?: string | null
        serviceTier?: string | null
        collaborationMode?: CodexCollaborationMode
        yolo?: boolean
    }): Promise<CodexImportJob> {
        const now = Date.now()
        const items = options.codexSessionIds.map((codexSessionId): CodexImportJobItem => {
            if (this.hasActiveImport(options.namespace, codexSessionId, options.machineId)) {
                return {
                    codexSessionId,
                    status: 'skipped',
                    totalMessages: 0,
                    messagesToImport: 0,
                    importedMessages: 0,
                    appendedMessages: 0,
                    error: 'Already queued or running',
                    finishedAt: now
                }
            }
            return {
                codexSessionId,
                status: 'queued',
                totalMessages: 0,
                messagesToImport: 0,
                importedMessages: 0,
                appendedMessages: 0
            }
        })
        const skippedItems = items.filter((item) => item.status === 'skipped').length
        const hasRunnableItems = items.some((item) => item.status === 'queued')
        const job: CodexImportJobInternal = {
            id: randomUUID(),
            namespace: options.namespace,
            userId: options.userId,
            projectId: options.projectId ?? null,
            cwd: options.cwd ?? null,
            machineId: options.machineId ?? null,
            model: options.model,
            modelReasoningEffort: options.modelReasoningEffort,
            serviceTier: options.serviceTier,
            collaborationMode: options.collaborationMode,
            yolo: options.yolo,
            status: hasRunnableItems ? 'queued' : 'succeeded',
            createdAt: now,
            finishedAt: hasRunnableItems ? undefined : now,
            totalItems: items.length,
            completedItems: skippedItems,
            failedItems: 0,
            skippedItems,
            totalMessages: 0,
            importedMessages: 0,
            items,
            logs: []
        }

        this.jobs.set(job.id, job)
        this.addLog(job, 'info', `Created Codex import job with ${items.length} item(s)`)
        await this.persistJob(job)
        await this.pruneJobs()
        if (hasRunnableItems) {
            void this.drain()
        }
        return cloneCodexImportJob(job)
    }

    listJobs(namespace: string, userId?: number): CodexImportJob[] {
        return Array.from(this.jobs.values())
            .filter((job) => isVisibleImportJob(job, namespace, userId))
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(cloneCodexImportJob)
    }

    getJob(jobId: string, namespace: string, userId?: number): CodexImportJob | null {
        const job = this.jobs.get(jobId)
        if (!job || !isVisibleImportJob(job, namespace, userId)) {
            return null
        }
        return cloneCodexImportJob(job)
    }

    async cancelJob(jobId: string, namespace: string, userId?: number): Promise<CodexImportJob | null> {
        const job = this.jobs.get(jobId)
        if (!job || !isVisibleImportJob(job, namespace, userId)) {
            return null
        }
        if (!isActiveCodexImportStatus(job.status)) {
            return cloneCodexImportJob(job)
        }
        job.cancelRequested = true
        this.addLog(job, 'info', 'Cancel requested')
        const now = Date.now()
        for (const item of job.items) {
            if (item.status === 'queued') {
                item.status = 'canceled'
                item.finishedAt = now
                job.completedItems += 1
                job.skippedItems += 1
                this.addLog(job, 'info', `Canceled queued item: ${item.codexSessionId}`, item.codexSessionId)
            }
        }
        if (!job.items.some((item) => item.status === 'running')) {
            job.status = 'canceled'
            job.finishedAt = now
        }
        await this.persistJob(job)
        return cloneCodexImportJob(job)
    }

    async deleteJob(jobId: string, namespace: string, userId?: number): Promise<{ deleted: true } | { deleted: false; error: string } | null> {
        const job = this.jobs.get(jobId)
        if (!job || !isVisibleImportJob(job, namespace, userId)) {
            return null
        }
        if (isActiveCodexImportStatus(job.status)) {
            return { deleted: false, error: 'Active import jobs cannot be deleted; cancel the task first.' }
        }
        this.jobs.delete(jobId)
        await this.options.store.codexImportJobs.delete(jobId)
        return { deleted: true }
    }

    private addLog(job: CodexImportJobInternal, level: 'info' | 'error', message: string, codexSessionId?: string): void {
        job.logs.push({
            at: Date.now(),
            level,
            message,
            ...(codexSessionId ? { codexSessionId } : {})
        })
    }

    private hasActiveImport(namespace: string, codexSessionId: string, machineId?: string | null): boolean {
        for (const job of this.jobs.values()) {
            if (job.namespace !== namespace || !isActiveCodexImportStatus(job.status)) {
                continue
            }
            if (machineId && job.machineId && machineId !== job.machineId) {
                continue
            }
            if (job.items.some((item) => item.codexSessionId === codexSessionId && (item.status === 'queued' || item.status === 'running'))) {
                return true
            }
        }
        return false
    }

    private async pruneJobs(): Promise<void> {
        if (this.jobs.size <= MAX_CODEX_IMPORT_JOBS) {
            return
        }
        const removable = Array.from(this.jobs.values())
            .filter((job) => !isActiveCodexImportStatus(job.status))
            .sort((a, b) => a.createdAt - b.createdAt)
        for (const job of removable) {
            if (this.jobs.size <= MAX_CODEX_IMPORT_JOBS) {
                break
            }
            this.jobs.delete(job.id)
        }
        await this.options.store.codexImportJobs.prune(MAX_CODEX_IMPORT_JOBS)
    }

    private async drain(): Promise<void> {
        if (this.processing) {
            return
        }
        this.processing = true
        try {
            while (true) {
                const nextJob = Array.from(this.jobs.values())
                    .filter((job) => job.status === 'queued')
                    .sort((a, b) => a.createdAt - b.createdAt)[0]
                if (!nextJob) {
                    return
                }
                await this.processJob(nextJob)
            }
        } finally {
            this.processing = false
        }
    }

    private emitToast(type: 'started' | 'succeeded' | 'failed', job: CodexImportJobInternal): void {
        this.options.getSyncEngine()?.handleRealtimeEvent(createCodexImportToast(type, cloneCodexImportJob(job)))
    }

    private async processJob(job: CodexImportJobInternal): Promise<void> {
        job.status = 'running'
        job.startedAt = Date.now()
        this.addLog(job, 'info', 'Job started')
        await this.persistJob(job)
        this.emitToast('started', job)

        for (const item of job.items) {
            if (item.status !== 'queued') {
                continue
            }
            if (job.cancelRequested) {
                item.status = 'canceled'
                item.finishedAt = Date.now()
                job.completedItems += 1
                job.skippedItems += 1
                this.addLog(job, 'info', `Canceled item before start: ${item.codexSessionId}`, item.codexSessionId)
                continue
            }
            item.status = 'running'
            item.startedAt = Date.now()
            this.addLog(job, 'info', `Import item started: ${item.codexSessionId}`, item.codexSessionId)
            await this.persistJob(job)
            try {
                await this.processItem(job, item)
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                const canceled = job.cancelRequested && message === 'Import job canceled'
                item.status = canceled ? 'canceled' : 'failed'
                item.error = canceled ? undefined : message
                item.finishedAt = Date.now()
                this.addLog(job, canceled ? 'info' : 'error', message, item.codexSessionId)
                job.completedItems += 1
                if (canceled) job.skippedItems += 1
                else job.failedItems += 1
                if (!canceled) job.error = message
                appendScriptLog(
                    getDirectImportRouteContext().workspace,
                    'sync',
                    `FAILED: queued Codex import job=${job.id}; codexSessionId=${item.codexSessionId}; error=${message}`
                )
                await this.persistJob(job)
            }
        }

        job.status = job.cancelRequested ? 'canceled' : (job.failedItems > 0 ? 'failed' : 'succeeded')
        job.finishedAt = Date.now()
        this.addLog(job, job.status === 'failed' ? 'error' : 'info', `Job ${job.status}`)
        await this.persistJob(job)
        this.emitToast(job.status === 'failed' ? 'failed' : 'succeeded', job)
    }

    private async processItem(job: CodexImportJobInternal, item: CodexImportJobItem): Promise<void> {
        if (job.cancelRequested) throw new Error('Import job canceled')
        const remote = await fetchCodexTranscriptViaMachine({
            engine: this.options.getSyncEngine(),
            namespace: job.namespace,
            cwd: job.cwd,
            machineId: job.machineId,
            sessionId: item.codexSessionId
        })
        if (remote.error) {
            throw new Error(remote.error)
        }

        const transcript = remote.session
        if (!transcript) {
            throw new Error(`Transcript not found for Codex session: ${item.codexSessionId}`)
        }
        if (transcript.messages.length === 0) {
            throw new Error(`No importable conversation content found in transcript: ${transcript.file}`)
        }

        item.title = transcript.title
        item.totalMessages = transcript.messages.length

        if (job.cancelRequested) throw new Error('Import job canceled')

        const prepared = await prepareCodexImportTarget({
            codexSessionId: item.codexSessionId,
            transcript,
            store: this.options.store,
            namespace: job.namespace,
            userId: job.userId,
            getSyncEngine: this.options.getSyncEngine,
            model: job.model,
            modelReasoningEffort: job.modelReasoningEffort,
            yolo: job.yolo,
            machineId: remote.machineId ?? job.machineId ?? null,
            projectId: job.projectId
        })

        item.hapiSessionId = prepared.sessionId
        item.messagesToImport = prepared.messagesToAppend.length
        job.totalMessages += prepared.messagesToAppend.length

        if (prepared.messagesToAppend.length === 0) {
            item.status = 'skipped'
            item.finishedAt = Date.now()
            job.completedItems += 1
            job.skippedItems += 1
            await this.persistJob(job)
            return
        }

        const appendedMessages = await appendImportedMessagesNewestFirst({
            store: this.options.store,
            sessionId: prepared.sessionId,
            messagesToAppend: prepared.messagesToAppend,
            chunkSize: CODEX_IMPORT_CHUNK_SIZE,
            onChunk: async ({ importedMessages, appendedMessages: chunkMessages }) => {
                if (job.cancelRequested) throw new Error('Import job canceled')
                item.importedMessages = importedMessages
                item.appendedMessages += chunkMessages.length
                job.importedMessages += chunkMessages.length
                await this.persistJob(job)
            }
        })

        const latestMessageCreatedAt = appendedMessages.length > 0
            ? Math.max(...appendedMessages.map((message) => message.invokedAt ?? message.createdAt))
            : Date.now()
        if (prepared.engine) {
            prepared.engine.recordSessionActivity(prepared.sessionId, latestMessageCreatedAt)
        } else {
            await this.options.store.sessions.touchSessionUpdatedAt(prepared.sessionId, latestMessageCreatedAt, job.namespace)
        }

        if (job.serviceTier !== undefined || job.collaborationMode !== undefined) {
            if (!prepared.engine) {
                throw new Error('Imported session config could not be applied before resume')
            }
            await prepared.engine.applySessionConfig(prepared.sessionId, {
                ...(job.serviceTier !== undefined ? { serviceTier: job.serviceTier } : {}),
                ...(job.collaborationMode !== undefined ? { collaborationMode: job.collaborationMode } : {})
            })
        }

        item.status = job.cancelRequested ? 'canceled' : 'succeeded'
        item.finishedAt = Date.now()
        this.addLog(job, 'info', `Import item ${item.status}: ${item.codexSessionId}; appended=${appendedMessages.length}`, item.codexSessionId)
        job.completedItems += 1
        await this.persistJob(job)
        appendScriptLog(
            getDirectImportRouteContext().workspace,
            'sync',
            `SUCCESS: queued Codex import job=${job.id}; codexSessionId=${item.codexSessionId}; hapiSessionId=${prepared.sessionId}; appended=${appendedMessages.length}`
        )
    }
}


async function canViewAllCodexImportJobs(c: Context<WebAppEnv>, store: Store): Promise<boolean> {
    if (c.get('authPlatform') === 'owner') return true
    const userId = c.get('userId')
    const namespace = c.get('namespace')
    if (typeof userId !== 'number') return false
    const user = await store.users.getUserById(userId, namespace)
    return user?.role === 'admin' && user.disabledAt === null
}

async function codexImportJobUserScope(c: Context<WebAppEnv>, store: Store): Promise<number | undefined> {
    return c.req.query('all') === 'true' && await canViewAllCodexImportJobs(c, store)
        ? undefined
        : c.get('userId')
}

export function createCodexDesktopRoutes(options: {
    store: Store
    getSyncEngine: () => SyncEngine | null
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const importQueue = new CodexImportQueue(options)

    app.use('/codex/*', async (c, next) => {
        if (c.get('namespace') !== 'default') {
            return c.json({
                success: false,
                error: CODEX_TRANSCRIPT_IMPORT_NAMESPACE_ERROR
            }, 403)
        }
        return next()
    })

    app.get('/codex/status', (c) => {
        const codexStatus = getCodexDesktopStatus()
        return c.json({
            success: true,
            codexDesktopRunning: codexStatus.running,
            codexClientAvailable: codexStatus.clientAvailable
        } satisfies CodexDesktopStatusResponse)
    })

    app.get('/codex/sessions', async (c) => {
        const cwd = c.req.query('cwd')?.trim() || null
        const machineId = c.req.query('machineId')?.trim() || null
        const remote = await listCodexSessionsViaMachine({
            engine: options.getSyncEngine(),
            namespace: c.get('namespace'),
            cwd,
            machineId
        })
        if (remote.error) {
            return c.json({
                success: false,
                error: remote.error,
                sessions: [],
                ...(remote.machineId ? { machineId: remote.machineId } : {})
            } satisfies CodexLocalSessionsResponse, 503)
        }
        const importedMatches = await listImportedCodexSessionMatches({
            store: options.store,
            namespace: c.get('namespace'),
            userId: c.get('userId'),
            machineId: remote.machineId ?? machineId,
            getSyncEngine: options.getSyncEngine
        })
        return c.json({
            success: true,
            sessions: remote.sessions.map(({ messages: _messages, ...summary }) => {
                const hapiSessionIds = importedMatches.get(summary.id) ?? []
                return {
                    ...summary,
                    imported: hapiSessionIds.length > 0,
                    ...(hapiSessionIds.length > 0 ? { hapiSessionIds } : {})
                }
            }),
            ...(remote.machineId ? { machineId: remote.machineId } : {})
        } satisfies CodexLocalSessionsResponse)
    })

    app.get('/codex/import-jobs', async (c) => {
        return c.json({
            success: true,
            jobs: importQueue.listJobs(c.get('namespace'), await codexImportJobUserScope(c, options.store))
        } satisfies CodexImportJobsResponse)
    })

    app.get('/codex/import-jobs/:jobId', async (c) => {
        const job = importQueue.getJob(c.req.param('jobId'), c.get('namespace'), await codexImportJobUserScope(c, options.store))
        if (!job) {
            return c.json({
                success: false,
                error: 'Import job not found'
            } satisfies CodexImportJobResponse, 404)
        }
        return c.json({
            success: true,
            job
        } satisfies CodexImportJobResponse)
    })

    app.post('/codex/import-jobs/:jobId/cancel', async (c) => {
        const job = await importQueue.cancelJob(c.req.param('jobId'), c.get('namespace'), await codexImportJobUserScope(c, options.store))
        if (!job) {
            return c.json({
                success: false,
                error: 'Import job not found'
            } satisfies CodexImportJobResponse, 404)
        }
        return c.json({
            success: true,
            job
        } satisfies CodexImportJobResponse)
    })

    app.delete('/codex/import-jobs/:jobId', async (c) => {
        const result = await importQueue.deleteJob(c.req.param('jobId'), c.get('namespace'), await codexImportJobUserScope(c, options.store))
        if (!result) {
            return c.json({ success: false, error: 'Import job not found' }, 404)
        }
        if (!result.deleted) {
            return c.json({ success: false, error: result.error }, 409)
        }
        return c.json({ success: true })
    })

    app.post('/codex/import-jobs', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = parseSyncSessionRequest(body)
        if (parsed.error) {
            return c.json({
                success: false,
                error: parsed.error
            } satisfies CodexImportJobResponse, 400)
        }
        if (parsed.sessionIds.length === 0) {
            return c.json({
                success: false,
                error: NO_SYNC_SESSION_SELECTED_ERROR
            } satisfies CodexImportJobResponse, 400)
        }

        const job = await importQueue.createJob({
            codexSessionIds: parsed.sessionIds,
            namespace: c.get('namespace'),
            userId: c.get('userId'),
            projectId: parsed.projectId,
            cwd: parsed.cwd,
            machineId: parsed.machineId,
            model: parsed.model,
            modelReasoningEffort: parsed.modelReasoningEffort,
            serviceTier: parsed.serviceTier,
            collaborationMode: parsed.collaborationMode,
            yolo: parsed.yolo
        })
        return c.json({
            success: true,
            job
        } satisfies CodexImportJobResponse)
    })


    app.post('/codex/archive-session', async (c) => {
        const body = await c.req.json().catch(() => null)
        const record = asRecord(body)
        const sessionId = typeof record?.sessionId === 'string' ? record.sessionId.trim() : ''
        const requestedMachineId = typeof record?.machineId === 'string' ? record.machineId.trim() : null
        if (!sessionId) {
            return c.json({ success: false, error: 'sessionId is required' }, 400)
        }

        const engine = options.getSyncEngine()
        const machineId = resolveCodexImportMachineId(null, c.get('namespace'), engine, requestedMachineId)
        if (!engine || !machineId) {
            return c.json({ success: false, error: 'No online machine available for Codex history archive' }, 503)
        }

        const result = await engine.archiveCodexSessionForMachine(machineId, sessionId)
        if (!result || typeof result !== 'object') {
            return c.json({ success: false, error: 'Unexpected Codex archive RPC response', machineId }, 500)
        }
        if ((result as { success?: unknown }).success !== true) {
            const error = typeof (result as { error?: unknown }).error === 'string'
                ? (result as { error: string }).error
                : 'Failed to archive Codex session'
            return c.json({ success: false, error, machineId }, 500)
        }
        return c.json({ success: true, archivedPath: (result as { archivedPath: string }).archivedPath, machineId })
    })

    app.post('/codex/sync-session', async (c) => {
        const codexStatus = getCodexDesktopStatus()
        const body = await c.req.json().catch(() => null)
        const parsed = parseSyncSessionRequest(body)
        if (parsed.error) {
            const { workspace } = getDirectImportRouteContext()
            appendScriptLog(workspace, 'sync', `FAILED: ${parsed.error}`)
            return c.json({
                success: false,
                error: parsed.error,
                cwd: workspace,
                codexDesktopRunning: codexStatus.running,
                codexClientAvailable: codexStatus.clientAvailable
            })
        }

        // The hub may run on a server; Codex transcripts must be read through the user's local runner RPC, not server disk scans.
        const remote = await fetchCodexTranscriptsViaMachine({
            engine: options.getSyncEngine(),
            namespace: c.get('namespace'),
            cwd: parsed.cwd,
            machineId: parsed.machineId,
            sessionIds: parsed.sessionIds
        })
        if (remote.error) {
            const { workspace } = getDirectImportRouteContext()
            return c.json({
                success: false,
                error: remote.error,
                cwd: workspace,
                codexDesktopRunning: codexStatus.running,
                codexClientAvailable: codexStatus.clientAvailable
            })
        }
        const result = await importSelectedCodexSessions({
            codexSessionIds: parsed.sessionIds,
            store: options.store,
            namespace: c.get('namespace'),
            userId: c.get('userId'),
            getSyncEngine: options.getSyncEngine,
            localSessions: remote.sessions,
            machineId: remote.machineId ?? null,
            projectId: parsed.projectId,
            model: parsed.model,
            modelReasoningEffort: parsed.modelReasoningEffort,
            serviceTier: parsed.serviceTier,
            collaborationMode: parsed.collaborationMode,
            yolo: parsed.yolo
        })
        return c.json({
            ...result,
            codexDesktopRunning: codexStatus.running,
            codexClientAvailable: codexStatus.clientAvailable
        })
    })

    app.post('/codex/sync-folder', async (c) => {
        const codexStatus = getCodexDesktopStatus()
        const body = await c.req.json().catch(() => null)
        const parsed = parseSyncFolderRequest(body)
        if (parsed.error || !parsed.cwd) {
            const { workspace } = getDirectImportRouteContext()
            appendScriptLog(workspace, 'sync', `FAILED: ${parsed.error ?? 'cwd is required'}`)
            return c.json({
                success: false,
                error: parsed.error ?? 'cwd is required',
                cwd: workspace,
                codexDesktopRunning: codexStatus.running,
                codexClientAvailable: codexStatus.clientAvailable
            })
        }

        // Fetch summaries first for directory filtering, then fetch full transcripts by ID to avoid treating server paths as local history.
        const summaries = await listCodexSessionsViaMachine({
            engine: options.getSyncEngine(),
            namespace: c.get('namespace'),
            cwd: parsed.cwd,
            machineId: parsed.machineId
        })
        if (summaries.error) {
            const { workspace } = getDirectImportRouteContext()
            return c.json({
                success: false,
                error: summaries.error,
                cwd: workspace,
                codexDesktopRunning: codexStatus.running,
                codexClientAvailable: codexStatus.clientAvailable
            })
        }

        const folderSessions = summaries.sessions
            .filter((session) => codexSessionMatchesFolder(session, parsed.cwd!, parsed.includeSubdirs))
            .sort((a, b) => b.modifiedAt - a.modifiedAt)
        const sessionIds = folderSessions.map((session) => session.id)
        if (sessionIds.length === 0) {
            return c.json(createSyncFolderEmptyResponse(parsed, codexStatus))
        }

        const sessionsWithMessages = await fetchCodexTranscriptsViaMachine({
            engine: options.getSyncEngine(),
            namespace: c.get('namespace'),
            cwd: parsed.cwd,
            machineId: summaries.machineId ?? parsed.machineId,
            sessionIds
        })
        if (sessionsWithMessages.error) {
            const { workspace } = getDirectImportRouteContext()
            return c.json({
                success: false,
                error: sessionsWithMessages.error,
                cwd: workspace,
                codexDesktopRunning: codexStatus.running,
                codexClientAvailable: codexStatus.clientAvailable,
                sessionIds,
                matchedCount: sessionIds.length
            })
        }

        const result = await importSelectedCodexSessions({
            codexSessionIds: sessionIds,
            store: options.store,
            namespace: c.get('namespace'),
            userId: c.get('userId'),
            getSyncEngine: options.getSyncEngine,
            localSessions: sessionsWithMessages.sessions,
            machineId: sessionsWithMessages.machineId ?? summaries.machineId ?? null,
            projectId: parsed.projectId,
            model: parsed.model,
            modelReasoningEffort: parsed.modelReasoningEffort,
            serviceTier: parsed.serviceTier,
            collaborationMode: parsed.collaborationMode,
            yolo: parsed.yolo
        })
        const latestCodexSessionId = sessionIds[0]
        const latestHapiSessionId = result.success ? result.hapiSessionIds?.[0] : undefined
        return c.json({
            ...result,
            codexDesktopRunning: codexStatus.running,
            codexClientAvailable: codexStatus.clientAvailable,
            matchedCount: sessionIds.length,
            latestCodexSessionId,
            ...(latestHapiSessionId ? { latestHapiSessionId } : {})
        })
    })

    app.post('/codex/duplicate-sessions', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = parseSyncSessionRequest(body)
        if (parsed.error) {
            return c.json({
                success: false,
                error: parsed.error
            } satisfies CodexDuplicateSessionsResponse)
        }

        if (parsed.sessionIds.length === 0) {
            return c.json({
                success: false,
                error: NO_SYNC_SESSION_SELECTED_ERROR
            } satisfies CodexDuplicateSessionsResponse)
        }

        // Only check Codex session IDs selected in this import dialog; unselected duplicates are not part of this prompt.
        const duplicates = (await listDuplicateCodexSessionGroups(
            options.store,
            c.get('namespace'),
            parsed.sessionIds,
            options.getSyncEngine,
            c.get('userId')
        )).map((group) => ({
            codexSessionId: group.codexSessionId,
            hapiSessionIds: group.sessions.map((session) => session.sessionId)
        }))

        return c.json({
            success: true,
            duplicates
        } satisfies CodexDuplicateSessionsResponse)
    })

    app.post('/codex/merge-duplicate-sessions', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = parseSyncSessionRequest(body)
        if (parsed.error) {
            return c.json({
                success: false,
                error: parsed.error
            } satisfies CodexMergeDuplicateSessionsResponse)
        }

        if (parsed.sessionIds.length === 0) {
            return c.json({
                success: false,
                error: NO_SYNC_SESSION_SELECTED_ERROR
            } satisfies CodexMergeDuplicateSessionsResponse)
        }

        const { workspace } = getDirectImportRouteContext()
        try {
            // During merge execution, only touch the selected Codex session IDs to avoid modifying unrelated history.
            const result = await mergeDuplicateCodexSessionGroups({
                store: options.store,
                namespace: c.get('namespace'),
                codexSessionIds: parsed.sessionIds,
                getSyncEngine: options.getSyncEngine,
                userId: c.get('userId')
            })
            appendScriptLog(
                workspace,
                'sync',
                `SUCCESS: merged duplicate Hapi sessions for selected codexSessionIds=${parsed.sessionIds.join(',')}`
            )
            return c.json(result satisfies CodexMergeDuplicateSessionsResponse)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            appendScriptLog(
                workspace,
                'sync',
                `FAILED: duplicate-session merge error=${message}; selectedCodexSessionIds=${parsed.sessionIds.join(',')}`
            )
            return c.json({
                success: false,
                error: message
            } satisfies CodexMergeDuplicateSessionsResponse)
        }
    })

    app.post('/codex/restart-desktop', async (c) => {
        const codexStatus = getCodexDesktopStatus()
        if (!codexStatus.clientAvailable) {
            const scriptPath = getRestartScriptPath()
            const workspace = getWorkspace(scriptPath)
            const error = CODEX_DESKTOP_NOT_FOUND_ERROR
            appendScriptLog(workspace, 'restart', `FAILED: ${error}; script=${scriptPath}`)
            return c.json({
                success: false,
                error,
                script: scriptPath,
                cwd: workspace,
                codexDesktopRunning: codexStatus.running,
                codexClientAvailable: codexStatus.clientAvailable
            })
        }

        const result = await launchRestartScript()
        return c.json({
            ...result,
            codexDesktopRunning: codexStatus.running,
            codexClientAvailable: codexStatus.clientAvailable
        })
    })

    return app
}
