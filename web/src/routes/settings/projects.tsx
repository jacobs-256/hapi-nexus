import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Machine, ProjectMember, ProjectRole, ProjectWithDetails, ProjectWorkspace } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { useMachines } from '@/hooks/queries/useMachines'
import { useProjects } from '@/hooks/queries/useProjects'
import { getMachineTitle } from '@/hooks/useMachineLabels'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { queryKeys } from '@/lib/query-keys'
import { SettingsPageContent, SettingsSection } from '@/components/settings/SettingsPrimitives'

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
                        <span className="min-w-0 flex-1 truncate text-xs text-[var(--app-fg)]">
                            {t('settings.projects.userId', { id: member.userId })}
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
                <input
                    value={rootPath}
                    onChange={(event) => setRootPath(event.target.value)}
                    disabled={createMutation.isPending || props.machines.length === 0}
                    placeholder={t('settings.projects.create.rootPathPlaceholder')}
                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                />
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
    const [memberUserId, setMemberUserId] = useState('')
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

    useEffect(() => {
        if (!memberRoleOptions.includes(memberRole)) {
            setMemberRole(memberRoleOptions.includes('editor') ? 'editor' : memberRoleOptions[0])
        }
    }, [memberRole, memberRoleOptions])

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
            const userId = Number(memberUserId)
            if (!Number.isSafeInteger(userId) || userId <= 0) {
                throw new Error(t('settings.projects.member.required'))
            }
            await props.api.addProjectMember(props.project.id, { userId, role: memberRole })
        },
        onSuccess: () => {
            setMemberUserId('')
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
                        <input
                            value={workspaceRoot}
                            onChange={(event) => setWorkspaceRoot(event.target.value)}
                            disabled={addWorkspaceMutation.isPending || props.machines.length === 0}
                            placeholder={t('settings.projects.workspace.rootPlaceholder')}
                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
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
                        <div className="flex gap-2">
                            <input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                value={memberUserId}
                                onChange={(event) => setMemberUserId(event.target.value)}
                                disabled={addMemberMutation.isPending}
                                placeholder={t('settings.projects.member.userIdPlaceholder')}
                                className="min-w-0 flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            />
                            <select
                                value={memberRole}
                                onChange={(event) => setMemberRole(event.target.value as ProjectRole)}
                                disabled={addMemberMutation.isPending}
                                className="w-28 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
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
                            disabled={addMemberMutation.isPending || !memberUserId.trim()}
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
