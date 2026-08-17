import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { AuthResponse, CodexImportJob, CodexLocalSessionSummary, EnterpriseUser, ProjectWithDetails, ProjectWorkspace, SessionSummary } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { useLongPress } from '@/hooks/useLongPress'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { SessionExportDialog } from '@/components/SessionExportDialog'
import { CodexSessionSyncDialog } from '@/components/CodexSessionSyncDialog'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CopyIcon, CheckIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'
import { DEFAULT_SESSION_PREVIEW_LIMIT, useSessionPreviewLimit } from '@/hooks/useSessionPreviewLimit'
import { useSessionListStatusMode } from '@/hooks/useSessionListStatusMode'
import { useShowActiveSessionsOnly } from '@/hooks/useShowActiveSessionsOnly'
import { classifySessionAttention } from '@/lib/sessionAttention'
import { getSessionLastSeenAt } from '@/lib/sessionLastSeen'
import { useSessionRowTooltipIds } from '@/components/HoverTooltip'
import { markCodexSessionsImported, subscribeCodexImportedSessions } from '@/lib/codexImportedSessions'
import { formatReopenError } from '@/lib/reopenError'
import { getSessionTitle } from '@/lib/sessionTitle'
import { getWorktreeSessionLabel } from '@/lib/sessionWorktreeLabel'
import type { Machine } from '@/types/api'
import { getMachinePlatform, presentMachineHealth } from '@/lib/machineHealth'
import { MachineFilterDropdown, type ProjectFilterItem } from '@/components/MachineFilterBar'
import { useSessionListMachineFilter } from '@/hooks/useSessionListMachineFilter'
import { useCursorChatStoreStatus } from '@/hooks/queries/useCursorChatStoreStatus'
import { SessionRowSummary } from '@/components/SessionRowSummary'
import { Spinner } from '@/components/Spinner'
import { useProjects } from '@/hooks/queries/useProjects'
import { queryKeys } from '@/lib/query-keys'
import { useToast } from '@/lib/toast-context'

export { getWorktreeSessionLabel } from '@/lib/sessionWorktreeLabel'

type SessionGroup = {
    key: string
    directory: string
    displayName: string
    machineId: string | null
    sessions: SessionSummary[]
    createdAt: number
    latestUpdatedAt: number
    hasActiveSession: boolean
}

type CodexGroupSyncTarget = {
    groupKey: string
    directory: string
    machineId: string
    projectId: string | null
}

export type SessionTimeRange = {
    start: number | null
    end: number | null
}

function parseLocalDate(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return null
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const date = new Date(year, month - 1, day)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
    return date
}

export function getSessionTimeRange(start: string, end: string): SessionTimeRange | null {
    const startDate = parseLocalDate(start)
    const endDate = parseLocalDate(end)
    if (!startDate || !endDate) return null
    if (endDate) endDate.setDate(endDate.getDate() + 1)
    return { start: startDate.getTime(), end: endDate.getTime() }
}

export function sessionMatchesTimeRange(session: SessionSummary, range: SessionTimeRange | null): boolean {
    if (!range) return true
    if (range.start !== null && session.updatedAt < range.start) return false
    if (range.end !== null && session.updatedAt >= range.end) return false
    return true
}

function SessionsEmptyState(props: {
    onNewSession: () => void
    onBrowse?: () => void
}) {
    const { t } = useTranslation()
    return (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[var(--app-hint)] opacity-60"
            >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 9h18" />
                <path d="M8 14h8" />
                <path d="M8 17h5" />
            </svg>
            <div className="text-base font-medium text-[var(--app-fg)]">
                {t('sessions.empty.title')}
            </div>
            <div className="max-w-sm text-sm text-[var(--app-hint)]">
                {t('sessions.empty.hint')}
            </div>
            <div className="flex items-center gap-2 mt-2">
                <button
                    type="button"
                    onClick={props.onNewSession}
                    className="px-4 py-1.5 text-sm rounded-lg bg-[var(--app-button)] text-[var(--app-button-text)] font-medium hover:opacity-90 transition-opacity"
                >
                    {t('sessions.empty.startSession')}
                </button>
                {props.onBrowse && (
                    <button
                        type="button"
                        onClick={props.onBrowse}
                        className="px-4 py-1.5 text-sm rounded-lg border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                    >
                        {t('sessions.empty.browse')}
                    </button>
                )}
            </div>
        </div>
    )
}

type MachineGroup = {
    machineId: string | null
    label: string
    projectGroups: SessionGroup[]
    totalSessions: number
    hasActiveSession: boolean
    latestUpdatedAt: number
}

type SessionGroupAliases = Record<string, string>

export const SESSION_GROUP_ALIAS_STORAGE_KEY = 'hapi.sessionGroupAliases.v1'
export const SESSION_LIST_PROJECT_FILTER_STORAGE_KEY = 'hapi-session-list-project-filter'

function readSessionListProjectFilter(): string | null {
    const storage = getLocalStorage()
    const value = storage?.getItem(SESSION_LIST_PROJECT_FILTER_STORAGE_KEY)?.trim() ?? ''
    return value || null
}

function writeSessionListProjectFilter(projectId: string | null): void {
    const storage = getLocalStorage()
    if (!storage) return
    if (projectId) storage.setItem(SESSION_LIST_PROJECT_FILTER_STORAGE_KEY, projectId)
    else storage.removeItem(SESSION_LIST_PROJECT_FILTER_STORAGE_KEY)
}


function getGroupDisplayName(directory: string): string {
    if (directory === 'Other') return directory
    const parts = directory.split(/[\\/]+/).filter(Boolean)
    if (parts.length === 0) return directory
    if (parts.length === 1) return parts[0]
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

export const UNKNOWN_MACHINE_ID = '__unknown__'
export const GROUP_SESSION_PREVIEW_LIMIT = DEFAULT_SESSION_PREVIEW_LIMIT

function getLocalStorage(): Storage | null {
    if (typeof window === 'undefined') return null
    try {
        return window.localStorage
    } catch {
        return null
    }
}

export function readSessionGroupAliases(): SessionGroupAliases {
    const storage = getLocalStorage()
    if (!storage) return {}
    const raw = storage.getItem(SESSION_GROUP_ALIAS_STORAGE_KEY)
    if (!raw) return {}

    try {
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

        const aliases: SessionGroupAliases = {}
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof key !== 'string' || typeof value !== 'string') continue
            const normalized = value.trim()
            if (!normalized) continue
            aliases[key] = normalized
        }
        return aliases
    } catch {
        return {}
    }
}

export function writeSessionGroupAliases(aliases: SessionGroupAliases): void {
    const storage = getLocalStorage()
    if (!storage) return

    const normalized: SessionGroupAliases = {}
    for (const [key, value] of Object.entries(aliases)) {
        const label = value.trim()
        if (!label) continue
        normalized[key] = label
    }

    try {
        if (Object.keys(normalized).length === 0) {
            storage.removeItem(SESSION_GROUP_ALIAS_STORAGE_KEY)
            return
        }
        storage.setItem(SESSION_GROUP_ALIAS_STORAGE_KEY, JSON.stringify(normalized))
    } catch {
        // Ignore storage failures; the UI can still use the in-memory name.
    }
}

function normalizeComparablePath(value: string, caseInsensitive: boolean): string {
    let normalized = value.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
    if (normalized.length > 1) {
        normalized = normalized.replace(/\/+$/g, '')
    }
    return caseInsensitive ? normalized.toLowerCase() : normalized
}

function isWindowsPathContext(machine: Machine | undefined, ...paths: Array<string | null | undefined>): boolean {
    if (machine?.metadata?.platform === 'win32') return true
    if (machine?.metadata?.workspaceRoots?.some((root) => /^[a-zA-Z]:[\\/]/.test(root))) return true
    return paths.some((path) => typeof path === 'string' && /^[a-zA-Z]:[\\/]/.test(path))
}

function isPathInsideRoot(candidate: string, root: string, caseInsensitive: boolean): boolean {
    const normalizedCandidate = normalizeComparablePath(candidate, caseInsensitive)
    const normalizedRoot = normalizeComparablePath(root, caseInsensitive)
    return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)
}

function isExactWorkspacePath(candidate: string, root: string, caseInsensitive: boolean): boolean {
    return normalizeComparablePath(candidate, caseInsensitive) === normalizeComparablePath(root, caseInsensitive)
}

function getUserLabel(user: Pick<EnterpriseUser, 'id' | 'username' | 'displayName'> | null | undefined): string {
    if (!user) return ''
    const displayName = user.displayName?.trim()
    const username = user.username?.trim()
    if (displayName && username && displayName !== username) {
        return `${displayName} (@${username})`
    }
    return displayName || (username ? `@${username}` : `User ${user.id}`)
}

function getProjectOwnerLabel(project: ProjectWithDetails | null): string {
    const createdBy = getUserLabel(project?.createdByUser)
    if (createdBy) return createdBy
    const owner = project?.members.find((member) => member.role === 'owner')
    return owner ? `User ${owner.userId}` : ''
}

function canManageProject(project: ProjectWithDetails): boolean {
    return project.role === 'owner' || project.role === 'admin'
}

function isSharedProject(project: ProjectWithDetails | null, currentUserId: number | null): boolean {
    if (!project || currentUserId === null || project.createdByUserId == null) return false
    return project.createdByUserId !== currentUserId
}

function getPrimaryProjectId(group: SessionGroup): string | null {
    const ids = group.sessions
        .map((session) => session.projectId ?? null)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    return ids[0] ?? null
}

function groupHasCodexSessions(group: SessionGroup): boolean {
    return group.sessions.some((session) => session.metadata?.flavor === 'codex')
}

export function getSessionGroupStatusCounts(group: Pick<SessionGroup, 'sessions'>): {
    active: number
    pending: number
} {
    let active = 0
    let pending = 0
    for (const session of group.sessions) {
        if (session.active) active += 1
        if (session.pendingRequestsCount > 0) pending += session.pendingRequestsCount
    }
    return { active, pending }
}

