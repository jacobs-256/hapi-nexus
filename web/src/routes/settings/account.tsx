import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { SettingsPageContent, SettingsRow, SettingsSection } from '@/components/settings/SettingsPrimitives'

const ACCESS_TOKEN_PREFIX = 'hapi_access_token::'

function rememberAccessToken(baseUrl: string, accessToken: string): void {
    try {
        localStorage.setItem(`${ACCESS_TOKEN_PREFIX}${baseUrl}`, accessToken)
    } catch {
    }
}

export default function SettingsAccountPage() {
    const { t } = useTranslation()
    const { api, baseUrl, clearAuth } = useAppContext()
    const queryClient = useQueryClient()
    const { copied, copy } = useCopyToClipboard()
    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [passwordSaved, setPasswordSaved] = useState(false)
    const [usernameInput, setUsernameInput] = useState('')
    const [usernameSaved, setUsernameSaved] = useState(false)
    const accountQuery = useQuery({
        queryKey: queryKeys.account,
        queryFn: async () => await api.getAccount()
    })

    const regenerateMutation = useMutation({
        mutationFn: async () => await api.regenerateOwnAccessToken(),
        onSuccess: (response) => {
            rememberAccessToken(baseUrl, response.accessToken)
            queryClient.setQueryData(queryKeys.account, { user: response.user })
        }
    })

    const changePasswordMutation = useMutation({
        mutationFn: async () => {
            if (newPassword.length < 8) {
                throw new Error(t('settings.account.password.required'))
            }
            if (newPassword !== confirmPassword) {
                throw new Error(t('settings.account.password.mismatch'))
            }
            return await api.changeOwnPassword(currentPassword, newPassword)
        },
        onMutate: () => {
            setPasswordSaved(false)
        },
        onSuccess: (response) => {
            setCurrentPassword('')
            setNewPassword('')
            setConfirmPassword('')
            setPasswordSaved(true)
            queryClient.setQueryData(queryKeys.account, { user: response.user })
        }
    })

    const user = accountQuery.data?.user
    const accessToken = user?.accessToken ?? ''
    const canRegenerate = user?.platform === 'local'
    const canChangePassword = user?.platform === 'local'
    const canChangeUsername = user?.platform === 'local'
    const handleLogout = () => {
        queryClient.clear()
        clearAuth()
    }

    const changeUsernameMutation = useMutation({
        mutationFn: async () => {
            const username = usernameInput.trim()
            if (!username) {
                throw new Error(t('settings.account.username.required'))
            }
            return await api.changeOwnUsername(username)
        },
        onMutate: () => {
            setUsernameSaved(false)
        },
        onSuccess: (response) => {
            setUsernameInput(response.user.username ?? '')
            setUsernameSaved(true)
            queryClient.setQueryData(queryKeys.account, { user: response.user })
        }
    })

    useEffect(() => {
        if (user?.platform === 'local') {
            setUsernameInput(user.username ?? '')
            setUsernameSaved(false)
        }
    }, [user?.id, user?.platform, user?.username])

    return (
        <SettingsPageContent title={t('settings.account.title')} description={t('settings.account.description')}>
            <SettingsSection title={t('settings.account.profile')}>
                {accountQuery.error ? (
                    <div className="px-3 py-3 text-sm text-red-600">
                        {accountQuery.error instanceof Error ? accountQuery.error.message : t('settings.account.error')}
                    </div>
                ) : !user ? (
                    <div className="px-3 py-3 text-sm text-[var(--app-hint)]">{t('loading')}</div>
                ) : (
                    <>
                        <SettingsRow label={t('settings.account.name')} trailing={
                            <span className="text-sm text-[var(--app-hint)]">{user.displayName || user.username || user.platformUserId}</span>
                        } />
                        <SettingsRow label={t('settings.account.username')} trailing={
                            <span className="text-sm text-[var(--app-hint)]">{user.username || '-'}</span>
                        } />
                        <SettingsRow label={t('settings.account.role')} trailing={
                            <span className="rounded-full bg-[var(--app-subtle-bg)] px-2 py-0.5 text-xs font-medium text-[var(--app-hint)]">
                                {t(`settings.users.role.${user.role}`)}
                            </span>
                        } />
                        <SettingsRow label={t('settings.account.namespace')} trailing={
                            <span className="text-sm text-[var(--app-hint)]">{user.namespace}</span>
                        } />
                    </>
                )}
            </SettingsSection>

            <SettingsSection title={t('settings.account.username.section')}>
                {canChangeUsername ? (
                    <form
                        className="space-y-3 px-3 py-3"
                        onSubmit={(event: FormEvent) => {
                            event.preventDefault()
                            changeUsernameMutation.mutate()
                        }}
                    >
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <input
                                type="text"
                                value={usernameInput}
                                onChange={(event) => setUsernameInput(event.target.value)}
                                placeholder={t('settings.account.username.placeholder')}
                                aria-label={t('settings.account.username')}
                                autoComplete="username"
                                disabled={changeUsernameMutation.isPending}
                                className="min-w-[220px] flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            />
                            <button
                                type="submit"
                                disabled={changeUsernameMutation.isPending || !usernameInput.trim()}
                                className="rounded-md border border-[var(--app-border)] px-3 py-2 text-sm font-medium text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                            >
                                {changeUsernameMutation.isPending ? t('settings.account.username.saving') : t('settings.account.username.save')}
                            </button>
                            {usernameSaved ? (
                                <span className="text-xs text-emerald-600">{t('settings.account.username.saved')}</span>
                            ) : null}
                        </div>
                        {changeUsernameMutation.error ? (
                            <div className="text-xs text-red-600">
                                {changeUsernameMutation.error instanceof Error ? changeUsernameMutation.error.message : t('settings.account.username.error')}
                            </div>
                        ) : null}
                    </form>
                ) : (
                    <div className="px-3 py-3 text-sm text-[var(--app-hint)]">
                        {t('settings.account.username.ownerHint')}
                    </div>
                )}
            </SettingsSection>

            <SettingsSection title={t('settings.account.token')}>
                <div className="space-y-3 px-3 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <input
                            readOnly
                            value={accessToken}
                            className="min-w-0 flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 font-mono text-xs text-[var(--app-fg)] outline-none"
                        />
                        <button
                            type="button"
                            onClick={() => void copy(accessToken)}
                            disabled={!accessToken}
                            className="shrink-0 rounded-md border border-[var(--app-border)] px-3 py-2 text-sm font-medium text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                        >
                            {copied ? t('settings.account.copied') : t('settings.account.copy')}
                        </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => regenerateMutation.mutate()}
                            disabled={!canRegenerate || regenerateMutation.isPending}
                            className="rounded-md border border-[var(--app-border)] px-3 py-2 text-sm font-medium text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                        >
                            {regenerateMutation.isPending ? t('settings.account.regenerating') : t('settings.account.regenerate')}
                        </button>
                        {!canRegenerate ? (
                            <span className="text-xs text-[var(--app-hint)]">{t('settings.account.ownerTokenHint')}</span>
                        ) : null}
                    </div>
                    {regenerateMutation.error ? (
                        <div className="text-xs text-red-600">
                            {regenerateMutation.error instanceof Error ? regenerateMutation.error.message : t('settings.account.regenerateError')}
                        </div>
                    ) : null}
                </div>
            </SettingsSection>

            <SettingsSection title={t('settings.account.password.section')}>
                {canChangePassword ? (
                    <form
                        className="space-y-3 px-3 py-3"
                        onSubmit={(event: FormEvent) => {
                            event.preventDefault()
                            changePasswordMutation.mutate()
                        }}
                    >
                        <div className="grid gap-2 sm:grid-cols-3">
                            <input
                                type="password"
                                value={currentPassword}
                                onChange={(event) => setCurrentPassword(event.target.value)}
                                placeholder={t('settings.account.password.current')}
                                aria-label={t('settings.account.password.current')}
                                autoComplete="current-password"
                                disabled={changePasswordMutation.isPending}
                                className="min-w-0 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            />
                            <input
                                type="password"
                                value={newPassword}
                                onChange={(event) => setNewPassword(event.target.value)}
                                placeholder={t('settings.account.password.new')}
                                aria-label={t('settings.account.password.new')}
                                autoComplete="new-password"
                                disabled={changePasswordMutation.isPending}
                                className="min-w-0 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            />
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(event) => setConfirmPassword(event.target.value)}
                                placeholder={t('settings.account.password.confirm')}
                                aria-label={t('settings.account.password.confirm')}
                                autoComplete="new-password"
                                disabled={changePasswordMutation.isPending}
                                className="min-w-0 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="submit"
                                disabled={changePasswordMutation.isPending || !currentPassword || newPassword.length < 8 || !confirmPassword}
                                className="rounded-md border border-[var(--app-border)] px-3 py-2 text-sm font-medium text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                            >
                                {changePasswordMutation.isPending ? t('settings.account.password.saving') : t('settings.account.password.save')}
                            </button>
                            {passwordSaved ? (
                                <span className="text-xs text-emerald-600">{t('settings.account.password.saved')}</span>
                            ) : null}
                        </div>
                        {changePasswordMutation.error ? (
                            <div className="text-xs text-red-600">
                                {changePasswordMutation.error instanceof Error ? changePasswordMutation.error.message : t('settings.account.password.error')}
                            </div>
                        ) : null}
                    </form>
                ) : (
                    <div className="px-3 py-3 text-sm text-[var(--app-hint)]">
                        {t('settings.account.password.ownerHint')}
                    </div>
                )}
            </SettingsSection>

            <SettingsSection title={t('settings.account.session')}>
                <SettingsRow
                    label={t('settings.account.logout')}
                    description={t('settings.account.logoutDescription')}
                    trailing={
                        <button
                            type="button"
                            onClick={handleLogout}
                            className="rounded-md border border-red-500/30 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
                        >
                            {t('settings.account.logout')}
                        </button>
                    }
                />
            </SettingsSection>
        </SettingsPageContent>
    )
}
