import { useEffect, useMemo, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { EnterpriseUser, Machine, ProjectMember, ProjectRole, ProjectWithDetails, ProjectWorkspace } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { useMachines } from '@/hooks/queries/useMachines'
import { useProjects } from '@/hooks/queries/useProjects'
import { getMachineTitle } from '@/hooks/useMachineLabels'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { queryKeys } from '@/lib/query-keys'
import { SettingsPageContent, SettingsSection } from '@/components/settings/SettingsPrimitives'
import { WorkspaceBrowser } from '@/components/WorkspaceBrowser'

const MEMBER_ROLES: ProjectRole[] = ['viewer', 'editor', 'admin', 'owner']
const INVITE_ROLES: ProjectRole[] = ['editor', 'viewer', 'admin']

function canManageProject(role: ProjectRole): boolean {
    return role === 'owner' || role === 'admin'
}

function roleOptionsForActor(actorRole: ProjectRole, includeOwner: boolean): ProjectRole[] {
    return includeOwner && actorRole === 'owner'
        ? MEMBER_ROLES
        : MEMBER_ROLES.filter((role) => role !== 'owner')
}

function buildInviteUrl(token: string, baseUrl: string): string {
    const url = new URL(`/invite/${encodeURIComponent(token)}`, window.location.origin)
    if (baseUrl) {
        try {
            const hubUrl = new URL(baseUrl)
            if (hubUrl.origin !== window.location.origin) {
                url.searchParams.set('server', baseUrl)
            }
        } catch {
            url.searchParams.set('server', baseUrl)
        }
    }
    return url.toString()
}

function normalizeSearch(value: string | null | undefined): string {
    return (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function fuzzyMatch(value: string, query: string): boolean {
    if (!query) return true
    if (value.includes(query)) return true

    let queryIndex = 0
    for (const character of value) {
        if (character === query[queryIndex]) {
            queryIndex += 1
            if (queryIndex === query.length) return true
        }
    }
    return false
}

function getUserLabel(user: EnterpriseUser): string {
    const displayName = user.displayName?.trim()
    const username = user.username?.trim()
    if (displayName && username && displayName !== username) {
        return `${displayName} (@${username})`
    }
    return displayName || (username ? `@${username}` : `User ${user.id}`)
}

function getUserSearchText(user: EnterpriseUser): string {
    return normalizeSearch([
        user.username,
        user.displayName
    ].filter(Boolean).join(' '))
}

function userMatchesQuery(user: EnterpriseUser, query: string): boolean {
    const normalizedQuery = normalizeSearch(query)
    if (!normalizedQuery) return true
    return fuzzyMatch(getUserSearchText(user), normalizedQuery)
}

function RoleBadge(props: { role: ProjectRole }) {
    const { t } = useTranslation()
    return (
        <span className="rounded-full bg-[var(--app-subtle-bg)] px-2 py-0.5 text-xs font-medium text-[var(--app-hint)]">
            {t(`settings.projects.role.${props.role}`)}
        </span>
    )
}

function MachineOption(props: { machine: Machine }) {
    const label = getMachineTitle(props.machine)
    const host = props.machine.metadata?.host
    const platform = props.machine.metadata?.platform
    const suffix = [host && host !== label ? host : null, platform].filter(Boolean).join(' · ')
    return (
        <option value={props.machine.id}>
            {suffix ? `${label} (${suffix})` : label}
        </option>
    )
}

function ProjectDirectoryPicker(props: {
    api: ApiClient
    machine: Machine | null
    disabled: boolean
    onChange: (path: string) => void
}) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const workspaceRoots = props.machine?.metadata?.workspaceRoots ?? []
    const browseDisabled = props.disabled || !props.machine || workspaceRoots.length === 0

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    disabled={browseDisabled}
                    aria-label={t('settings.projects.workspace.browseAria')}
                    title={workspaceRoots.length === 0
                        ? t('settings.projects.workspace.noRoots')
                        : t('settings.projects.workspace.browseAria')}
                    className="shrink-0 rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3 py-2 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)] disabled:opacity-50"
                >
                    {t('settings.projects.workspace.browse')}
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    side="bottom"
                    align="end"
                    sideOffset={6}
                    collisionPadding={8}
                    className="z-50 flex h-[24rem] w-[min(32rem,calc(100vw-2rem))] flex-col rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] shadow-lg"
                >
                    <WorkspaceBrowser
                        api={props.api}
                        machines={props.machine ? [props.machine] : []}
                        machinesLoading={false}
                        initialMachineId={props.machine?.id}
                        actionLabel={t('settings.projects.workspace.select')}
                        onStartSession={(_, directory) => {
                            props.onChange(directory)
                            setOpen(false)
                        }}
                    />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}

function MemberUserSelect(props: {
    users: EnterpriseUser[]
    selectedUserIds: number[]
    existingMemberIds: Set<number>
    onChange: (userIds: number[]) => void
    disabled: boolean
    isLoading: boolean
    error: string | null
}) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const usersById = useMemo(
        () => new Map(props.users.map((user) => [user.id, user])),
        [props.users]
    )
    const selectedUsers = props.selectedUserIds
        .map((userId) => usersById.get(userId))
        .filter((user): user is EnterpriseUser => Boolean(user))
    const availableUsers = useMemo(
        () => props.users
            .filter((user) => user.disabledAt === null)
            .filter((user) => !props.existingMemberIds.has(user.id))
            .sort((left, right) => getUserLabel(left).localeCompare(getUserLabel(right))),
        [props.existingMemberIds, props.users]
    )
    const filteredUsers = useMemo(
        () => availableUsers.filter((user) => userMatchesQuery(user, query)),
        [availableUsers, query]
    )

    function toggleUser(userId: number) {
        const selected = props.selectedUserIds.includes(userId)
        props.onChange(selected
            ? props.selectedUserIds.filter((id) => id !== userId)
            : [...props.selectedUserIds, userId]
        )
    }

    function removeUser(userId: number) {
        props.onChange(props.selectedUserIds.filter((id) => id !== userId))
    }

    return (
        <div className="space-y-2">
            <Popover.Root open={open} onOpenChange={setOpen}>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        disabled={props.disabled}
                        aria-label={t('settings.projects.member.selectUsers')}
                        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-left text-sm text-[var(--app-fg)] outline-none transition-colors hover:bg-[var(--app-subtle-bg)] focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    >
                        <span className={selectedUsers.length > 0 ? 'truncate' : 'truncate text-[var(--app-hint)]'}>
                            {selectedUsers.length > 0
                                ? t('settings.projects.member.selectedCount', { count: selectedUsers.length })
                                : t('settings.projects.member.searchPlaceholder')}
                        </span>
                        <span aria-hidden="true" className="shrink-0 text-xs text-[var(--app-hint)]">v</span>
                    </button>
                </Popover.Trigger>
                <Popover.Portal>
                    <Popover.Content
                        side="bottom"
                        align="start"
                        sideOffset={6}
                        collisionPadding={8}
                        className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[18rem] rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 shadow-lg"
                    >
                        <input
                            autoFocus
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={t('settings.projects.member.searchPlaceholder')}
                            className="mb-2 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                        />
                        <div className="max-h-56 overflow-y-auto">
                            {props.isLoading ? (
                                <div className="px-2 py-3 text-sm text-[var(--app-hint)]">{t('settings.projects.member.usersLoading')}</div>
                            ) : props.error ? (
                                <div className="px-2 py-3 text-sm text-red-600">{props.error}</div>
                            ) : filteredUsers.length === 0 ? (
                                <div className="px-2 py-3 text-sm text-[var(--app-hint)]">
                                    {query.trim()
                                        ? t('settings.projects.member.noResults')
                                        : t('settings.projects.member.noUsers')}
                                </div>
                            ) : (
                                filteredUsers.map((user) => {
                                    const checked = props.selectedUserIds.includes(user.id)
                                    const label = getUserLabel(user)
                                    const username = user.username?.trim()
                                    return (
                                        <label
                                            key={user.id}
                                            className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-[var(--app-subtle-bg)]"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleUser(user.id)}
                                                className="mt-0.5 h-4 w-4 accent-[var(--app-link)]"
                                            />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate font-medium text-[var(--app-fg)]">{label}</span>
                                                <span className="block truncate text-xs text-[var(--app-hint)]">
                                                    {[username ? `@${username}` : null, `ID ${user.id}`].filter(Boolean).join(' · ')}
                                                </span>
                                            </span>
                                        </label>
                                    )
                                })
                            )}
                        </div>
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>

            {selectedUsers.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                    {selectedUsers.map((user) => {
                        const label = getUserLabel(user)
                        return (
                            <span
                                key={user.id}
                                className="inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--app-subtle-bg)] px-2 py-1 text-xs text-[var(--app-fg)]"
                            >
                                <span className="max-w-[12rem] truncate">{label}</span>
                                <button
                                    type="button"
                                    onClick={() => removeUser(user.id)}
                                    disabled={props.disabled}
                                    aria-label={t('settings.projects.member.removeSelected', { name: label })}
                                    className="rounded-full px-1 text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] disabled:opacity-50"
                                >
                                    x
                                </button>
                            </span>
                        )
                    })}
                </div>
            ) : null}
        </div>
    )
}