function findWorkspaceForGroup(
    group: SessionGroup,
    projects: ProjectWithDetails[],
    machinesById: Record<string, Machine>
): { project: ProjectWithDetails; workspace: ProjectWorkspace; exact: boolean } | null {
    if (!group.machineId || group.directory === 'Other') return null
    const machine = machinesById[group.machineId]
    const windows = isWindowsPathContext(machine, group.directory)
    let containing: { project: ProjectWithDetails; workspace: ProjectWorkspace; exact: boolean } | null = null

    for (const project of projects) {
        for (const workspace of project.workspaces) {
            if (workspace.machineId !== group.machineId) continue
            if (isExactWorkspacePath(group.directory, workspace.rootPath, windows)) {
                return { project, workspace, exact: true }
            }
            if (isPathInsideRoot(group.directory, workspace.rootPath, windows)) {
                if (!containing || workspace.rootPath.length > containing.workspace.rootPath.length) {
                    containing = { project, workspace, exact: false }
                }
            }
        }
    }

    return containing
}

export function getSessionDedupKey(session: SessionSummary): string | null {
    const agentId = session.metadata?.agentSessionId?.trim()
    if (!agentId) return null
    // Scope by flavor: agentSessionId is flattened from native ids and can retain a
    // stale cross-flavor value (codexSessionId ?? claudeSessionId ?? ...).
    return `${session.metadata?.flavor ?? 'unknown'}:${agentId}`
}

export function deduplicateSessionsByAgentId(sessions: SessionSummary[], selectedSessionId?: string | null): SessionSummary[] {
    const byAgentId = new Map<string, SessionSummary[]>()
    const result: SessionSummary[] = []

    for (const session of sessions) {
        const dedupKey = getSessionDedupKey(session)
        if (!dedupKey) {
            result.push(session)
            continue
        }
        const group = byAgentId.get(dedupKey)
        if (group) {
            group.push(session)
        } else {
            byAgentId.set(dedupKey, [session])
        }
    }

    for (const group of byAgentId.values()) {
        group.sort((a, b) => {
            // Active session always wins — it's the live connection
            if (a.active !== b.active) return a.active ? -1 : 1
            // Among inactive duplicates, keep the selected one visible
            if (a.id === selectedSessionId) return -1
            if (b.id === selectedSessionId) return 1
            return b.updatedAt - a.updatedAt
        })
        result.push(group[0])
    }

    return result
}

function hasSidebarTitleSignal(session: SessionSummary): boolean {
    const meta = session.metadata
    if (!meta) return false
    if (meta.name?.trim()) return true
    if (meta.summary?.text?.trim()) return true
    return false
}

export function isSidebarEmptySessionStub(session: SessionSummary): boolean {
    if (session.active) return false
    const meta = session.metadata
    if (!meta) return true
    if (meta.agentSessionId?.trim()) return false
    if (hasSidebarTitleSignal(session)) return false
    return true
}

export function shouldShowSessionInSidebar(session: SessionSummary, selectedSessionId?: string | null): boolean {
    if (session.id === selectedSessionId) return true
    if (session.active) return true
    return !isSidebarEmptySessionStub(session)
}

export function prepareSidebarSessions(sessions: SessionSummary[], selectedSessionId?: string | null): SessionSummary[] {
    return deduplicateSessionsByAgentId(sessions, selectedSessionId)
        .filter(session => shouldShowSessionInSidebar(session, selectedSessionId))
}

// "Active sessions only" view: hide inactive sessions, but never hide the one the
// operator currently has open — otherwise toggling the filter would yank the
// selected session out from under them.
export function filterActiveSessionsOnly(sessions: SessionSummary[], selectedSessionId?: string | null): SessionSummary[] {
    return sessions.filter(session => session.active || session.id === selectedSessionId)
}

// Paginated session previews move one batch at a time in either direction.
// Counts always stay within the configured preview floor and the group total.
export function getNextSessionVisibleCount(current: number, step: number, total: number): number {
    return Math.min(current + Math.max(1, step), total)
}

export function getPreviousSessionVisibleCount(current: number, step: number): number {
    const normalizedStep = Math.max(1, step)
    return Math.max(normalizedStep, current - normalizedStep)
}

function groupSessionsByDirectory(sessions: SessionSummary[]): SessionGroup[] {
    const groups = new Map<string, { directory: string; machineId: string | null; sessions: SessionSummary[] }>()

    sessions.forEach(session => {
        const path = session.metadata?.worktree?.basePath ?? session.metadata?.path ?? 'Other'
        const machineId = session.metadata?.machineId ?? null
        const key = `${machineId ?? UNKNOWN_MACHINE_ID}::${path}`
        if (!groups.has(key)) {
            groups.set(key, {
                directory: path,
                machineId,
                sessions: []
            })
        }
        groups.get(key)!.sessions.push(session)
    })

    return Array.from(groups.entries())
        .map(([key, group]) => {
            const sortedSessions = [...group.sessions].sort((a, b) => {
                const rankA = a.active ? (a.pendingRequestsCount > 0 ? 0 : 1) : 2
                const rankB = b.active ? (b.pendingRequestsCount > 0 ? 0 : 1) : 2
                if (rankA !== rankB) return rankA - rankB
                return b.updatedAt - a.updatedAt
            })
            const latestUpdatedAt = group.sessions.reduce(
                (max, s) => (s.updatedAt > max ? s.updatedAt : max),
                -Infinity
            )
            const createdAt = group.sessions.reduce(
                (min, s) => {
                    const value = s.createdAt ?? s.updatedAt
                    return value < min ? value : min
                },
                Infinity
            )
            const hasActiveSession = group.sessions.some(s => s.active)
            const displayName = getGroupDisplayName(group.directory)

            return {
                key,
                directory: group.directory,
                displayName,
                machineId: group.machineId,
                sessions: sortedSessions,
                createdAt: Number.isFinite(createdAt) ? createdAt : latestUpdatedAt,
                latestUpdatedAt,
                hasActiveSession
            }
        })
        .sort((a, b) => {
            if (a.hasActiveSession !== b.hasActiveSession) {
                return a.hasActiveSession ? -1 : 1
            }
            return b.latestUpdatedAt - a.latestUpdatedAt
        })
}


export function expandSelectedSessionCollapseOverrides(
    overrides: Map<string, boolean>,
    group: { key: string }
): Map<string, boolean> {
    // Keep auto-expanded paths open after selection moves so content above the
    // clicked row does not collapse and displace the sidebar viewport.
    if (overrides.get(group.key) === false) {
        return overrides
    }

    const next = new Map(overrides)
    next.set(group.key, false)
    return next
}

function groupByMachine(
    groups: SessionGroup[],
    resolveMachineLabel: (id: string | null) => string,
    knownMachineIds: readonly string[] = []
): MachineGroup[] {
    const map = new Map<string, MachineGroup>()
    const ensureMachineGroup = (machineId: string | null): MachineGroup => {
        const key = machineId ?? UNKNOWN_MACHINE_ID
        let mg = map.get(key)
        if (!mg) {
            mg = {
                machineId,
                label: resolveMachineLabel(machineId),
                projectGroups: [],
                totalSessions: 0,
                hasActiveSession: false,
                latestUpdatedAt: 0,
            }
            map.set(key, mg)
        }
        return mg
    }

    for (const g of groups) {
        const mg = ensureMachineGroup(g.machineId)
        mg.projectGroups.push(g)
        mg.totalSessions += g.sessions.length
        if (g.hasActiveSession) mg.hasActiveSession = true
        if (g.latestUpdatedAt > mg.latestUpdatedAt) mg.latestUpdatedAt = g.latestUpdatedAt
    }
    for (const machineId of knownMachineIds) {
        ensureMachineGroup(machineId)
    }
    return [...map.values()].sort((a, b) => {
        if (a.hasActiveSession !== b.hasActiveSession) return a.hasActiveSession ? -1 : 1
        if (a.totalSessions !== b.totalSessions) return a.totalSessions > 0 ? -1 : 1
        if (a.latestUpdatedAt !== b.latestUpdatedAt) return b.latestUpdatedAt - a.latestUpdatedAt
        return a.label.localeCompare(b.label)
    })
}

function MoreVerticalIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={props.className}
        >
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
        </svg>
    )
}

function CopyPathMenuItem({ path }: { path: string }) {
    const { t } = useTranslation()
    const [copied, setCopied] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        void navigator.clipboard?.writeText(path)
        setCopied(true)
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setCopied(false), 1500)
    }

    useEffect(() => () => clearTimeout(timerRef.current), [])

    return (
        <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] focus:bg-[var(--app-subtle-bg)] focus:outline-none"
            title={path}
            onClick={handleClick}
        >
            {copied
                ? <CheckIcon className="h-3.5 w-3.5 shrink-0 text-[var(--app-badge-success-text)]" />
                : <CopyIcon className="h-3.5 w-3.5 shrink-0 text-[var(--app-hint)]" />
            }
            <span className="min-w-0 truncate">
                {copied ? t('sessions.group.copyPathCopied') : t('sessions.group.copyPath')}
            </span>
        </button>
    )
}

function formatTimestamp(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
    return new Date(value).toLocaleString()
}

function DetailRow(props: { label: string; value: string }) {
    return (
        <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-1.5 text-xs">
            <dt className="text-[var(--app-hint)]">{props.label}</dt>
            <dd className="min-w-0 truncate text-[var(--app-fg)]" title={props.value}>{props.value}</dd>
        </div>
    )
}

