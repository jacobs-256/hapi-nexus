import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { EnterpriseUser, UserRole } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { SettingsPageContent, SettingsSection } from '@/components/settings/SettingsPrimitives'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

const USER_ROLES: UserRole[] = ['user', 'admin']
const USER_GRID_TEMPLATE = 'minmax(150px,1.2fr) minmax(150px,1fr) minmax(96px,0.65fr) minmax(105px,0.65fr) minmax(220px,1.45fr) minmax(150px,0.9fr)'


function CreateUserForm(props: { api: ApiClient }) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [username, setUsername] = useState('')
    const [displayName, setDisplayName] = useState('')
    const [password, setPassword] = useState('')
    const [role, setRole] = useState<UserRole>('user')

    const createMutation = useMutation({
        mutationFn: async () => {
            const trimmedUsername = username.trim()
            if (!trimmedUsername || password.length < 8) {
                throw new Error(t('settings.users.create.required'))
            }
            return await props.api.createUser({
                username: trimmedUsername,
                password,
                displayName: displayName.trim() || null,
                role
            })
        },
        onSuccess: () => {
            setUsername('')
            setDisplayName('')
            setPassword('')
            setRole('user')
            void queryClient.invalidateQueries({ queryKey: queryKeys.users })
        }
    })

    return (
        <form
            className="space-y-3 px-3 py-3"
            onSubmit={(event: FormEvent) => {
                event.preventDefault()
                createMutation.mutate()
            }}
        >
            <div className="grid gap-2 sm:grid-cols-2">
                <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder={t('settings.users.username')}
                    autoComplete="off"
                    disabled={createMutation.isPending}
                    className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                />
                <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder={t('settings.users.displayName')}
                    autoComplete="off"
                    disabled={createMutation.isPending}
                    className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                />
                <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={t('settings.users.password')}
                    autoComplete="new-password"
                    disabled={createMutation.isPending}
                    className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                />
                <select
                    value={role}
                    onChange={(event) => setRole(event.target.value as UserRole)}
                    disabled={createMutation.isPending}
                    className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                >
                    {USER_ROLES.map((value) => (
                        <option key={value} value={value}>{t(`settings.users.role.${value}`)}</option>
                    ))}
                </select>
            </div>
            {createMutation.error ? (
                <div className="text-xs text-red-600">
                    {createMutation.error instanceof Error ? createMutation.error.message : t('settings.users.create.error')}
                </div>
            ) : null}
            <button
                type="submit"
                disabled={createMutation.isPending || !username.trim() || password.length < 8}
                className="rounded-md bg-[var(--app-link)] px-3 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
            >
                {createMutation.isPending ? t('settings.users.create.creating') : t('settings.users.create.submit')}
            </button>
        </form>
    )
}

function UserRow(props: {
    api: ApiClient
    currentUserId: number
    currentUserPlatform?: string
    user: EnterpriseUser
}) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [displayName, setDisplayName] = useState(props.user.displayName ?? '')
    const [password, setPassword] = useState('')
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const isOwner = props.user.platform === 'owner'
    const isSelf = props.currentUserPlatform
        ? props.user.platform === props.currentUserPlatform && props.user.id === props.currentUserId
        : props.user.id === props.currentUserId
    const canManageLocalSecret = props.user.platform === 'local'
    const showDeleteUser = canManageLocalSecret && !isOwner
    const userLabel = props.user.displayName || props.user.username || props.user.platformUserId

    function invalidateUsers() {
        void queryClient.invalidateQueries({ queryKey: queryKeys.users })
        if (isSelf) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.account })
        }
    }

    const updateMutation = useMutation({
        mutationFn: async (payload: { displayName?: string | null; role?: UserRole; disabled?: boolean }) => (
            await props.api.updateUser(props.user.id, payload)
        ),
        onSuccess: invalidateUsers
    })

    const resetPasswordMutation = useMutation({
        mutationFn: async () => await props.api.resetUserPassword(props.user.id, password),
        onSuccess: () => {
            setPassword('')
            invalidateUsers()
        }
    })

    const deleteMutation = useMutation({
        mutationFn: async () => await props.api.deleteUser(props.user.id),
        onSuccess: invalidateUsers
    })

    const rowError = updateMutation.error || resetPasswordMutation.error

    return (
        <div className="border-t border-[var(--app-divider)] first:border-t-0">
            <div className="grid items-center gap-2 px-3 py-3" style={{ gridTemplateColumns: USER_GRID_TEMPLATE }}>
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--app-fg)]">
                        {props.user.displayName || props.user.username || props.user.platformUserId}
                    </div>
                    <div className="truncate text-xs text-[var(--app-hint)]">
                        #{props.user.id} · {props.user.platform} · {props.user.namespace}
                    </div>
                </div>

                <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    disabled={isOwner || updateMutation.isPending}
                    placeholder={t('settings.users.displayName')}
                    aria-label={`${t('settings.users.displayName')}: ${userLabel}`}
                    className="min-w-0 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                />

                <select
                    value={props.user.role}
                    onChange={(event) => updateMutation.mutate({ role: event.target.value as UserRole })}
                    disabled={isOwner || isSelf || updateMutation.isPending}
                    className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    aria-label={`${t('settings.users.roleLabel')}: ${userLabel}`}
                >
                    {USER_ROLES.map((value) => (
                        <option key={value} value={value}>{t(`settings.users.role.${value}`)}</option>
                    ))}
                </select>

                <label className="inline-flex min-w-0 items-center gap-2 text-sm text-[var(--app-fg)]">
                    <input
                        type="checkbox"
                        checked={props.user.disabledAt === null}
                        onChange={(event) => updateMutation.mutate({ disabled: !event.target.checked })}
                        disabled={isOwner || isSelf || updateMutation.isPending}
                        className="h-4 w-4 rounded border-[var(--app-border)]"
                        aria-label={`${t('settings.users.columns.status')}: ${userLabel}`}
                    />
                </label>

                {canManageLocalSecret ? (
                    <div className="flex min-w-0 items-center gap-2">
                        <input
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            placeholder={t('settings.users.newPassword')}
                            autoComplete="new-password"
                            disabled={resetPasswordMutation.isPending}
                            className="min-w-0 flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
                        <button
                            type="button"
                            onClick={() => resetPasswordMutation.mutate()}
                            disabled={resetPasswordMutation.isPending || password.length < 8}
                            className="shrink-0 whitespace-nowrap rounded-md border border-[var(--app-border)] px-2.5 py-2 text-xs font-medium text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                        >
                            {resetPasswordMutation.isPending ? t('settings.users.password.saving') : t('settings.users.password.reset')}
                        </button>
                    </div>
                ) : (
                    <div className="text-sm text-[var(--app-hint)]">—</div>
                )}

                <div className="flex flex-nowrap items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={() => updateMutation.mutate({ displayName: displayName.trim() || null })}
                        disabled={isOwner || updateMutation.isPending}
                        className="whitespace-nowrap rounded-md border border-[var(--app-border)] px-2.5 py-2 text-xs font-medium text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                    >
                        {updateMutation.isPending ? t('settings.users.saving') : t('settings.users.save')}
                    </button>
                    {showDeleteUser ? (
                        <button
                            type="button"
                            onClick={() => setDeleteDialogOpen(true)}
                            disabled={isSelf || deleteMutation.isPending}
                            className="whitespace-nowrap rounded-md border border-red-500/30 px-2.5 py-2 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                        >
                            {deleteMutation.isPending ? t('settings.users.delete.deleting') : t('settings.users.delete.action')}
                        </button>
                    ) : null}
                </div>
            </div>

            {rowError ? (
                <div className="px-3 pb-3 text-xs text-red-600">
                    {rowError instanceof Error ? rowError.message : t('settings.users.update.error')}
                </div>
            ) : null}

            <ConfirmDialog
                isOpen={deleteDialogOpen}
                onClose={() => setDeleteDialogOpen(false)}
                title={t('settings.users.delete.title')}
                description={t('settings.users.delete.description', { name: userLabel })}
                confirmLabel={t('settings.users.delete.confirm')}
                confirmingLabel={t('settings.users.delete.deleting')}
                onConfirm={async () => {
                    await deleteMutation.mutateAsync()
                }}
                isPending={deleteMutation.isPending}
                destructive
            />
        </div>
    )
}