function WorkspaceList(props: {
    project: ProjectWithDetails
    machinesById: Map<string, Machine>
    canManage: boolean
    removingWorkspaceId: string | null
    onRemove: (workspace: ProjectWorkspace) => void
}) {
    const { t } = useTranslation()
    if (props.project.workspaces.length === 0) {
        return <div className="text-xs text-[var(--app-hint)]">{t('settings.projects.workspaces.empty')}</div>
    }
    return (
        <div className="space-y-1">
            {props.project.workspaces.map((workspace) => {
                const machine = props.machinesById.get(workspace.machineId)
                return (
                    <div key={workspace.id} className="flex min-w-0 items-center gap-2 rounded-md bg-[var(--app-subtle-bg)] px-2 py-1.5">
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-medium text-[var(--app-fg)]">
                                {machine ? getMachineTitle(machine) : workspace.machineId}
                            </div>
                            <div className="truncate text-xs text-[var(--app-hint)]" title={workspace.rootPath}>
                                {workspace.rootPath}
                            </div>
                        </div>
                        {props.canManage ? (
                            <button
                                type="button"
                                onClick={() => props.onRemove(workspace)}
                                disabled={props.removingWorkspaceId === workspace.id}
                                aria-label={t('settings.projects.workspace.removeAria', { path: workspace.rootPath })}
                                className="shrink-0 rounded border border-[var(--app-border)] px-2 py-1 text-xs text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] disabled:opacity-50"
                            >
                                {props.removingWorkspaceId === workspace.id
                                    ? t('settings.projects.workspace.removing')
                                    : t('settings.projects.workspace.remove')}
                            </button>
                        ) : null}
                    </div>
                )
            })}
        </div>
    )
}