function SessionGroupDetailsPanel(props: {
    title: string
    group: SessionGroup
    project: ProjectWithDetails | null
    workspace: ProjectWorkspace | null
    exactWorkspace: boolean
    isShared: boolean
    sharedByLabel: string
    machineLabel: string
    moveTargets: ProjectWithDetails[]
    selectedMoveTargetId: string
    moveError: string | null
    isMoving: boolean
    onMoveTargetChange: (projectId: string) => void
    onMove: () => void
}) {
    const { t } = useTranslation()
    const canShowMove = !props.isShared && props.project && props.group.machineId && canManageProject(props.project)
    const moveUnavailableText = !props.project
        ? t('sessions.group.details.moveNoProject')
        : !props.group.machineId
            ? t('sessions.group.details.moveNoMachine')
            : !canManageProject(props.project)
                ? t('sessions.group.details.moveNoPermission')
                : props.moveTargets.length === 0
                    ? t('sessions.group.details.moveNoTargets')
                    : null

    return (
        <>
            <div className="mb-2 flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-sm font-semibold" title={props.title}>
                    {props.title}
                </div>
                {props.isShared ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--app-border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--app-hint)]">
                        <ShareIcon className="h-3 w-3" />
                        {t('sessions.group.shared')}
                    </span>
                ) : null}
            </div>
            <dl className="border-t border-[var(--app-divider)] pt-2">
                {props.isShared ? (
                    <>
                        <DetailRow label={t('sessions.group.details.sharedBy')} value={props.sharedByLabel || t('sessions.group.details.unknown')} />
                        <DetailRow label={t('sessions.group.details.createdAt')} value={formatTimestamp(props.workspace?.createdAt ?? props.group.createdAt)} />
                        <DetailRow label={t('sessions.group.details.path')} value={props.group.directory} />
                        <DetailRow label={t('sessions.group.details.sessions')} value={String(props.group.sessions.length)} />
                        <DetailRow label={t('sessions.group.details.updatedAt')} value={formatTimestamp(props.group.latestUpdatedAt)} />
                    </>
                ) : (
                    <>
                        <DetailRow label={t('sessions.group.details.createdAt')} value={formatTimestamp(props.workspace?.createdAt ?? props.group.createdAt)} />
                        <DetailRow label={t('sessions.group.details.machine')} value={props.machineLabel} />
                        <DetailRow label={t('sessions.group.details.project')} value={props.project?.name ?? t('sessions.group.details.none')} />
                        <DetailRow label={t('sessions.group.details.path')} value={props.group.directory} />
                        <DetailRow label={t('sessions.group.details.sessions')} value={String(props.group.sessions.length)} />
                        <DetailRow label={t('sessions.group.details.updatedAt')} value={formatTimestamp(props.group.latestUpdatedAt)} />
                    </>
                )}
            </dl>
            {!props.isShared ? (
                <div className="mt-3 border-t border-[var(--app-divider)] pt-3">
                    <div className="mb-1.5 text-xs font-medium text-[var(--app-fg)]">
                        {t('sessions.group.details.moveTitle')}
                    </div>
                    {canShowMove && props.moveTargets.length > 0 ? (
                        <div className="flex gap-2">
                            <select
                                value={props.selectedMoveTargetId}
                                onChange={(event) => props.onMoveTargetChange(event.target.value)}
                                className="min-w-0 flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5 text-xs text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                            >
                                <option value="">{t('sessions.group.details.movePlaceholder')}</option>
                                {props.moveTargets.map((project) => (
                                    <option key={project.id} value={project.id}>{project.name}</option>
                                ))}
                            </select>
                            <button
                                type="button"
                                disabled={!props.selectedMoveTargetId || props.isMoving}
                                onClick={props.onMove}
                                className="shrink-0 rounded-md bg-[var(--app-button)] px-2.5 py-1.5 text-xs font-medium text-[var(--app-button-text)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {props.isMoving ? t('sessions.group.details.moving') : t('sessions.group.details.move')}
                            </button>
                        </div>
                    ) : (
                        <div className="text-xs text-[var(--app-hint)]">{moveUnavailableText}</div>
                    )}
                    {props.moveError ? (
                        <div className="mt-2 text-xs text-red-600">{props.moveError}</div>
                    ) : null}
                </div>
            ) : null}
        </>
    )
}

function GroupActionMenuItem(props: {
    icon: React.ReactNode
    label: string
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
    return (
        <button
            type="button"
            role="menuitem"
            onClick={props.onClick}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] focus:bg-[var(--app-subtle-bg)] focus:outline-none"
        >
            <span className="shrink-0 text-[var(--app-hint)]">{props.icon}</span>
            <span className="min-w-0 truncate">{props.label}</span>
        </button>
    )
}

function SessionGroupActionMenu(props: {
    title: string
    group: SessionGroup
    project: ProjectWithDetails | null
    workspace: ProjectWorkspace | null
    exactWorkspace: boolean
    isShared: boolean
    sharedByLabel: string
    machineLabel: string
    moveTargets: ProjectWithDetails[]
    selectedMoveTargetId: string
    moveError: string | null
    isMoving: boolean
    canStartInGroupDirectory: boolean
    canSyncCodexSessions: boolean
    onRename: () => void
    onSyncCodexSessions?: () => void
    onNewSessionInDirectory?: () => void
    onMoveTargetChange: (projectId: string) => void
    onMove: () => void
}) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const [panel, setPanel] = useState<'menu' | 'details'>('menu')

    const closeMenu = () => {
        setOpen(false)
        setPanel('menu')
    }

    return (
        <Popover.Root open={open} onOpenChange={(nextOpen) => {
            setOpen(nextOpen)
            if (!nextOpen) setPanel('menu')
        }}>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    onClick={(event) => event.stopPropagation()}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-[var(--muted-foreground)] opacity-70 transition-colors hover:bg-[var(--secondary)] hover:text-[var(--primary)] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                    title={t('sessions.group.actions.open')}
                    aria-label={t('sessions.group.actions.open')}
                >
                    <MoreVerticalIcon className="h-3.5 w-3.5" />
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    side="bottom"
                    align="end"
                    sideOffset={6}
                    collisionPadding={10}
                    className={cn(
                        'z-50 rounded-lg border border-[var(--app-border)] bg-[var(--app-dialog-bg)] p-2 text-[var(--app-fg)] shadow-xl outline-none',
                        panel === 'details' ? 'w-80' : 'w-56'
                    )}
                    onClick={(event) => event.stopPropagation()}
                >
                    {panel === 'details' ? (
                        <div className="p-1">
                            <SessionGroupDetailsPanel
                                title={props.title}
                                group={props.group}
                                project={props.project}
                                workspace={props.workspace}
                                exactWorkspace={props.exactWorkspace}
                                isShared={props.isShared}
                                sharedByLabel={props.sharedByLabel}
                                machineLabel={props.machineLabel}
                                moveTargets={props.moveTargets}
                                selectedMoveTargetId={props.selectedMoveTargetId}
                                moveError={props.moveError}
                                isMoving={props.isMoving}
                                onMoveTargetChange={props.onMoveTargetChange}
                                onMove={props.onMove}
                            />
                        </div>
                    ) : (
                        <div role="menu" aria-label={t('sessions.group.actions.open')} className="flex flex-col gap-1">
                            <GroupActionMenuItem
                                icon={<InfoIcon className="h-3.5 w-3.5" />}
                                label={t('sessions.group.details.open')}
                                onClick={(event) => {
                                    event.stopPropagation()
                                    setPanel('details')
                                }}
                            />
                            <GroupActionMenuItem
                                icon={<PencilIcon className="h-3.5 w-3.5" />}
                                label={t('sessions.group.rename')}
                                onClick={(event) => {
                                    event.stopPropagation()
                                    closeMenu()
                                    props.onRename()
                                }}
                            />
                            <CopyPathMenuItem path={props.group.directory} />
                            {props.onSyncCodexSessions && props.canSyncCodexSessions ? (
                                <GroupActionMenuItem
                                    icon={<SyncIcon className="h-3.5 w-3.5" />}
                                    label={t('sessions.group.syncCodex')}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        closeMenu()
                                        props.onSyncCodexSessions?.()
                                    }}
                                />
                            ) : null}
                            {props.onNewSessionInDirectory && props.canStartInGroupDirectory ? (
                                <GroupActionMenuItem
                                    icon={<PlusIcon className="h-3.5 w-3.5" />}
                                    label={t('sessions.group.new')}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        closeMenu()
                                        props.onNewSessionInDirectory?.()
                                    }}
                                />
                            ) : null}
                        </div>
                    )}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}


function SearchIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
        </svg>
    )
}

function XIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    )
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function SyncIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M21 12a9 9 0 0 1-15 6.7" />
            <path d="M3 12a9 9 0 0 1 15-6.7" />
            <path d="M6 19H3v-3" />
            <path d="M18 5h3v3" />
        </svg>
    )
}

function PencilIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
    )
}

function InfoIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
        </svg>
    )
}

function ShareIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path d="m8.6 13.5 6.8 4" />
            <path d="m15.4 6.5-6.8 4" />
        </svg>
    )
}

function ChevronIcon(props: { className?: string; collapsed?: boolean }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`${props.className ?? ''} transition-transform duration-200 ${props.collapsed ? '' : 'rotate-90'}`}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function SessionPreviewArrowIcon(props: { direction: 'up' | 'down'; className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
            aria-hidden="true"
        >
            {props.direction === 'up' ? (
                <path d="M12 19V5m-6 6 6-6 6 6" />
            ) : (
                <path d="M12 5v14m6-6-6 6-6-6" />
            )}
        </svg>
    )
}

export { getSessionTitle } from '@/lib/sessionTitle'

export function normalizeSearch(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase()
}

export function sessionMatchesQuery(session: SessionSummary, query: string, machineLabel: string): boolean {
    if (!query) return true
    const searchable = [
        getSessionTitle(session),
        getWorktreeSessionLabel(session),
        session.id,
        session.metadata?.path,
        session.metadata?.worktree?.basePath,
        session.metadata?.worktree?.worktreePath,
        session.metadata?.name,
        session.metadata?.summary?.text,
        session.metadata?.flavor,
        machineLabel,
    ]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join('\n')
        .toLowerCase()
    return searchable.includes(query)
}


export function getVisibleSessionPreview(
    sessions: SessionSummary[],
    options: {
        expanded?: boolean
        selectedSessionId?: string | null
        limit?: number
    } = {}
): SessionSummary[] {
    const limit = options.limit ?? GROUP_SESSION_PREVIEW_LIMIT
    if (options.expanded || sessions.length <= limit) return sessions

    const requiredIds = new Set<string>()
    for (const session of sessions) {
        if (session.pendingRequestsCount > 0) requiredIds.add(session.id)
    }
    if (options.selectedSessionId && sessions.some(session => session.id === options.selectedSessionId)) {
        requiredIds.add(options.selectedSessionId)
    }

    const visible: SessionSummary[] = sessions.filter((session, index) => {
        return index < limit || requiredIds.has(session.id)
    })

    for (let index = visible.length - 1; visible.length > limit && index >= 0; index -= 1) {
        const session = visible[index]
        if (!session || requiredIds.has(session.id)) continue
        visible.splice(index, 1)
    }

    return visible
}

