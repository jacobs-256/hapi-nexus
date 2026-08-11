import { useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MACHINE_DISPLAY_NAME_MAX_LENGTH } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import type { EnterpriseUser, Machine, ProjectWithDetails } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { useMachines } from '@/hooks/queries/useMachines'
import { useProjects } from '@/hooks/queries/useProjects'
import { getMachineTitle } from '@/hooks/useMachineLabels'
import { formatAbsoluteDateTime } from '@/lib/relativeTime'
import { queryKeys } from '@/lib/query-keys'
import { SettingsPageContent, SettingsSection } from '@/components/settings/SettingsPrimitives'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

function MachineStatusBadge(props: { active: boolean }) {
    const { t } = useTranslation()
    return (
        <span
            className={[
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
                props.active
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-red-500/10 text-red-700 dark:text-red-300'
            ].join(' ')}
        >
            <span
                aria-hidden="true"
                className={[
                    'h-1.5 w-1.5 rounded-full',
                    props.active ? 'bg-emerald-500' : 'bg-red-500'
                ].join(' ')}
            />
            {props.active ? t('settings.machines.status.online') : t('settings.machines.status.offline')}
        </span>
    )
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

function getProjectOwnerLabel(project: ProjectWithDetails): string {
    const createdBy = getUserLabel(project.createdByUser)
    if (createdBy) return createdBy
    const owner = project.members.find((member) => member.role === 'owner')
    return owner ? `User ${owner.userId}` : ''
}

function buildSharedByMachineId(
    projects: ProjectWithDetails[],
    currentUserId: number
): Map<string, string> {
    const sharedByMachineId = new Map<string, string>()
    for (const project of projects) {
        if (project.createdByUserId === currentUserId) {
            continue
        }
        const label = getProjectOwnerLabel(project)
        if (!label) {
            continue
        }
        for (const workspace of project.workspaces) {
            if (!sharedByMachineId.has(workspace.machineId)) {
                sharedByMachineId.set(workspace.machineId, label)
            }
        }
    }
    return sharedByMachineId
}

function SharedMachineBadge(props: { sharedBy: string | null }) {
    const { t } = useTranslation()
    return (
        <span className="inline-flex items-center rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">
            {props.sharedBy
                ? t('settings.machines.sharedBy', { name: props.sharedBy })
                : t('settings.machines.shared')}
        </span>
    )
}

function MachineRow(props: { api: ApiClient | null; machine: Machine; currentUserId: number; sharedBy: string | null }) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const savingRef = useRef(false)

    const label = getMachineTitle(props.machine)
    const host = props.machine.metadata?.host
    const platform = props.machine.metadata?.platform
    const subtitle = [host, platform].filter(Boolean).join(' · ')
    const activityTime = formatAbsoluteDateTime(props.machine.activeAt)
    const activityLabel = props.machine.active
        ? (activityTime ? t('settings.machines.lastSeen', { time: activityTime }) : null)
        : (activityTime ? t('settings.machines.lastOffline', { time: activityTime }) : t('settings.machines.lastOfflineUnknown'))
    const isShared = props.machine.ownerUserId !== props.currentUserId

    const renameMutation = useMutation({
        mutationFn: async (displayName: string) => {
            if (!props.api) {
                throw new Error('API unavailable')
            }
            await props.api.renameMachine(props.machine.id, displayName)
        },
        onSuccess: () => {
            setEditing(false)
            setError(null)
            void queryClient.invalidateQueries({ queryKey: queryKeys.machines })
        },
        onError: () => setError(t('settings.machines.error')),
    })

    const deleteMutation = useMutation({
        mutationFn: async () => {
            if (!props.api) {
                throw new Error('API unavailable')
            }
            return await props.api.deleteMachine(props.machine.id)
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.machines })
            void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        },
    })

    function startEditing() {
        if (isShared) {
            return
        }
        setDraft(props.machine.metadata?.displayName ?? '')
        setError(null)
        setEditing(true)
    }

    function save() {
        // Disabling the focused input on submit forces a blur, so `save` is
        // reached twice for a single Enter. A ref (not `isPending`, which is a
        // render-timing-dependent closure value) keeps that to one request.
        if (savingRef.current) {
            return
        }
        const next = draft.trim()
        if (next === (props.machine.metadata?.displayName ?? '')) {
            setEditing(false)
            return
        }
        savingRef.current = true
        renameMutation.mutate(next, {
            onSettled: () => {
                savingRef.current = false
            },
        })
    }

    return (
        <div className="px-3 py-3">
            <div className="flex min-h-9 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                    {editing ? (
                        <input
                            autoFocus
                            value={draft}
                            maxLength={MACHINE_DISPLAY_NAME_MAX_LENGTH}
                            disabled={renameMutation.isPending}
                            placeholder={host ?? t('settings.machines.namePlaceholder')}
                            aria-label={t('settings.machines.rename', { name: label })}
                            onChange={(event) => setDraft(event.target.value)}
                            onBlur={save}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault()
                                    save()
                                } else if (event.key === 'Escape') {
                                    event.preventDefault()
                                    setEditing(false)
                                    setError(null)
                                }
                            }}
                            className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--app-link)] disabled:opacity-60"
                        />
                    ) : isShared ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-[var(--app-fg)]">
                                {label}
                            </span>
                            <SharedMachineBadge sharedBy={props.sharedBy} />
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={startEditing}
                            aria-label={t('settings.machines.rename', { name: label })}
                            className="block w-full truncate text-left text-sm font-medium text-[var(--app-fg)] hover:text-[var(--app-link)]"
                        >
                            {label}
                        </button>
                    )}
                    {subtitle ? (
                        <div className="mt-0.5 truncate text-xs leading-snug text-[var(--app-hint)]">{subtitle}</div>
                    ) : null}
                    {activityLabel ? (
                        <div className="mt-0.5 truncate text-xs leading-snug text-[var(--app-hint)]">{activityLabel}</div>
                    ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <MachineStatusBadge active={props.machine.active} />
                    {isShared ? null : (
                        <button
                            type="button"
                            onClick={() => setDeleteDialogOpen(true)}
                            disabled={!props.api || props.machine.active || deleteMutation.isPending}
                            aria-label={t('settings.machines.delete.aria', { name: label })}
                            title={props.machine.active ? t('settings.machines.delete.onlineHint') : undefined}
                            className="rounded-md border border-red-500/30 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400"
                        >
                            {deleteMutation.isPending ? t('settings.machines.delete.deleting') : t('settings.machines.delete.action')}
                        </button>
                    )}
                </div>
            </div>
            {error ? <div role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</div> : null}
            {isShared ? null : (
                <ConfirmDialog
                    isOpen={deleteDialogOpen}
                    onClose={() => setDeleteDialogOpen(false)}
                    title={t('settings.machines.delete.title')}
                    description={t('settings.machines.delete.description', { name: label })}
                    confirmLabel={t('settings.machines.delete.confirm')}
                    confirmingLabel={t('settings.machines.delete.deleting')}
                    onConfirm={async () => {
                        await deleteMutation.mutateAsync()
                    }}
                    isPending={deleteMutation.isPending}
                    destructive
                />
            )}
        </div>
    )
}

export default function SettingsMachinesPage() {
    const { t } = useTranslation()
    const { api, user } = useAppContext()
    const { machines } = useMachines(api, true, { includeOffline: true })
    const { projects } = useProjects(api, true)
    const sharedByMachineId = useMemo(
        () => buildSharedByMachineId(projects, user.id),
        [projects, user.id]
    )

    return (
        <SettingsPageContent title={t('settings.machines.title')} description={t('settings.machines.description')}>
            <SettingsSection title={t('settings.machines.section')}>
                {machines.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-[var(--app-hint)]">{t('settings.machines.empty')}</div>
                ) : (
                    machines.map((machine) => (
                        <MachineRow
                            key={machine.id}
                            api={api}
                            machine={machine}
                            currentUserId={user.id}
                            sharedBy={sharedByMachineId.get(machine.id) ?? null}
                        />
                    ))
                )}
            </SettingsSection>
        </SettingsPageContent>
    )
}