function MemberList(props: {
    project: ProjectWithDetails
    usersById: Map<number, EnterpriseUser>
    canManage: boolean
    updatingUserId: number | null
    removingUserId: number | null
    onRoleChange: (userId: number, role: ProjectRole) => void
    onRemove: (member: ProjectMember) => void
}) {
    const { t } = useTranslation()
    if (props.project.members.length === 0) {
        return <div className="text-xs text-[var(--app-hint)]">{t('settings.projects.members.empty')}</div>
    }
    const actorIsOwner = props.project.role === 'owner'
    const ownerCount = props.project.members.filter((member) => member.role === 'owner').length
    return (
        <div className="space-y-1">
            {props.project.members.map((member) => {
                const user = props.usersById.get(member.userId)
                const label = user ? getUserLabel(user) : t('settings.projects.userId', { id: member.userId })
                const username = user?.username?.trim()
                const onlyOwner = member.role === 'owner' && ownerCount <= 1
                const canChangeOwner = actorIsOwner || member.role !== 'owner'
                const canChange = props.canManage && canChangeOwner && !onlyOwner
                const canRemove = props.canManage && canChangeOwner && !onlyOwner
                const roleOptions = roleOptionsForActor(props.project.role, actorIsOwner)
                const options = roleOptions.includes(member.role) ? roleOptions : [member.role, ...roleOptions]
                return (
                    <div
                        key={`${member.projectId}:${member.userId}`}
                        className="flex min-w-0 items-center gap-2 rounded-md bg-[var(--app-subtle-bg)] px-2 py-1.5"
                    >
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs text-[var(--app-fg)]">{label}</span>
                            {user ? (
                                <span className="block truncate text-xs text-[var(--app-hint)]">
                                    {[username ? `@${username}` : null, `ID ${member.userId}`].filter(Boolean).join(' · ')}
                                </span>
                            ) : null}
                        </span>
                        {props.canManage ? (
                            <select
                                value={member.role}
                                onChange={(event) => props.onRoleChange(member.userId, event.target.value as ProjectRole)}
                                disabled={!canChange || props.updatingUserId === member.userId}
                                aria-label={t('settings.projects.member.roleAria', { id: member.userId })}
                                className="w-24 rounded border border-[var(--app-border)] bg-[var(--app-bg)] px-1.5 py-1 text-xs outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            >
                                {options.map((role) => (
                                    <option key={role} value={role}>{t(`settings.projects.role.${role}`)}</option>
                                ))}
                            </select>
                        ) : (
                            <RoleBadge role={member.role} />
                        )}
                        {props.canManage ? (
                            <button
                                type="button"
                                onClick={() => props.onRemove(member)}
                                disabled={!canRemove || props.removingUserId === member.userId}
                                aria-label={t('settings.projects.member.removeAria', { id: member.userId })}
                                className="shrink-0 rounded border border-[var(--app-border)] px-2 py-1 text-xs text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] disabled:opacity-50"
                            >
                                {props.removingUserId === member.userId
                                    ? t('settings.projects.member.removing')
                                    : t('settings.projects.member.remove')}
                            </button>
                        ) : null}
                    </div>
                )
            })}
        </div>
    )
}