function CalendarIcon(props: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M16 3v4M8 3v4M3 10h18" />
        </svg>
    )
}

function formatDateValue(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function SessionDateRangePicker(props: {
    start: string
    end: string
    sessionActivityDates: ReadonlySet<string>
    onChange: (start: string, end: string) => void
    onClear: () => void
    onClose: () => void
}) {
    const { t } = useTranslation()
    const initialDate = parseLocalDate(props.start) ?? new Date()
    const [visibleMonth, setVisibleMonth] = useState(() => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1))
    const today = formatDateValue(new Date())
    const firstWeekday = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1).getDay()
    const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate()
    const weekdays = Array.from({ length: 7 }, (_, day) => (
        new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(new Date(2026, 5, 7 + day))
    ))

    const selectDate = (value: string) => {
        if (!props.start || props.end) {
            props.onChange(value, '')
            return
        }
        props.onChange(value < props.start ? value : props.start, value < props.start ? props.start : value)
        props.onClose()
    }

    return (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
                <button
                    type="button"
                    onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}
                    className="rounded-lg p-1.5 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                    aria-label={t('sessions.timeFilter.previousMonth')}
                >
                    <span aria-hidden="true">‹</span>
                </button>
                <div className="text-sm font-medium">
                    {visibleMonth.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}
                </div>
                <button
                    type="button"
                    onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}
                    className="rounded-lg p-1.5 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                    aria-label={t('sessions.timeFilter.nextMonth')}
                >
                    <span aria-hidden="true">›</span>
                </button>
            </div>
            <div className="mb-1 grid grid-cols-7 text-center text-[10px] text-[var(--app-hint)]">
                {weekdays.map((weekday, index) => <div key={`${weekday}-${index}`} className="py-1">{weekday}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: firstWeekday }, (_, index) => <div key={`blank-${index}`} />)}
                {Array.from({ length: daysInMonth }, (_, index) => {
                    const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), index + 1)
                    const value = formatDateValue(date)
                    const isToday = value === today
                    const isEndpoint = value === props.start || value === props.end
                    const isInRange = Boolean(props.start && props.end && value > props.start && value < props.end)
                    const hasSessionActivity = props.sessionActivityDates.has(value)
                    const dateLabel = date.toLocaleDateString()
                    const activityLabel = hasSessionActivity
                        ? t('sessions.timeFilter.dayWithActivity', { date: dateLabel })
                        : dateLabel
                    return (
                        <button
                            key={value}
                            type="button"
                            onClick={() => selectDate(value)}
                            aria-label={activityLabel}
                            aria-current={isToday ? 'date' : undefined}
                            title={hasSessionActivity ? activityLabel : undefined}
                            className={cn(
                                'h-8 rounded-lg text-xs transition-colors',
                                isEndpoint && 'bg-[var(--app-button)] text-[var(--app-button-text)]',
                                isInRange && 'bg-[var(--app-link)]/15 text-[var(--app-link)]',
                                !isEndpoint && !isInRange && isToday && 'bg-[var(--app-subtle-bg)]',
                                !isEndpoint && !isInRange && hasSessionActivity && 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]',
                                !isEndpoint && !isInRange && !hasSessionActivity && 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]'
                            )}
                        >
                            {index + 1}
                        </button>
                    )
                })}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-[var(--app-divider)] pt-2 text-xs">
                <span className="text-[var(--app-hint)]">
                    {!props.start
                        ? t('sessions.timeFilter.pickStart')
                        : !props.end
                            ? t('sessions.timeFilter.pickEnd')
                            : `${props.start} – ${props.end}`}
                </span>
                {props.start ? (
                    <button type="button" onClick={props.onClear} className="text-[var(--app-link)]">
                        {t('sessions.timeFilter.clear')}
                    </button>
                ) : null}
            </div>
        </div>
    )
}

function SessionListSearch(props: {
    value: string
    onChange: (value: string) => void
    customStart: string
    customEnd: string
    sessionActivityDates: ReadonlySet<string>
    onDateRangeChange: (start: string, end: string) => void
    expanded: boolean
    onExpandedChange: (expanded: boolean) => void
}) {
    const { t } = useTranslation()
    const [datePickerOpen, setDatePickerOpen] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const hasDateRange = Boolean(props.customStart && props.customEnd)
    const hasActiveFilters = props.value.length > 0 || hasDateRange

    useEffect(() => {
        if (props.expanded) {
            inputRef.current?.focus()
        } else {
            setDatePickerOpen(false)
        }
    }, [props.expanded])

    if (!props.expanded) {
        return (
            <button
                type="button"
                onClick={() => props.onExpandedChange(true)}
                className="relative shrink-0 rounded-full p-1.5 text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                title={t('sessions.search.open')}
                aria-label={t('sessions.search.open')}
            >
                <SearchIcon className="h-5 w-5" />
                {hasActiveFilters ? <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--app-link)]" /> : null}
            </button>
        )
    }

    return (
        <div
            className="relative min-w-0 flex-1"
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    props.onExpandedChange(false)
                }
            }}
        >
            <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[var(--app-hint)]">
                <SearchIcon className="h-3.5 w-3.5" />
            </div>
            <input
                ref={inputRef}
                type="search"
                value={props.value}
                onChange={(event) => props.onChange(event.target.value)}
                placeholder={t('sessions.search.placeholder')}
                className="w-full appearance-none rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] py-1.5 pl-8 pr-16 text-sm text-[var(--app-fg)] outline-none transition-colors placeholder:text-[var(--app-hint)] focus:border-[var(--app-link)] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
            />
            {props.value ? (
                <button
                    type="button"
                    onClick={() => {
                        props.onChange('')
                        // The clear button unmounts with the query; keep focus off <body>
                        // so a later outside click still routes blur through the wrapper.
                        inputRef.current?.focus()
                    }}
                    className="absolute inset-y-0 right-9 flex items-center rounded p-0.5 text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                    title={t('sessions.search.clear')}
                >
                    <XIcon className="h-3.5 w-3.5" />
                </button>
            ) : null}
            <div className="absolute inset-y-0 right-0 flex items-stretch">
                <button
                    type="button"
                    onClick={() => setDatePickerOpen(open => !open)}
                    className={cn(
                        'relative flex items-center rounded-r-lg rounded-l-md px-2 transition-colors hover:bg-[var(--app-subtle-bg)]',
                        hasDateRange ? 'text-[var(--app-link)]' : 'text-[var(--app-hint)]'
                    )}
                    title={hasDateRange ? `${props.customStart} – ${props.customEnd}` : t('sessions.timeFilter.label')}
                    aria-label={t('sessions.timeFilter.label')}
                    aria-expanded={datePickerOpen}
                >
                    <CalendarIcon className="h-5 w-5" />
                    {hasDateRange ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--app-link)]" /> : null}
                </button>
                {datePickerOpen ? (
                    <>
                        <button type="button" aria-label={t('sessions.timeFilter.close')} className="fixed inset-0 z-20 cursor-default" onClick={() => {
                            setDatePickerOpen(false)
                            inputRef.current?.focus()
                        }} />
                        <SessionDateRangePicker
                            start={props.customStart}
                            end={props.customEnd}
                            sessionActivityDates={props.sessionActivityDates}
                            onChange={props.onDateRangeChange}
                            onClear={() => {
                                props.onDateRangeChange('', '')
                                // The footer Clear button unmounts once the range is
                                // empty; return focus so the wrapper blur still works.
                                inputRef.current?.focus()
                            }}
                            onClose={() => {
                                setDatePickerOpen(false)
                                inputRef.current?.focus()
                            }}
                        />
                    </>
                ) : null}
            </div>
        </div>
    )
}