function UsersGrid(props: {
    api: ApiClient
    currentUserId: number
    currentUserPlatform?: string
    users: EnterpriseUser[]
}) {
    const { t } = useTranslation()
    return (
        <div className="overflow-x-auto">
            <div className="min-w-[900px]">
                <div
                    className="grid items-center gap-2 bg-[var(--app-subtle-bg)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)]"
                    style={{ gridTemplateColumns: USER_GRID_TEMPLATE }}
                >
                    <div>{t('settings.users.columns.user')}</div>
                    <div>{t('settings.users.columns.displayName')}</div>
                    <div>{t('settings.users.columns.role')}</div>
                    <div>{t('settings.users.columns.status')}</div>
                    <div>{t('settings.users.columns.security')}</div>
                    <div className="text-right">{t('settings.users.columns.actions')}</div>
                </div>
                {props.users.map((account) => (
                    <UserRow
                        key={`${account.platform}:${account.platformUserId}`}
                        api={props.api}
                        currentUserId={props.currentUserId}
                        currentUserPlatform={props.currentUserPlatform}
                        user={account}
                    />
                ))}
            </div>
        </div>
    )
}

export default function SettingsUsersPage() {
    const { t } = useTranslation()
    const { api, user } = useAppContext()
    const usersQuery = useQuery({
        queryKey: queryKeys.users,
        queryFn: async () => await api.getUsers(),
        enabled: user.role === 'admin'
    })

    if (user.role !== 'admin') {
        return (
            <SettingsPageContent title={t('settings.users.title')} description={t('settings.users.description')}>
                <SettingsSection title={t('settings.users.list.section')}>
                    <div className="px-3 py-3 text-sm text-[var(--app-hint)]">{t('settings.users.adminOnly')}</div>
                </SettingsSection>
            </SettingsPageContent>
        )
    }

    const users = usersQuery.data?.users ?? []

    return (
        <SettingsPageContent title={t('settings.users.title')} description={t('settings.users.description')}>
            <SettingsSection title={t('settings.users.create.section')}>
                <CreateUserForm api={api} />
            </SettingsSection>

            <SettingsSection title={t('settings.users.list.section')}>
                {usersQuery.error ? (
                    <div className="px-3 py-3 text-sm text-red-600">
                        {usersQuery.error instanceof Error ? usersQuery.error.message : t('settings.users.load.error')}
                    </div>
                ) : usersQuery.isLoading ? (
                    <div className="px-3 py-3 text-sm text-[var(--app-hint)]">{t('loading.users')}</div>
                ) : users.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-[var(--app-hint)]">{t('settings.users.empty')}</div>
                ) : (
                    <UsersGrid
                        api={api}
                        currentUserId={user.id}
                        currentUserPlatform={user.platform}
                        users={users}
                    />
                )}
            </SettingsSection>
        </SettingsPageContent>
    )
}