function CreateProjectForm(props: { api: ApiClient; machines: Machine[] }) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [name, setName] = useState('')
    const [machineId, setMachineId] = useState('')
    const [rootPath, setRootPath] = useState('')

    useEffect(() => {
        if (!machineId && props.machines[0]) {
            setMachineId(props.machines[0].id)
        }
    }, [machineId, props.machines])

    const selectedMachine = useMemo(
        () => props.machines.find((machine) => machine.id === machineId) ?? null,
        [machineId, props.machines]
    )

    const createMutation = useMutation({
        mutationFn: async () => {
            const trimmedName = name.trim()
            const trimmedRoot = rootPath.trim()
            if (!trimmedName) {
                throw new Error(t('settings.projects.create.nameRequired'))
            }
            return await props.api.createProject({
                name: trimmedName,
                ...(trimmedRoot && machineId ? { machineId, rootPath: trimmedRoot } : {})
            })
        },
        onSuccess: () => {
            setName('')
            setRootPath('')
            void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
        }
    })

    return (
        <form
            className="space-y-3 px-3 py-3"
            onSubmit={(event) => {
                event.preventDefault()
                createMutation.mutate()
            }}
        >
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                <label className="min-w-0">
                    <span className="mb-1 block text-xs font-medium text-[var(--app-hint)]">{t('settings.projects.create.name')}</span>
                    <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        disabled={createMutation.isPending}
                        placeholder={t('settings.projects.create.namePlaceholder')}
                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    />
                </label>
                <label className="min-w-0">
                    <span className="mb-1 block text-xs font-medium text-[var(--app-hint)]">{t('settings.projects.create.machine')}</span>
                    <select
                        value={machineId}
                        onChange={(event) => setMachineId(event.target.value)}
                        disabled={createMutation.isPending || props.machines.length === 0}
                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    >
                        {props.machines.length === 0 ? (
                            <option value="">{t('settings.projects.noMachines')}</option>
                        ) : null}
                        {props.machines.map((machine) => (
                            <MachineOption key={machine.id} machine={machine} />
                        ))}
                    </select>
                </label>
            </div>
            <label className="block min-w-0">
                <span className="mb-1 block text-xs font-medium text-[var(--app-hint)]">{t('settings.projects.create.rootPath')}</span>
                <div className="flex gap-2">
                    <input
                        value={rootPath}
                        onChange={(event) => setRootPath(event.target.value)}
                        disabled={createMutation.isPending || props.machines.length === 0}
                        placeholder={t('settings.projects.create.rootPathPlaceholder')}
                        className="min-w-0 flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    />
                    <ProjectDirectoryPicker
                        api={props.api}
                        machine={selectedMachine}
                        disabled={createMutation.isPending || props.machines.length === 0}
                        onChange={setRootPath}
                    />
                </div>
            </label>
            {createMutation.error ? (
                <div className="text-xs text-red-600">
                    {createMutation.error instanceof Error ? createMutation.error.message : t('settings.projects.create.error')}
                </div>
            ) : null}
            <button
                type="submit"
                disabled={createMutation.isPending || !name.trim()}
                className="rounded-md bg-[var(--app-link)] px-3 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
            >
                {createMutation.isPending ? t('settings.projects.create.creating') : t('settings.projects.create.submit')}
            </button>
        </form>
    )
}