function SessionItem(props: {
    session: SessionSummary
    onSelect: (sessionId: string) => void
    showPath?: boolean
    api: ApiClient | null
    selected?: boolean
    showDetailedStatus?: boolean
}) {
    const { t } = useTranslation()
    const { session: s, onSelect, showPath = true, api, selected = false, showDetailedStatus = false } = props
    const { haptic } = usePlatform()
    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [renameOpen, setRenameOpen] = useState(false)
    const [exportOpen, setExportOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const {
        status: cursorChatStoreStatus,
        isApplicable: cursorChatStoreApplicable,
        error: cursorChatStoreError,
    } = useCursorChatStoreStatus({
        api,
        session: s,
        enabled: menuOpen
    })
    const cursorReopenDisabledReason = cursorChatStoreApplicable && cursorChatStoreStatus?.onDisk !== true
        ? cursorChatStoreError
            ? t('session.action.reopenCursorCheckFailed')
            : cursorChatStoreStatus?.onDisk === false
                ? t('session.action.reopenCursorMissing')
                : t('session.action.reopenCursorChecking')
        : undefined

    const { archiveSession, reopenSession, renameSession, deleteSession, isPending } = useSessionActions(
        api,
        s.id,
        s.metadata?.flavor ?? null
    )
    const [reopenError, setReopenError] = useState<string | null>(null)

    const handleReopen = async () => {
        setReopenError(null)
        try {
            const result = await reopenSession()
            // resumeSession may merge the row into a freshly-spawned sessionId.
            // Follow it so the operator lands on the live session.
            if (result.sessionId && result.sessionId !== s.id) {
                onSelect(result.sessionId)
            }
        } catch (error) {
            setReopenError(formatReopenError(error))
        }
    }

    const longPressHandlers = useLongPress({
        onLongPress: (point) => {
            haptic.impact('medium')
            setMenuAnchorPoint(point)
            setMenuOpen(true)
        },
        onClick: () => {
            if (!menuOpen) {
                onSelect(s.id)
            }
        },
        threshold: 500
    })

    const sessionName = getSessionTitle(s)
    const attention = useMemo(
        () => showDetailedStatus
            ? classifySessionAttention(s, {
                selected,
                lastSeenAt: getSessionLastSeenAt(s.id)
            })
            : null,
        [s, selected, showDetailedStatus]
    )
    const hasScheduleTooltip = showDetailedStatus && s.futureScheduledMessageCount > 0
    const { attentionId, scheduleId, describedBy } = useSessionRowTooltipIds(
        Boolean(attention),
        hasScheduleTooltip
    )
    return (
        <>
            <button
                type="button"
                {...longPressHandlers}
                className={`session-list-item group/session-row flex w-full flex-col gap-1 rounded-lg py-1.5 pl-2.5 pr-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] select-none ${selected ? 'bg-[var(--primary)] text-white shadow-sm' : 'text-[var(--sidebar-foreground)] hover:bg-[var(--secondary)]'}`}
                style={{ WebkitTouchCallout: 'none' }}
                aria-current={selected ? 'page' : undefined}
                aria-describedby={describedBy}
            >
                <SessionRowSummary
                    session={s}
                    showPath={showPath}
                    showDetailedStatus={showDetailedStatus}
                    selected={selected}
                    nestedTooltips
                    attentionTooltipId={attentionId}
                    scheduleTooltipId={scheduleId}
                />
            </button>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionId={s.id}
                sessionTitle={sessionName}
                sessionActive={s.active}
                onRename={() => setRenameOpen(true)}
                onExport={() => setExportOpen(true)}
                onArchive={() => setArchiveOpen(true)}
                onReopen={cursorReopenDisabledReason ? undefined : handleReopen}
                reopenDisabledReason={cursorReopenDisabledReason}
                onDelete={() => setDeleteOpen(true)}
                anchorPoint={menuAnchorPoint}
            />

            {reopenError ? (
                <ConfirmDialog
                    isOpen={true}
                    onClose={() => setReopenError(null)}
                    title={t('dialog.reopen.errorTitle')}
                    description={reopenError}
                    confirmLabel={t('dialog.reopen.dismiss')}
                    confirmingLabel={t('dialog.reopen.dismiss')}
                    onConfirm={async () => setReopenError(null)}
                    isPending={false}
                    centerTitle
                />
            ) : null}

            {renameOpen ? (
                <RenameSessionDialog
                    isOpen={true}
                    onClose={() => setRenameOpen(false)}
                    currentName={sessionName}
                    onRename={renameSession}
                    isPending={isPending}
                />
            ) : null}

            {exportOpen ? (
                <SessionExportDialog
                    isOpen={true}
                    onClose={() => setExportOpen(false)}
                    sessionId={s.id}
                    api={api}
                />
            ) : null}

            {archiveOpen ? (
                <ConfirmDialog
                    isOpen={true}
                    onClose={() => setArchiveOpen(false)}
                    title={t('dialog.archive.title')}
                    description={t('dialog.archive.description', { name: sessionName })}
                    confirmLabel={t('dialog.archive.confirm')}
                    confirmingLabel={t('dialog.archive.confirming')}
                    onConfirm={archiveSession}
                    isPending={isPending}
                    destructive
                    centerTitle
                />
            ) : null}

            {deleteOpen ? (
                <ConfirmDialog
                    isOpen={true}
                    onClose={() => setDeleteOpen(false)}
                    title={t('dialog.delete.title')}
                    description={t('dialog.delete.description', { name: sessionName })}
                    confirmLabel={t('dialog.delete.confirm')}
                    confirmingLabel={t('dialog.delete.confirming')}
                    onConfirm={deleteSession}
                    isPending={isPending}
                    destructive
                    centerTitle
                />
            ) : null}
        </>
    )
}

type PullToRefreshState = 'idle' | 'pulling' | 'ready'

const PULL_REFRESH_FEEDBACK_PX = 16
const PULL_REFRESH_TRIGGER_PX = 64

export function getPullToRefreshState(distancePx: number): PullToRefreshState {
    if (distancePx >= PULL_REFRESH_TRIGGER_PX) {
        return 'ready'
    }
    if (distancePx >= PULL_REFRESH_FEEDBACK_PX) {
        return 'pulling'
    }
    return 'idle'
}

export function SessionList(props: {
    sessions: SessionSummary[]
    onSelect: (sessionId: string) => void
    onNewSession: () => void
    onNewSessionInDirectory?: (args: { machineId: string | null; directory: string }) => void
    onBrowse?: () => void
    onRefresh: () => Promise<unknown> | void
    isLoading: boolean
    renderHeader?: boolean
    headerActions?: React.ReactNode
    api: ApiClient | null
    currentUser?: AuthResponse['user'] | null
    machineLabelsById?: Record<string, string>
    machinesById?: Record<string, Machine>
    selectedSessionId?: string | null
}) {
    const { t } = useTranslation()
    const { renderHeader = true, api, selectedSessionId, machineLabelsById = {}, machinesById = {}, onNewSessionInDirectory } = props
    const { sessionPreviewLimit } = useSessionPreviewLimit()
    const { sessionListStatusMode } = useSessionListStatusMode()
    const { showActiveSessionsOnly } = useShowActiveSessionsOnly()
    const { machineFilter, setMachineFilter } = useSessionListMachineFilter()
    const [projectFilter, setProjectFilterState] = useState<string | null>(readSessionListProjectFilter)
    const setProjectFilter = (projectId: string | null) => {
        setProjectFilterState(projectId)
        writeSessionListProjectFilter(projectId)
    }
    const queryClient = useQueryClient()
    const { addToast } = useToast()
    const { projects } = useProjects(api, Boolean(api))
    const showDetailedStatus = sessionListStatusMode === 'detailed'
    const [searchQuery, setSearchQuery] = useState('')
    const [searchExpanded, setSearchExpanded] = useState(false)
    const [customStart, setCustomStart] = useState('')
    const [customEnd, setCustomEnd] = useState('')
    const [, setCodexImportedSessionsVersion] = useState(0)
    const normalizedQuery = normalizeSearch(searchQuery)
    const timeRange = getSessionTimeRange(customStart, customEnd)
    const isFiltering = normalizedQuery.length > 0 || timeRange !== null
    const [groupAliases, setGroupAliases] = useState<SessionGroupAliases>(() => readSessionGroupAliases())
    const [editingGroup, setEditingGroup] = useState<{ key: string; draft: string } | null>(null)
    const editingGroupKey = editingGroup?.key ?? null
    const editInputRef = useRef<HTMLInputElement>(null)
    const skipNextGroupAliasBlurRef = useRef(false)
    const [moveTargetProjectIds, setMoveTargetProjectIds] = useState<Record<string, string>>({})
    const [moveErrors, setMoveErrors] = useState<Record<string, string | null>>({})
    const [codexSyncTarget, setCodexSyncTarget] = useState<CodexGroupSyncTarget | null>(null)
    const [codexSyncSessions, setCodexSyncSessions] = useState<CodexLocalSessionSummary[]>([])
    const [codexSyncMachineId, setCodexSyncMachineId] = useState<string | null>(null)
    const [codexSyncError, setCodexSyncError] = useState<string | null>(null)
    const [codexSyncJobs, setCodexSyncJobs] = useState<CodexImportJob[]>([])
    const [isLoadingCodexSyncSessions, setIsLoadingCodexSyncSessions] = useState(false)
    const [isQueueingCodexSync, setIsQueueingCodexSync] = useState(false)
    const [isRestartingCodexDesktop, setIsRestartingCodexDesktop] = useState(false)
    const completedCodexSyncJobIdsRef = useRef(new Set<string>())
    const currentUserId = props.currentUser?.id ?? null
    const projectsById = useMemo(
        () => new Map(projects.map((project) => [project.id, project])),
        [projects]
    )
    const moveDirectoryMutation = useMutation({
        mutationFn: async (input: {
            groupKey: string
            projectId: string
            machineId: string
            rootPath: string
            sourceWorkspaceId?: string
            targetProjectId: string
        }) => {
            if (!api) throw new Error('API unavailable')
            return await api.moveProjectDirectory(input.projectId, {
                targetProjectId: input.targetProjectId,
                machineId: input.machineId,
                rootPath: input.rootPath,
                sourceWorkspaceId: input.sourceWorkspaceId
            })
        },
        onMutate: (input) => {
            setMoveErrors(prev => ({ ...prev, [input.groupKey]: null }))
        },
        onSuccess: async (_result, input) => {
            setMoveTargetProjectIds(prev => ({ ...prev, [input.groupKey]: '' }))
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
                queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            ])
        },
        onError: (error, input) => {
            setMoveErrors(prev => ({
                ...prev,
                [input.groupKey]: error instanceof Error ? error.message : t('dialog.error.default')
            }))
        }
    })

    const loadCodexSyncSessions = useCallback(async (target: CodexGroupSyncTarget) => {
        if (!api) return
        setIsLoadingCodexSyncSessions(true)
        setCodexSyncError(null)
        try {
            const result = await api.getCodexSessions(target.directory, target.machineId)
            if (!result.success) {
                throw new Error(result.error)
            }
            const targetMachine = machinesById[target.machineId]
            const caseInsensitive = isWindowsPathContext(
                targetMachine,
                target.directory,
                ...result.sessions.map((session) => session.cwd)
            )
            const targetDirectory = normalizeComparablePath(target.directory, caseInsensitive)
            setCodexSyncSessions(result.sessions.filter((session) => {
                const cwd = session.cwd?.trim()
                return Boolean(cwd && normalizeComparablePath(cwd, caseInsensitive) === targetDirectory)
            }))
            setCodexSyncMachineId(result.machineId ?? target.machineId)
        } catch (error) {
            const message = error instanceof Error ? error.message : t('codexSync.failed.body')
            setCodexSyncSessions([])
            setCodexSyncMachineId(null)
            setCodexSyncError(message)
            addToast({
                title: t('codexSync.failed.title'),
                body: message,
                sessionId: '',
                url: ''
            })
        } finally {
            setIsLoadingCodexSyncSessions(false)
        }
    }, [addToast, api, machinesById, t])

    const loadCodexSyncJobs = useCallback(async () => {
        if (!api) return
        try {
            const result = await api.getCodexImportJobs()
            if (result.success) {
                setCodexSyncJobs(result.jobs)
            }
        } catch {
            // Best-effort polling; queue start/success/failure also arrives over SSE.
        }
    }, [api])

    const openCodexSyncDialog = useCallback((target: CodexGroupSyncTarget) => {
        setCodexSyncTarget(target)
        setCodexSyncSessions([])
        setCodexSyncMachineId(null)
        setCodexSyncError(null)
        void loadCodexSyncSessions(target)
        void loadCodexSyncJobs()
    }, [loadCodexSyncJobs, loadCodexSyncSessions])

    const closeCodexSyncDialog = useCallback(() => {
        setCodexSyncTarget(null)
        setCodexSyncError(null)
    }, [])

    const hasActiveCodexSyncJobs = useMemo(
        () => codexSyncJobs.some((job) => job.status === 'queued' || job.status === 'running'),
        [codexSyncJobs]
    )

    useEffect(() => {
        if (!codexSyncTarget && !hasActiveCodexSyncJobs) return

        void loadCodexSyncJobs()
        const timer = setInterval(() => {
            void loadCodexSyncJobs()
        }, 2000)
        return () => clearInterval(timer)
    }, [codexSyncTarget, hasActiveCodexSyncJobs, loadCodexSyncJobs])

    useEffect(() => {
        let shouldRefreshSessions = false
        for (const job of codexSyncJobs) {
            if ((job.status === 'queued' || job.status === 'running') || completedCodexSyncJobIdsRef.current.has(job.id)) {
                continue
            }
            completedCodexSyncJobIdsRef.current.add(job.id)
            const importedCodexSessionIds = job.items
                .filter((item) => item.status === 'succeeded' || (item.status === 'skipped' && Boolean(item.hapiSessionId)))
                .map((item) => item.codexSessionId)
            if (importedCodexSessionIds.length > 0) {
                markCodexSessionsImported(importedCodexSessionIds)
                shouldRefreshSessions = true
            }
        }
        if (shouldRefreshSessions) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        }
    }, [codexSyncJobs, queryClient])

    const queueCodexSyncSessions = useCallback(async (sessionIds: string[]) => {
        if (!api || !codexSyncTarget || isQueueingCodexSync) return
        setIsQueueingCodexSync(true)
        setCodexSyncError(null)
        try {
            const result = await api.createCodexImportJob({
                sessionIds,
                projectId: codexSyncTarget.projectId,
                cwd: codexSyncTarget.directory,
                machineId: codexSyncMachineId ?? codexSyncTarget.machineId
            })
            if (!result.success) {
                throw new Error(result.error)
            }
            setCodexSyncJobs((current) => [result.job, ...current.filter((job) => job.id !== result.job.id)])
            addToast({
                title: t('codexSync.importQueue.queued.title'),
                body: t('codexSync.importQueue.queued.body', { n: result.job.totalItems }),
                sessionId: '',
                url: ''
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : t('codexSync.importQueue.failed.body')
            setCodexSyncError(message)
            addToast({
                title: t('codexSync.failed.title'),
                body: message,
                sessionId: '',
                url: ''
            })
        } finally {
            setIsQueueingCodexSync(false)
        }
    }, [addToast, api, codexSyncMachineId, codexSyncTarget, isQueueingCodexSync, t])

    const restartCodexDesktopForSync = useCallback(async () => {
        if (!api) return
        setIsRestartingCodexDesktop(true)
        try {
            const result = await api.restartCodexDesktop()
            if (!result.success) {
                throw new Error(result.error || t('codexSync.restart.failed.body'))
            }
            addToast({
                title: t('codexSync.restart.started.title'),
                body: t('codexSync.restart.started.body'),
                sessionId: '',
                url: ''
            })
        } catch (error) {
            addToast({
                title: t('codexSync.restart.failed.title'),
                body: error instanceof Error ? error.message : t('codexSync.restart.failed.body'),
                sessionId: '',
                url: ''
            })
        } finally {
            setIsRestartingCodexDesktop(false)
        }
    }, [addToast, api, t])

    useEffect(() => {
        // 中文注释：监听导入标记变化，让列表在“导入完成”或“用户已在 Hapi 中继续会话”后立即刷新时间文案。
        return subscribeCodexImportedSessions(() => {
            setCodexImportedSessionsVersion((value) => value + 1)
        })
    }, [])

    useEffect(() => {
        if (!editingGroupKey) return
        editInputRef.current?.focus()
        editInputRef.current?.select()
    }, [editingGroupKey])

    useEffect(() => {
        if (typeof window === 'undefined') return
        const handleStorage = (event: StorageEvent) => {
            if (event.key === SESSION_GROUP_ALIAS_STORAGE_KEY) {
                setGroupAliases(readSessionGroupAliases())
            }
        }
        window.addEventListener('storage', handleStorage)
        return () => window.removeEventListener('storage', handleStorage)
    }, [])

    const startRenamingGroup = (group: SessionGroup, displayName: string) => {
        skipNextGroupAliasBlurRef.current = false
        setEditingGroup({
            key: group.key,
            draft: groupAliases[group.key] ?? displayName
        })
    }

    const updateGroupAliasDraft = (value: string) => {
        setEditingGroup(prev => prev ? { ...prev, draft: value } : prev)
    }

    const commitGroupAlias = (group: SessionGroup, draft: string) => {
        const alias = draft.trim()
        setGroupAliases(prev => {
            const next = { ...prev }
            if (!alias || alias === group.displayName) {
                delete next[group.key]
            } else {
                next[group.key] = alias
            }
            writeSessionGroupAliases(next)
            return next
        })
        setEditingGroup(null)
    }

    const cancelGroupAliasEdit = () => {
        skipNextGroupAliasBlurRef.current = true
        setEditingGroup(null)
    }

    const resolveMachineLabel = (machineId: string | null): string => {
        if (machineId && machineLabelsById[machineId]) {
            return machineLabelsById[machineId]
        }
        if (machineId) {
            return machineId.slice(0, 8)
        }
        return t('machine.unknown')
    }

    const allSessions = useMemo(
        () => {
            const prepared = prepareSidebarSessions(props.sessions, selectedSessionId)
            return showActiveSessionsOnly ? filterActiveSessionsOnly(prepared, selectedSessionId) : prepared
        },
        [props.sessions, selectedSessionId, showActiveSessionsOnly]
    )
    const sessionActivityDates = useMemo(
        () => new Set(allSessions.map(session => formatDateValue(new Date(session.updatedAt)))),
        [allSessions]
    )
    const visibleSessions = useMemo(
        () => isFiltering
            ? allSessions.filter(session => (
                sessionMatchesTimeRange(session, timeRange)
                && sessionMatchesQuery(
                    session,
                    normalizedQuery,
                    resolveMachineLabel(session.metadata?.machineId ?? null)
                )
            ))
            : allSessions,
        [allSessions, isFiltering, normalizedQuery, timeRange?.start, timeRange?.end, machineLabelsById] // eslint-disable-line react-hooks/exhaustive-deps
    )
    const allGroups = useMemo(
        () => groupSessionsByDirectory(allSessions),
        [allSessions]
    )
    const knownMachineIds = useMemo(
        () => Object.keys(machinesById),
        [machinesById]
    )
    const machineFilters = useMemo(
        () => groupByMachine(allGroups, resolveMachineLabel, knownMachineIds),
        [allGroups, machineLabelsById, knownMachineIds] // eslint-disable-line react-hooks/exhaustive-deps
    )
    const showMachineFilterBar = machineFilters.length >= 1
    const machineFilterItems = useMemo(
        () => machineFilters.map((mg) => {
            const machine = mg.machineId ? machinesById[mg.machineId] : undefined
            return {
                id: mg.machineId ?? UNKNOWN_MACHINE_ID,
                label: mg.label,
                sessionCount: mg.totalSessions,
                healthPresentation: presentMachineHealth(
                    machine?.health,
                    getMachinePlatform(machine)
                )
            }
        }),
        [machineFilters, machinesById]
    )
    // Persisted filters whose machine/project no longer exists fall back to All.
    const machineFilterIds = useMemo(
        () => new Set(machineFilters.map(mg => mg.machineId ?? UNKNOWN_MACHINE_ID)),
        [machineFilters]
    )
    const activeMachineFilters = showMachineFilterBar
        ? machineFilter.filter((id) => machineFilterIds.has(id))
        : []
    const projectFilterItems = useMemo<ProjectFilterItem[]>(() => {
        const counts = new Map<string, number>()
        for (const session of allSessions) {
            if (session.projectId) counts.set(session.projectId, (counts.get(session.projectId) ?? 0) + 1)
        }
        return projects.map((project) => ({
            id: project.id,
            label: project.name,
            sessionCount: counts.get(project.id) ?? 0
        })).sort((a, b) => {
            if (a.sessionCount !== b.sessionCount) return b.sessionCount - a.sessionCount
            return a.label.localeCompare(b.label)
        })
    }, [allSessions, projects])
    const activeProjectFilter = projectFilter && projectFilterItems.some((project) => project.id === projectFilter)
        ? projectFilter
        : null
    const filteredSessions = useMemo(
        () => visibleSessions.filter((session) => (
            (activeMachineFilters.length === 0 || activeMachineFilters.includes(session.metadata?.machineId ?? UNKNOWN_MACHINE_ID))
            && (activeProjectFilter === null || session.projectId === activeProjectFilter)
        )),
        [visibleSessions, activeMachineFilters, activeProjectFilter]
    )
    const groups = useMemo(
        () => groupSessionsByDirectory(filteredSessions),
        [filteredSessions]
    )
    const [collapseOverrides, setCollapseOverrides] = useState<Map<string, boolean>>(
        () => new Map()
    )
    const autoExpandedSelectedSessionKeyRef = useRef<string | null>(null)
    const isGroupCollapsed = (group: SessionGroup): boolean => {
        if (isFiltering) return false
        const override = collapseOverrides.get(group.key)
        if (override !== undefined) return override
        const hasSelectedSession = selectedSessionId
            ? group.sessions.some(session => session.id === selectedSessionId)
            : false
        return !group.hasActiveSession && !hasSelectedSession
    }

    const toggleGroup = (groupKey: string, isCollapsed: boolean) => {
        setCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(groupKey, !isCollapsed)
            return next
        })
    }

    // Per-group reveal cap for paginated session previews. Absent = the configured
    // preview limit; expand/collapse controls move the cap by one preview-sized batch.
    const [sessionVisibleCounts, setSessionVisibleCounts] = useState<Map<string, number>>(
        () => new Map()
    )

    const getGroupVisibleCount = (group: SessionGroup): number => {
        return sessionVisibleCounts.get(group.key) ?? sessionPreviewLimit
    }

    const showMoreSessions = (group: SessionGroup) => {
        setSessionVisibleCounts(prev => {
            const next = new Map(prev)
            const currentLimit = Math.min(
                prev.get(group.key) ?? sessionPreviewLimit,
                group.sessions.length
            )
            const currentVisibleCount = getVisibleSessionPreview(group.sessions, {
                selectedSessionId,
                limit: currentLimit
            }).length
            next.set(group.key, getNextSessionVisibleCount(
                Math.max(currentLimit, currentVisibleCount),
                sessionPreviewLimit,
                group.sessions.length
            ))
            return next
        })
    }

    const showFewerSessions = (group: SessionGroup) => {
        setSessionVisibleCounts(prev => {
            const next = new Map(prev)
            const current = Math.min(
                prev.get(group.key) ?? sessionPreviewLimit,
                group.sessions.length
            )
            const previous = getPreviousSessionVisibleCount(current, sessionPreviewLimit)
            if (previous <= sessionPreviewLimit) {
                next.delete(group.key)
            } else {
                next.set(group.key, previous)
            }
            return next
        })
    }

    const getVisibleGroupSessions = (group: SessionGroup): SessionSummary[] => {
        return getVisibleSessionPreview(
            group.sessions,
            {
                selectedSessionId,
                limit: getGroupVisibleCount(group)
            }
        )
    }

    // Auto-expand group containing the selected session only when
    // the selected-session/group pair changes. Without this guard, every live
    // session-list refresh (for example tool-call updates from a running selected
    // session) reopens a path the user just collapsed.
    useEffect(() => {
        if (!selectedSessionId) {
            autoExpandedSelectedSessionKeyRef.current = null
            return
        }

        const group = allGroups.find(g =>
            g.sessions.some(s => s.id === selectedSessionId)
        )
        if (!group) return

        const autoExpandKey = `${selectedSessionId}::${group.key}`
        if (autoExpandedSelectedSessionKeyRef.current === autoExpandKey) return
        autoExpandedSelectedSessionKeyRef.current = autoExpandKey

        setCollapseOverrides(prev => expandSelectedSessionCollapseOverrides(prev, group))
    }, [selectedSessionId, allGroups])

    // Clean up stale collapse overrides
    useEffect(() => {
        setCollapseOverrides(prev => {
            if (prev.size === 0) return prev
            const next = new Map(prev)
            const knownKeys = new Set<string>()
            for (const g of allGroups) {
                knownKeys.add(g.key)
                knownKeys.add(`sessions::${g.key}`)
            }
            let changed = false
            for (const key of next.keys()) {
                if (!knownKeys.has(key)) {
                    next.delete(key)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }, [allGroups])

    // Clean up reveal caps for groups that no longer exist.
    useEffect(() => {
        setSessionVisibleCounts(prev => {
            if (prev.size === 0) return prev
            const knownKeys = new Set(allGroups.map(g => g.key))
            const next = new Map(prev)
            let changed = false
            for (const key of next.keys()) {
                if (!knownKeys.has(key)) {
                    next.delete(key)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }, [allGroups])

    // The search control unmounts when the list empties; reset the expansion so
    // it cannot suppress header actions (or re-expand on its own when sessions
    // return) while no search control is rendered.
    const showSearch = props.sessions.length > 0
    useEffect(() => {
        if (!showSearch) setSearchExpanded(false)
    }, [showSearch])

    const showHeaderRow = showSearch || renderHeader || Boolean(props.headerActions)

    // Pull-to-refresh on the scrollable list. Touch-only gesture mirroring the
    // pull-to-load-older pattern in HappyThread; desktop has no overscroll
    // bounce to make a wheel pull feel right, so it stays on live updates.
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    const [pullState, setPullState] = useState<PullToRefreshState>('idle')
    const pullStateRef = useRef<PullToRefreshState>('idle')
    const [isRefreshing, setIsRefreshing] = useState(false)
    const isRefreshingRef = useRef(false)
    const onRefreshRef = useRef(props.onRefresh)
    useEffect(() => {
        onRefreshRef.current = props.onRefresh
    }, [props.onRefresh])

    useEffect(() => {
        const container = scrollContainerRef.current
        if (!container) return

        let pullStartY: number | null = null

        const updatePullState = (state: PullToRefreshState) => {
            if (pullStateRef.current === state) {
                return
            }
            pullStateRef.current = state
            setPullState(state)
        }

        const triggerRefresh = () => {
            if (isRefreshingRef.current) {
                return
            }
            isRefreshingRef.current = true
            setIsRefreshing(true)
            void Promise.resolve(onRefreshRef.current()).finally(() => {
                isRefreshingRef.current = false
                setIsRefreshing(false)
            })
        }

        const handleTouchStart = (event: TouchEvent) => {
            updatePullState('idle')
            pullStartY = container.scrollTop <= 0 && !isRefreshingRef.current
                ? event.touches[0]?.clientY ?? null
                : null
        }

        const handleTouchMove = (event: TouchEvent) => {
            if (pullStartY === null) {
                return
            }
            if (container.scrollTop > 0) {
                pullStartY = null
                updatePullState('idle')
                return
            }
            const currentY = event.touches[0]?.clientY
            if (currentY !== undefined) {
                updatePullState(getPullToRefreshState(currentY - pullStartY))
            }
        }

        const handleTouchEnd = () => {
            const shouldRefresh = pullStartY !== null
                && pullStateRef.current === 'ready'
                && container.scrollTop <= 0
            pullStartY = null
            updatePullState('idle')
            if (shouldRefresh) {
                triggerRefresh()
            }
        }

        const handleTouchCancel = () => {
            pullStartY = null
            updatePullState('idle')
        }

        container.addEventListener('touchstart', handleTouchStart, { passive: true })
        container.addEventListener('touchmove', handleTouchMove, { passive: true })
        container.addEventListener('touchend', handleTouchEnd, { passive: true })
        container.addEventListener('touchcancel', handleTouchCancel, { passive: true })
        return () => {
            container.removeEventListener('touchstart', handleTouchStart)
            container.removeEventListener('touchmove', handleTouchMove)
            container.removeEventListener('touchend', handleTouchEnd)
            container.removeEventListener('touchcancel', handleTouchCancel)
        }
    }, [])

    return (
        <div className="flex min-h-0 w-full flex-1 flex-col">
            <div className="session-list-scrollbar-offset mx-auto w-full max-w-content shrink-0">
            {showHeaderRow ? (
                <div className="flex items-center gap-1 px-2 py-1">
                    {showSearch ? (
                        <SessionListSearch
                            value={searchQuery}
                            onChange={setSearchQuery}
                            customStart={customStart}
                            customEnd={customEnd}
                            sessionActivityDates={sessionActivityDates}
                            onDateRangeChange={(start, end) => {
                                setCustomStart(start)
                                setCustomEnd(end)
                            }}
                            expanded={searchExpanded}
                            onExpandedChange={setSearchExpanded}
                        />
                    ) : null}
                    {!(showSearch && searchExpanded) ? (
                        <>
                            {showMachineFilterBar ? (
                                <MachineFilterDropdown
                                    machines={machineFilterItems}
                                    totalCount={allSessions.length}
                                    value={activeMachineFilters}
                                    onChange={setMachineFilter}
                                    projects={projectFilterItems}
                                    projectValue={activeProjectFilter}
                                    onProjectChange={setProjectFilter}
                                    className="flex-1"
                                />
                            ) : <div className="flex-1" />}
                            {renderHeader ? (
                                <button
                                    type="button"
                                    onClick={props.onNewSession}
                                    className="session-list-new-button flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--primary)] transition-colors"
                                    title={t('sessions.new')}
                                >
                                    <PlusIcon className="h-5 w-5" />
                                </button>
                            ) : null}
                            {props.headerActions}
                        </>
                    ) : null}
                </div>
            ) : null}

            </div>

            <div className="relative flex min-h-0 flex-1 flex-col">
            {isRefreshing || pullState !== 'idle' || props.isLoading ? (
                <div
                    role="status"
                    aria-live="polite"
                    className="pointer-events-none absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--app-border)] bg-[var(--app-bg)]/90 px-2.5 py-1 text-xs text-[var(--app-hint)] shadow-sm backdrop-blur"
                >
                    {isRefreshing || props.isLoading ? <Spinner size="sm" label={null} className="text-current" /> : null}
                    <span>
                        {isRefreshing
                            ? t('sessions.refresh.refreshing')
                            : props.isLoading
                                ? t('misc.loading')
                                : pullState === 'ready'
                                    ? t('sessions.refresh.release')
                                    : t('sessions.refresh.pull')}
                    </span>
                </div>
            ) : null}
            <div ref={scrollContainerRef} className="app-scroll-y session-list-scrollbar-left min-h-0 flex-1">
            <div className="mx-auto flex w-full max-w-content flex-col gap-1 pl-1.5 pr-2 pb-2">
                {props.sessions.length === 0 && !props.isLoading ? (
                    <SessionsEmptyState
                        onNewSession={props.onNewSession}
                        onBrowse={props.onBrowse}
                    />
                ) : null}

                {props.sessions.length > 0 && (isFiltering || activeMachineFilters.length > 0 || activeProjectFilter !== null) && groups.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-[var(--app-hint)]">
                        {t('sessions.search.noResults')}
                    </div>
                ) : null}

                {groups.map((group) => {
                    const isCollapsed = isGroupCollapsed(group)
                    const visibleGroupSessions = getVisibleGroupSessions(group)
                    const hiddenSessionCount = group.sessions.length - visibleGroupSessions.length
                    const currentLimit = Math.min(
                        getGroupVisibleCount(group),
                        group.sessions.length
                    )
                    const previousLimit = getPreviousSessionVisibleCount(currentLimit, sessionPreviewLimit)
                    const previousGroupSessions = getVisibleSessionPreview(group.sessions, {
                        selectedSessionId,
                        limit: previousLimit
                    })
                    const collapseCount = visibleGroupSessions.length - previousGroupSessions.length
                    const canShowFewerSessions = previousLimit < currentLimit && collapseCount > 0
                    const expandCount = Math.min(sessionPreviewLimit, hiddenSessionCount)
                    const canStartInGroupDirectory = group.directory !== 'Other'
                    // With multiple machines in the unfiltered view, disambiguate
                    // same-named directories by suffixing the machine label.
                    const groupDisplayName = groupAliases[group.key] ?? group.displayName
                    const groupMachineSuffix = showMachineFilterBar && activeMachineFilters.length === 0
                        ? resolveMachineLabel(group.machineId)
                        : null
                    const groupTitle = groupMachineSuffix
                        ? `${groupDisplayName} · ${groupMachineSuffix}`
                        : groupDisplayName
                    const activeGroupEdit = editingGroup?.key === group.key ? editingGroup : null
                    const primaryProjectId = getPrimaryProjectId(group)
                    const workspaceMatch = findWorkspaceForGroup(group, projects, machinesById)
                    const groupProject = primaryProjectId
                        ? projectsById.get(primaryProjectId) ?? workspaceMatch?.project ?? null
                        : workspaceMatch?.project ?? null
                    const workspaceForGroup = workspaceMatch && workspaceMatch.project.id === groupProject?.id
                        ? workspaceMatch.workspace
                        : null
                    const exactWorkspace = Boolean(workspaceMatch && workspaceMatch.project.id === groupProject?.id && workspaceMatch.exact)
                    const shared = isSharedProject(groupProject, currentUserId)
                    const sharedByLabel = shared ? getProjectOwnerLabel(groupProject) : ''
                    const moveTargets = !shared && groupProject && group.machineId && canManageProject(groupProject)
                        ? projects
                            .filter((project) => project.id !== groupProject.id)
                            .filter((project) => canManageProject(project))
                            .filter((project) => !isSharedProject(project, currentUserId))
                        : []
                    const selectedMoveTargetId = moveTargetProjectIds[group.key] ?? ''
                    const isMovingGroup = moveDirectoryMutation.isPending
                        && moveDirectoryMutation.variables?.groupKey === group.key
                    const groupMachineId = group.machineId
                    const canSyncCodexSessions = Boolean(api && groupMachineId && canStartInGroupDirectory && groupHasCodexSessions(group))
                    const groupStatusCounts = getSessionGroupStatusCounts(group)
                    return (
                        <div key={group.key}>
                            <div
                                className={cn(
                                    'group/project sticky top-0 z-10 flex min-w-0 w-full cursor-pointer select-none items-center gap-2 rounded-lg border border-transparent bg-[var(--sidebar)] py-1.5 pl-2 pr-2 text-left transition-colors hover:bg-[var(--secondary)]',
                                    groupStatusCounts.pending > 0 && 'border-amber-500/25 bg-amber-500/5',
                                    groupStatusCounts.pending === 0 && groupStatusCounts.active > 0 && 'border-[var(--app-link)]/20 bg-[var(--app-link)]/5'
                                )}
                                onClick={() => {
                                    if (activeGroupEdit) return
                                    toggleGroup(group.key, isCollapsed)
                                }}
                                title={group.directory}
                            >
                                <ChevronIcon className="h-3.5 w-3.5 text-[var(--app-hint)] shrink-0" collapsed={isCollapsed} />
                                {activeGroupEdit ? (
                                    <>
                                        <input
                                            ref={editInputRef}
                                            value={activeGroupEdit.draft}
                                            onClick={(event) => event.stopPropagation()}
                                            onChange={(event) => updateGroupAliasDraft(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    event.preventDefault()
                                                    event.stopPropagation()
                                                    commitGroupAlias(group, activeGroupEdit.draft)
                                                } else if (event.key === 'Escape') {
                                                    event.preventDefault()
                                                    event.stopPropagation()
                                                    cancelGroupAliasEdit()
                                                }
                                            }}
                                            onBlur={() => {
                                                if (skipNextGroupAliasBlurRef.current) {
                                                    skipNextGroupAliasBlurRef.current = false
                                                    return
                                                }
                                                commitGroupAlias(group, activeGroupEdit.draft)
                                            }}
                                            className="min-w-0 flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-1.5 py-0.5 text-sm font-medium text-[var(--app-fg)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                                            aria-label={t('sessions.group.renameInput')}
                                            placeholder={t('sessions.group.renamePlaceholder')}
                                        />
                                        {groupMachineSuffix ? (
                                            <span className="shrink-0 text-sm font-medium text-[var(--app-hint)]">
                                                · {groupMachineSuffix}
                                            </span>
                                        ) : null}
                                    </>
                                ) : (
                                    <span className="font-medium text-sm truncate flex-1">
                                        {groupTitle}
                                    </span>
                                )}
                                {!activeGroupEdit && groupStatusCounts.pending > 0 ? (
                                    <span
                                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-amber-700 dark:text-amber-300"
                                        title={t('sessions.group.pending', { n: groupStatusCounts.pending })}
                                    >
                                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                                        {groupStatusCounts.pending}
                                    </span>
                                ) : !activeGroupEdit && groupStatusCounts.active > 0 ? (
                                    <span
                                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--app-link)]/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--app-link)]"
                                        title={t('sessions.group.active', { n: groupStatusCounts.active })}
                                    >
                                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--app-link)]" aria-hidden="true" />
                                        {groupStatusCounts.active}
                                    </span>
                                ) : null}
                                {!activeGroupEdit && shared ? (
                                    <span
                                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] text-[var(--app-hint)]"
                                        title={t('sessions.group.shared')}
                                        aria-label={t('sessions.group.shared')}
                                    >
                                        <ShareIcon className="h-3 w-3" />
                                    </span>
                                ) : null}
                                {!activeGroupEdit ? (
                                    <SessionGroupActionMenu
                                        title={groupTitle}
                                        group={group}
                                        project={groupProject}
                                        workspace={workspaceForGroup}
                                        exactWorkspace={exactWorkspace}
                                        isShared={shared}
                                        sharedByLabel={sharedByLabel}
                                        machineLabel={resolveMachineLabel(group.machineId)}
                                        moveTargets={moveTargets}
                                        selectedMoveTargetId={selectedMoveTargetId}
                                        moveError={moveErrors[group.key] ?? null}
                                        isMoving={isMovingGroup}
                                        canStartInGroupDirectory={canStartInGroupDirectory}
                                        canSyncCodexSessions={canSyncCodexSessions}
                                        onRename={() => startRenamingGroup(group, groupDisplayName)}
                                        onSyncCodexSessions={canSyncCodexSessions && groupMachineId
                                            ? () => openCodexSyncDialog({
                                                groupKey: group.key,
                                                directory: group.directory,
                                                machineId: groupMachineId,
                                                projectId: groupProject?.id ?? primaryProjectId
                                            })
                                            : undefined}
                                        onNewSessionInDirectory={onNewSessionInDirectory
                                            ? () => onNewSessionInDirectory({
                                                machineId: group.machineId,
                                                directory: group.directory
                                            })
                                            : undefined}
                                        onMoveTargetChange={(projectId) => {
                                            setMoveTargetProjectIds(prev => ({ ...prev, [group.key]: projectId }))
                                        }}
                                        onMove={() => {
                                            if (!groupProject || !group.machineId || !selectedMoveTargetId) return
                                            moveDirectoryMutation.mutate({
                                                groupKey: group.key,
                                                projectId: groupProject.id,
                                                machineId: group.machineId,
                                                rootPath: group.directory,
                                                ...(exactWorkspace && workspaceForGroup ? { sourceWorkspaceId: workspaceForGroup.id } : {}),
                                                targetProjectId: selectedMoveTargetId
                                            })
                                        }}
                                    />
                                ) : null}
                                <span className="text-[11px] tabular-nums text-[var(--app-hint)] shrink-0">
                                    ({group.sessions.length})
                                </span>
                            </div>

                            {/* Sessions */}
                            <div className="collapsible-panel" data-open={!isCollapsed || undefined}>
                                <div className="collapsible-inner">
                                <div className="ml-3 flex flex-col gap-0.5 border-l border-[var(--app-divider)] py-1 pl-1.5">
                                    {visibleGroupSessions.map((s) => (
                                        <SessionItem
                                            key={s.id}
                                            session={s}
                                            onSelect={props.onSelect}
                                            showPath={false}
                                            api={api}
                                            selected={s.id === selectedSessionId}
                                            showDetailedStatus={showDetailedStatus}
                                        />
                                    ))}
                                    {group.sessions.length > sessionPreviewLimit && (hiddenSessionCount > 0 || canShowFewerSessions) ? (
                                        <div className="ml-2.5 mr-2 my-1 flex gap-1.5">
                                            {canShowFewerSessions ? (
                                                <button
                                                    type="button"
                                                    onClick={() => showFewerSessions(group)}
                                                    className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-dashed border-[var(--app-border)] px-2 py-1 text-center text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                                                >
                                                    <SessionPreviewArrowIcon direction="up" className="h-3 w-3 shrink-0" />
                                                    {t('sessions.group.collapse', { n: collapseCount })}
                                                </button>
                                            ) : null}
                                            {hiddenSessionCount > 0 ? (
                                                <button
                                                    type="button"
                                                    onClick={() => showMoreSessions(group)}
                                                    className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-dashed border-[var(--app-border)] px-2 py-1 text-center text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                                                >
                                                    <SessionPreviewArrowIcon direction="down" className="h-3 w-3 shrink-0" />
                                                    {t('sessions.group.expand', { n: expandCount })}
                                                </button>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </div>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
            </div>
            </div>
            {codexSyncTarget ? (
                <CodexSessionSyncDialog
                    isOpen={true}
                    onClose={closeCodexSyncDialog}
                    sessions={codexSyncSessions}
                    currentCodexSessionId={null}
                    currentWorkDirectory={codexSyncTarget.directory}
                    selectionMode="multiple"
                    onConfirm={queueCodexSyncSessions}
                    onRestartCodexDesktop={restartCodexDesktopForSync}
                    importJobs={codexSyncJobs}
                    error={codexSyncError}
                    isPending={isQueueingCodexSync}
                    isRestartingCodexDesktop={isRestartingCodexDesktop}
                    isLoading={isLoadingCodexSyncSessions}
                />
            ) : null}
        </div>
    )
}
