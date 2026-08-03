import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { EnterpriseUser, UserRole } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { SettingsPageContent, SettingsSection } from '@/components/settings/SettingsPrimitives'

const ACCESS_TOKEN_PREFIX = 'hapi_access_token::'
const USER_ROLES: UserRole[] = ['user', 'admin']

function rememberAccessToken(baseUrl: string, accessToken: string): void {
    try {
        localStorage.setItem(`${ACCESS_TOKEN_PREFIX}${baseUrl}`, accessToken)
    } catch {
    }
}

function RoleBadge(props: { role: UserRole }) {
    const { t } = useTranslation()
    return (
        <span className="rounded-full bg-[var(--app-subtle-bg)] px-2 py-0.5 text-xs font-medium text-[var(--app-hint)]">
            {t(`settings.users.role.${props.role}`)}
        </span>
    )
}

function TokenField(props: { accessToken: string | null | undefined }) {
    const { t } = useTranslation()
    const { copied, copy } = useCopyToClipboard()
    const token = props.accessToken ?? ''
    return (
        <div className="flex min-w-0 items-center gap-2">
            <input
                readOnly
                value={token}
                className="min-w-0 flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5 font-mono text-[11px] text-[var(--app-fg)] outline-none"
            />
            <button
                type="button"
                onClick={() => void copy(token)}
                disabled={!token}
                className="shrink-0 rounded border border-[var(--app-border)] px-2 py-1.5 text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
            >
                {copied ? t('settings.users.copied') : t('settings.users.copy')}
            </button>
        </div>
    )
}

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
    baseUrl: string
    currentUserId: number
    user: EnterpriseUser
}) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [displayName, setDisplayName] = useState(props.user.displayName ?? '')
    const [password, setPassword] = useState('')
    const isOwner = props.user.platform === 'owner'
    const isSelf = props.user.id === props.currentUserId
    const canManageLocalSecret = props.user.platform === 'local'

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

    const regenerateMutation = useMutation({
        mutationFn: async () => await props.api.regenerateUserAccessToken(props.user.id),
        onSuccess: (response) => {
            if (isSelf) {
                rememberAccessToken(props.baseUrl, response.accessToken)
            }
            invalidateUsers()
        }
    })

    const rowError = updateMutation.error || resetPasswordMutation.error || regenerateMutation.error

    return (
        <div className="space-y-3 px-3 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--app-fg)]">
                        {props.user.displayName || props.user.username || props.user.platformUserId}
                    </div>
                    <div className="truncate text-xs text-[var(--app-hint)]">
                        #{props.user.id} · {props.user.platform} · {props.user.namespace}
                    </div>
                </div>
                <RoleBadge role={props.user.role} />
                {props.user.disabledAt !== null ? (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
                        {t('settings.users.disabled')}
                    </span>
                ) : null}
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    disabled={isOwner || updateMutation.isPending}
                    placeholder={t('settings.users.displayName')}
                    className="min-w-0 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                />
                <select
                    value={props.user.role}
                    onChange={(event) => updateMutation.mutate({ role: event.target.value as UserRole })}
                    disabled={isOwner || isSelf || updateMutation.isPending}
                    className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    aria-label={t('settings.users.roleLabel')}
                >
                    {USER_ROLES.map((value) => (
                        <option key={value} value={value}>{t(`settings.users.role.${value}`)}</option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={() => updateMutation.mutate({ displayName: displayName.trim() || null })}
                    disabled={isOwner || updateMutation.isPending}
                    className="rounded-md border border-[var(--app-border)] px-3 py-2 text-sm font-medium text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                >
                    {updateMutation.isPending ? t('settings.users.saving') : t('settings.users.save')}
                </button>
            </div>

            <label className="flex items-center gap-2 text-sm text-[var(--app-fg)]">
                <input
                    type="checkbox"
                    checked={props.user.disabledAt !== null}
                    onChange={(event) => updateMutation.mutate({ disabled: event.target.checked })}
                    disabled={isOwner || isSelf || updateMutation.isPending}
                    className="h-4 w-4 rounded border-[var(--app-border)]"
                />
                {t('settings.users.disableAccount')}
            </label>

            <TokenField accessToken={props.user.accessToken} />

            {canManageLocalSecret ? (
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                    <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder={t('settings.users.newPassword')}
                        autoComplete="new-password"
                        disabled={resetPasswordMutation.isPending}
                        className="min-w-0 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    />
                    <button
                        type="button"
                        onClick={() => resetPasswordMutation.mutate()}
                        disabled={resetPasswordMutation.isPending || password.length < 8}
                        className="rounded-md border border-[var(--app-border)] px-3 py-2 text-sm font-medium text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                    >
                        {resetPasswordMutation.isPending ? t('settings.users.password.saving') : t('settings.users.password.reset')}
                    </button>
                    <button
                        type="button"
                        onClick={() => regenerateMutation.mutate()}
                        disabled={regenerateMutation.isPending}
                        className="rounded-md border border-[var(--app-border)] px-3 py-2 text-sm font-medium text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                    >
                        {regenerateMutation.isPending ? t('settings.users.token.regenerating') : t('settings.users.token.regenerate')}
                    </button>
                </div>
            ) : null}

            {rowError ? (
                <div className="text-xs text-red-600">
                    {rowError instanceof Error ? rowError.message : t('settings.users.update.error')}
                </div>
            ) : null}
        </div>
    )
}

export default function SettingsUsersPage() {
    const { t } = useTranslation()
    const { api, baseUrl, user } = useAppContext()
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
                    users.map((account) => (
                        <UserRow
                            key={`${account.platform}:${account.platformUserId}`}
                            api={api}
                            baseUrl={baseUrl}
                            currentUserId={user.id}
                            user={account}
                        />
                    ))
                )}
            </SettingsSection>
        </SettingsPageContent>
    )
}