function ProjectRow(props: {
    api: ApiClient
    baseUrl: string
    project: ProjectWithDetails
    machines: Machine[]
    machinesById: Map<string, Machine>
}) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const { copied, copy } = useCopyToClipboard()
    const [editingName, setEditingName] = useState(false)
    const [nameDraft, setNameDraft] = useState(props.project.name)
    const [workspaceMachineId, setWorkspaceMachineId] = useState('')
    const [workspaceRoot, setWorkspaceRoot] = useState('')
    const [selectedMemberUserIds, setSelectedMemberUserIds] = useState<number[]>([])
    const [memberRole, setMemberRole] = useState<ProjectRole>('editor')
    const [inviteRole, setInviteRole] = useState<ProjectRole>('editor')
    const [inviteUrl, setInviteUrl] = useState<string | null>(null)
    const manageable = canManageProject(props.project.role)
    const memberRoleOptions = useMemo(
        () => roleOptionsForActor(props.project.role, true),
        [props.project.role]
    )
    const inviteRoleOptions = useMemo(
        () => props.project.role === 'owner' ? [...INVITE_ROLES, 'owner' as const] : INVITE_ROLES,
        [props.project.role]
    )
    const usersQuery = useQuery({
        queryKey: queryKeys.projectMemberCandidates(props.project.id),
        queryFn: async () => await props.api.getProjectMemberCandidates(props.project.id),
        enabled: manageable
    })
    const users = usersQuery.data?.users ?? []
    const usersById = useMemo(
        () => new Map(users.map((user) => [user.id, user])),
        [users]
    )
    const usersError = usersQuery.error instanceof Error
        ? usersQuery.error.message
        : usersQuery.error
            ? t('settings.projects.member.usersError')
            : null
    const existingMemberIds = useMemo(
        () => new Set(props.project.members.map((member) => member.userId)),
        [props.project.members]
    )

    function invalidateProjectQueries() {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
    }

    useEffect(() => {
        if (!editingName) {
            setNameDraft(props.project.name)
        }
    }, [editingName, props.project.name])

    useEffect(() => {
        if (!workspaceMachineId && props.machines[0]) {
            setWorkspaceMachineId(props.machines[0].id)
        }
    }, [props.machines, workspaceMachineId])

    const selectedWorkspaceMachine = useMemo(
        () => props.machines.find((machine) => machine.id === workspaceMachineId) ?? null,
        [props.machines, workspaceMachineId]
    )

    useEffect(() => {
        if (!memberRoleOptions.includes(memberRole)) {
            setMemberRole(memberRoleOptions.includes('editor') ? 'editor' : memberRoleOptions[0])
        }
    }, [memberRole, memberRoleOptions])

    useEffect(() => {
        setSelectedMemberUserIds((userIds) => userIds.filter((userId) => !existingMemberIds.has(userId)))
    }, [existingMemberIds])

    useEffect(() => {
        if (!inviteRoleOptions.includes(inviteRole)) {
            setInviteRole(inviteRoleOptions[0])
        }
    }, [inviteRole, inviteRoleOptions])

    const renameMutation = useMutation({
        mutationFn: async (name: string) => {
            await props.api.updateProject(props.project.id, { name })
        },
        onSuccess: () => {
            setEditingName(false)
            invalidateProjectQueries()
        }
    })

    const addWorkspaceMutation = useMutation({
        mutationFn: async () => {
            const trimmedRoot = workspaceRoot.trim()
            if (!workspaceMachineId || !trimmedRoot) {
                throw new Error(t('settings.projects.workspace.required'))
            }
            await props.api.addProjectWorkspace(props.project.id, {
                machineId: workspaceMachineId,
                rootPath: trimmedRoot
            })
        },
        onSuccess: () => {
            setWorkspaceRoot('')
            invalidateProjectQueries()
            void queryClient.invalidateQueries({ queryKey: queryKeys.machines })
        }
    })

    const removeWorkspaceMutation = useMutation({
        mutationFn: async (workspace: ProjectWorkspace) => {
            await props.api.removeProjectWorkspace(props.project.id, workspace.id)
        },
        onSuccess: () => {
            invalidateProjectQueries()
            void queryClient.invalidateQueries({ queryKey: queryKeys.machines })
        }
    })

    const addMemberMutation = useMutation({
        mutationFn: async () => {
            if (selectedMemberUserIds.length === 0) {
                throw new Error(t('settings.projects.member.required'))
            }
            await Promise.all(selectedMemberUserIds.map((userId) =>
                props.api.addProjectMember(props.project.id, { userId, role: memberRole })
            ))
        },
        onSuccess: () => {
            setSelectedMemberUserIds([])
            invalidateProjectQueries()
        }
    })

    const updateMemberMutation = useMutation({
        mutationFn: async (input: { userId: number; role: ProjectRole }) => {
            await props.api.addProjectMember(props.project.id, input)
        },
        onSuccess: () => invalidateProjectQueries()
    })

    const removeMemberMutation = useMutation({
        mutationFn: async (member: ProjectMember) => {
            await props.api.removeProjectMember(props.project.id, member.userId)
        },
        onSuccess: () => invalidateProjectQueries()
    })

    const inviteMutation = useMutation({
        mutationFn: async () => {
            const response = await props.api.createProjectInvite(props.project.id, { role: inviteRole })
            return buildInviteUrl(response.token, props.baseUrl)
        },
        onSuccess: (url) => setInviteUrl(url)
    })

    function submitRename() {
        const next = nameDraft.trim()
        if (!next) {
            return
        }
        if (next === props.project.name) {
            setEditingName(false)
            return
        }
        renameMutation.mutate(next)
    }

    const removingWorkspaceId = removeWorkspaceMutation.isPending
        ? removeWorkspaceMutation.variables?.id ?? null
        : null
    const updatingUserId = updateMemberMutation.isPending
        ? updateMemberMutation.variables?.userId ?? null
        : null
    const removingUserId = removeMemberMutation.isPending
        ? removeMemberMutation.variables?.userId ?? null
        : null

    return (
        <div className="space-y-3 px-3 py-3">
            <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    {editingName ? (
                        <form
                            className="flex min-w-0 flex-wrap items-center gap-2"
                            onSubmit={(event) => {
                                event.preventDefault()
                                submitRename()
                            }}
                        >
                            <input
                                autoFocus
                                value={nameDraft}
                                onChange={(event) => setNameDraft(event.target.value)}
                                disabled={renameMutation.isPending}
                                aria-label={t('settings.projects.rename', { name: props.project.name })}
                                className="min-w-[12rem] flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5 text-sm text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            />
                            <button
                                type="submit"
                                disabled={renameMutation.isPending || !nameDraft.trim()}
                                className="rounded-md border border-[var(--app-border)] px-2 py-1.5 text-xs font-medium text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                            >
                                {renameMutation.isPending ? t('settings.projects.rename.saving') : t('settings.projects.rename.save')}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setEditingName(false)
                                    setNameDraft(props.project.name)
                                }}
                                disabled={renameMutation.isPending}
                                className="rounded-md border border-[var(--app-border)] px-2 py-1.5 text-xs font-medium text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                            >
                                {t('settings.projects.rename.cancel')}
                            </button>
                            <RoleBadge role={props.project.role} />
                        </form>
                    ) : (
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <div className="truncate text-sm font-semibold text-[var(--app-fg)]">{props.project.name}</div>
                            <RoleBadge role={props.project.role} />
                            {manageable ? (
                                <button
                                    type="button"
                                    onClick={() => setEditingName(true)}
                                    aria-label={t('settings.projects.rename', { name: props.project.name })}
                                    className="rounded border border-[var(--app-border)] px-2 py-1 text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                                >
                                    {t('settings.projects.rename.action')}
                                </button>
                            ) : null}
                        </div>
                    )}
                    {renameMutation.error ? (
                        <div className="mt-1 text-xs text-red-600">
                            {renameMutation.error instanceof Error ? renameMutation.error.message : t('settings.projects.rename.error')}
                        </div>
                    ) : null}
                    {props.project.repoUrl ? (
                        <div className="mt-0.5 truncate text-xs text-[var(--app-hint)]">{props.project.repoUrl}</div>
                    ) : null}
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                    <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">{t('settings.projects.workspaces')}</div>
                    <WorkspaceList
                        project={props.project}
                        machinesById={props.machinesById}
                        canManage={manageable}
                        removingWorkspaceId={removingWorkspaceId}
                        onRemove={(workspace) => removeWorkspaceMutation.mutate(workspace)}
                    />
                    {removeWorkspaceMutation.error ? (
                        <div className="mt-1 text-xs text-red-600">
                            {removeWorkspaceMutation.error instanceof Error ? removeWorkspaceMutation.error.message : t('settings.projects.workspace.removeError')}
                        </div>
                    ) : null}
                </div>
                <div className="min-w-0">
                    <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">{t('settings.projects.members')}</div>
                    <MemberList
                        project={props.project}
                        usersById={usersById}
                        canManage={manageable}
                        updatingUserId={updatingUserId}
                        removingUserId={removingUserId}
                        onRoleChange={(userId, role) => updateMemberMutation.mutate({ userId, role })}
                        onRemove={(member) => removeMemberMutation.mutate(member)}
                    />
                    {(updateMemberMutation.error || removeMemberMutation.error) ? (
                        <div className="mt-1 text-xs text-red-600">
                            {updateMemberMutation.error instanceof Error
                                ? updateMemberMutation.error.message
                                : removeMemberMutation.error instanceof Error
                                    ? removeMemberMutation.error.message
                                    : t('settings.projects.member.error')}
                        </div>
                    ) : null}
                </div>
            </div>

            {manageable ? (
                <div className="grid gap-3 border-t border-[var(--app-divider)] pt-3 sm:grid-cols-2">
                    <form
                        className="space-y-2"
                        onSubmit={(event) => {
                            event.preventDefault()
                            addWorkspaceMutation.mutate()
                        }}
                    >
                        <div className="text-xs font-medium text-[var(--app-hint)]">{t('settings.projects.workspace.add')}</div>
                        <select
                            value={workspaceMachineId}
                            onChange={(event) => setWorkspaceMachineId(event.target.value)}
                            disabled={addWorkspaceMutation.isPending || props.machines.length === 0}
                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        >
                            {props.machines.length === 0 ? (
                                <option value="">{t('settings.projects.noMachines')}</option>
                            ) : null}
                            {props.machines.map((machine) => (
                                <MachineOption key={machine.id} machine={machine} />
                            ))}
                        </select>
                        <div className="flex gap-2">
                            <input
                                value={workspaceRoot}
                                onChange={(event) => setWorkspaceRoot(event.target.value)}
                                disabled={addWorkspaceMutation.isPending || props.machines.length === 0}
                                placeholder={t('settings.projects.workspace.rootPlaceholder')}
                                className="min-w-0 flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            />
                            <ProjectDirectoryPicker
                                api={props.api}
                                machine={selectedWorkspaceMachine}
                                disabled={addWorkspaceMutation.isPending || props.machines.length === 0}
                                onChange={setWorkspaceRoot}
                            />
                        </div>
                        {addWorkspaceMutation.error ? (
                            <div className="text-xs text-red-600">
                                {addWorkspaceMutation.error instanceof Error ? addWorkspaceMutation.error.message : t('settings.projects.workspace.error')}
                            </div>
                        ) : null}
                        <button
                            type="submit"
                            disabled={addWorkspaceMutation.isPending || !workspaceMachineId || !workspaceRoot.trim()}
                            className="rounded-md border border-[var(--app-border)] px-3 py-2 text-sm font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                        >
                            {addWorkspaceMutation.isPending ? t('settings.projects.workspace.adding') : t('settings.projects.workspace.submit')}
                        </button>
                    </form>

                    <form
                        className="space-y-2"
                        onSubmit={(event) => {
                            event.preventDefault()
                            addMemberMutation.mutate()
                        }}
                    >
                        <div className="text-xs font-medium text-[var(--app-hint)]">{t('settings.projects.member.add')}</div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <div className="min-w-0 flex-1">
                                <MemberUserSelect
                                    users={users}
                                    selectedUserIds={selectedMemberUserIds}
                                    existingMemberIds={existingMemberIds}
                                    onChange={setSelectedMemberUserIds}
                                    disabled={addMemberMutation.isPending}
                                    isLoading={usersQuery.isLoading}
                                    error={usersError}
                                />
                            </div>
                            <select
                                value={memberRole}
                                onChange={(event) => setMemberRole(event.target.value as ProjectRole)}
                                disabled={addMemberMutation.isPending}
                                className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50 sm:w-28"
                            >
                                {memberRoleOptions.map((role) => (
                                    <option key={role} value={role}>{t(`settings.projects.role.${role}`)}</option>
                                ))}
                            </select>
                        </div>
                        {addMemberMutation.error ? (
                            <div className="text-xs text-red-600">
                                {addMemberMutation.error instanceof Error ? addMemberMutation.error.message : t('settings.projects.member.error')}
                            </div>
                        ) : null}
                        <button
                            type="submit"
                            disabled={addMemberMutation.isPending || selectedMemberUserIds.length === 0}
                            className="rounded-md border border-[var(--app-border)] px-3 py-2 text-sm font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                        >
                            {addMemberMutation.isPending ? t('settings.projects.member.adding') : t('settings.projects.member.submit')}
                        </button>
                    </form>

                    <div className="space-y-2">
                        <div className="text-xs font-medium text-[var(--app-hint)]">{t('settings.projects.invite.create')}</div>
                        <div className="flex gap-2">
                            <select
                                value={inviteRole}
                                onChange={(event) => setInviteRole(event.target.value as ProjectRole)}
                                disabled={inviteMutation.isPending}
                                className="min-w-0 flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            >
                                {inviteRoleOptions.map((role) => (
                                    <option key={role} value={role}>{t(`settings.projects.role.${role}`)}</option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={() => inviteMutation.mutate()}
                                disabled={inviteMutation.isPending}
                                className="shrink-0 rounded-md border border-[var(--app-border)] px-3 py-2 text-sm font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                            >
                                {inviteMutation.isPending ? t('settings.projects.invite.creating') : t('settings.projects.invite.submit')}
                            </button>
                        </div>
                        {inviteMutation.error ? (
                            <div className="text-xs text-red-600">
                                {inviteMutation.error instanceof Error ? inviteMutation.error.message : t('settings.projects.invite.error')}
                            </div>
                        ) : null}
                        {inviteUrl ? (
                            <div className="flex min-w-0 items-center gap-2 rounded-md bg-[var(--app-subtle-bg)] px-2 py-2">
                                <input
                                    readOnly
                                    value={inviteUrl}
                                    className="min-w-0 flex-1 bg-transparent text-xs text-[var(--app-fg)] outline-none"
                                />
                                <button
                                    type="button"
                                    onClick={() => void copy(inviteUrl)}
                                    className="shrink-0 rounded border border-[var(--app-border)] px-2 py-1 text-xs text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]"
                                >
                                    {copied ? t('settings.projects.invite.copied') : t('settings.projects.invite.copy')}
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    )
}

export default function SettingsProjectsPage() {
    const { t } = useTranslation()
    const { api, baseUrl } = useAppContext()
    const { projects, isLoading, error } = useProjects(api)
    const { machines } = useMachines(api, true)
    const machinesById = useMemo(
        () => new Map(machines.map((machine) => [machine.id, machine])),
        [machines]
    )

    return (
        <SettingsPageContent title={t('settings.projects.title')} description={t('settings.projects.description')}>
            <SettingsSection title={t('settings.projects.create.section')}>
                <CreateProjectForm api={api} machines={machines} />
            </SettingsSection>

            <SettingsSection title={t('settings.projects.list.section')}>
                {error ? (
                    <div className="px-3 py-3 text-sm text-red-600">{error}</div>
                ) : isLoading ? (
                    <div className="px-3 py-3 text-sm text-[var(--app-hint)]">{t('loading.projects')}</div>
                ) : projects.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-[var(--app-hint)]">{t('settings.projects.empty')}</div>
                ) : (
                    projects.map((project) => (
                        <ProjectRow
                            key={project.id}
                            api={api}
                            baseUrl={baseUrl}
                            project={project}
                            machines={machines}
                            machinesById={machinesById}
                        />
                    ))
                )}
            </SettingsSection>
        </SettingsPageContent>
    )
}
