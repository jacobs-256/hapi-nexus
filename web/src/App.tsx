import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Outlet, useLocation, useMatchRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { getTelegramWebApp, isTelegramApp } from '@/hooks/useTelegram'
import { initializeChatSurfaceColors } from '@/hooks/useChatSurfaceColors'
import { initializeTheme } from '@/hooks/useTheme'
import { initializeThemeColors } from '@/hooks/useThemeColors'
import { useAuth } from '@/hooks/useAuth'
import { useAuthSource } from '@/hooks/useAuthSource'
import { useServerUrl } from '@/hooks/useServerUrl'
import { useSSE } from '@/hooks/useSSE'
import { useSyncingState } from '@/hooks/useSyncingState'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useViewportHeight } from '@/hooks/useViewportHeight'
import { useVisibilityReporter } from '@/hooks/useVisibilityReporter'
import { useAppearance, useTheme } from '@/hooks/useTheme'
import { queryKeys } from '@/lib/query-keys'
import { AppContextProvider, useAppContext } from '@/lib/app-context'
import { clearMessageWindow, syncTailMessages } from '@/lib/message-window-store'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useTranslation } from '@/lib/use-translation'
import { VoiceProvider } from '@/lib/voice-context'
import { requireHubUrlForLogin } from '@/lib/runtime-config'
import { getAppGlobalSseSubscription, getAppSessionSseSubscription } from '@/lib/appSseSubscriptions'
import { reconcileQueuedStateAfterConnect } from '@/lib/queued-state-reconciliation'
import { LoginPrompt } from '@/components/LoginPrompt'
import { InstallPrompt } from '@/components/InstallPrompt'
import { OfflineBanner } from '@/components/OfflineBanner'
import { PwaUpdateBanner, PwaUpdateBannerWithStatusOffset } from '@/components/PwaUpdateBanner'
import { SyncingBanner } from '@/components/SyncingBanner'
import { ReconnectingBanner } from '@/components/ReconnectingBanner'
import { VoiceErrorBanner } from '@/components/VoiceErrorBanner'
import { LoadingState } from '@/components/LoadingState'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { ToastContainer } from '@/components/ToastContainer'
import { PwaUpdateProvider } from '@/lib/pwa-update-context'
import { ToastProvider, useToast } from '@/lib/toast-context'
import { getVisibleSettingsCategories, settingsCategoryGroups } from '@/routes/settings/categories'
import type { AuthResponse, SyncEvent } from '@/types/api'

type ToastEvent = Extract<SyncEvent, { type: 'toast' }>

const REQUIRE_SERVER_URL = requireHubUrlForLogin()

function withPwaBanner(content: ReactNode) {
    return (
        <>
            <PwaUpdateBanner />
            {content}
        </>
    )
}

function IconCode(props: { size?: number }) {
    const size = props.size ?? 12
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
        </svg>
    )
}

function IconSun() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
    )
}

function IconMoon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
    )
}

function IconChevronRight(props: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className} aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
        </svg>
    )
}

function IconLogOut(props: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className} aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
    )
}

function TrafficLights() {
    return (
        <>
            {['#ff5f56', '#ffbd2e', '#27c93f'].map((color) => (
                <span key={color} className="h-[11px] w-[11px] rounded-full" style={{ background: color }} />
            ))}
        </>
    )
}

function getUserLabel(user: AuthResponse['user'], fallback: string): string {
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
    return user.displayName?.trim() || fullName || user.username?.trim() || fallback
}

function AppTitleBar() {
    const { t } = useTranslation()
    const { token, user, clearAuth } = useAppContext()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { colorScheme } = useTheme()
    const { setAppearance } = useAppearance()
    const [userMenuOpen, setUserMenuOpen] = useState(false)
    const isDark = colorScheme === 'dark' || colorScheme === 'oled'
    const userLabel = getUserLabel(user, t('app.user.fallback'))
    const userInitial = Array.from(userLabel)[0]?.toUpperCase() ?? 'A'
    const nextThemeLabel = isDark ? t('login.theme.light') : t('login.theme.dark')
    const visibleCategories = useMemo(() => getVisibleSettingsCategories({ token, user }), [token, user])
    const visibleById = useMemo(() => new Map(visibleCategories.map((category) => [category.id, category])), [visibleCategories])
    const roleLabel = user.role ? t(`settings.users.role.${user.role}`) : null
    const userMeta = [roleLabel, user.platform].filter(Boolean).join(' · ')
    const handleSignOut = useCallback(() => {
        setUserMenuOpen(false)
        queryClient.clear()
        clearAuth()
    }, [clearAuth, queryClient])

    return (
        <header className="shrink-0 border-b border-[var(--border)] bg-[var(--toolbar)] pt-[var(--app-shell-safe-area-top)] text-[var(--foreground)]">
            <div className="relative flex h-11 items-center gap-3 px-3 sm:pl-20 sm:pr-4">
                <div className="absolute left-3.5 hidden gap-[7px] sm:flex">
                    <TrafficLights />
                </div>

                <div className="flex min-w-0 items-center gap-1.5">
                    <div
                        className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md text-white"
                        style={{ background: 'linear-gradient(135deg, #0a84ff, #5e5ce6)' }}
                    >
                        <IconCode />
                    </div>
                    <span className="truncate text-[13px] font-semibold tracking-[-0.2px]">HAPI</span>
                    <span className="hidden font-mono text-[11px] text-[var(--muted-foreground)] sm:inline">
                        - {t('app.title.context')}
                    </span>
                </div>

                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    <LanguageSwitcher variant="toolbar" />
                    <button
                        type="button"
                        onClick={() => setAppearance(isDark ? 'light' : 'dark')}
                        className="flex h-8 w-8 items-center justify-center gap-1.5 rounded-[7px] border border-[var(--border)] bg-[var(--card)] px-0 font-mono text-[11px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] sm:w-auto sm:px-2.5"
                        title={nextThemeLabel}
                        aria-label={nextThemeLabel}
                    >
                        {isDark ? <IconSun /> : <IconMoon />}
                        <span className="hidden sm:inline">
                            {isDark ? t('settings.display.appearance.light') : t('settings.display.appearance.dark')}
                        </span>
                    </button>
                    <Popover.Root open={userMenuOpen} onOpenChange={setUserMenuOpen}>
                        <Popover.Trigger asChild>
                            <button
                                type="button"
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--toolbar)]"
                                style={{ background: 'linear-gradient(135deg, #0a84ff, #5e5ce6)' }}
                                title={userLabel}
                                aria-label={t('app.user.menu')}
                            >
                                {userInitial}
                            </button>
                        </Popover.Trigger>
                        <Popover.Portal>
                            <Popover.Content
                                side="bottom"
                                align="end"
                                sideOffset={8}
                                collisionPadding={8}
                                className="z-50 max-h-[calc(100vh-64px)] w-72 overflow-y-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-dialog-bg)] p-1.5 text-[var(--app-fg)] shadow-2xl outline-none"
                            >
                                <div className="flex min-w-0 items-center gap-3 px-2.5 py-2.5">
                                    <div
                                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
                                        style={{ background: 'linear-gradient(135deg, #0a84ff, #5e5ce6)' }}
                                        aria-hidden="true"
                                    >
                                        {userInitial}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold text-[var(--app-fg)]">{userLabel}</div>
                                        {userMeta ? (
                                            <div className="mt-0.5 truncate text-xs text-[var(--app-hint)]">{userMeta}</div>
                                        ) : null}
                                    </div>
                                </div>
                                <div className="my-1 h-px bg-[var(--app-divider)]" />
                                <div className="px-2 py-1 text-[10px] font-semibold uppercase text-[var(--app-hint)]">
                                    {t('settings.title')}
                                </div>
                                {settingsCategoryGroups.map((group) => {
                                    const items = group.categoryIds
                                        .map((id) => visibleById.get(id))
                                        .filter((category): category is NonNullable<typeof category> => Boolean(category))
                                    if (items.length === 0) return null
                                    return (
                                        <section key={group.id} aria-label={t(group.titleKey)}>
                                            <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase text-[var(--app-hint)]">
                                                {t(group.titleKey)}
                                            </div>
                                            <div className="space-y-0.5">
                                                {items.map((category) => (
                                                    <button
                                                        key={category.id}
                                                        type="button"
                                                        onClick={() => {
                                                            setUserMenuOpen(false)
                                                            navigate({ to: category.path })
                                                        }}
                                                        className="flex min-h-8 w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)]"
                                                    >
                                                        <span className="truncate">{t(category.titleKey)}</span>
                                                        <IconChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--app-hint)]" />
                                                    </button>
                                                ))}
                                            </div>
                                        </section>
                                    )
                                })}
                                <div className="my-1 h-px bg-[var(--app-divider)]" />
                                <button
                                    type="button"
                                    onClick={handleSignOut}
                                    className="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
                                >
                                    <IconLogOut className="h-4 w-4 shrink-0" />
                                    <span className="truncate">{t('settings.account.logout')}</span>
                                </button>
                            </Popover.Content>
                        </Popover.Portal>
                    </Popover.Root>
                </div>
            </div>
        </header>
    )
}

function AppStatusBar() {
    const { t } = useTranslation()

    return (
        <footer className="shrink-0 bg-[var(--primary)] pb-[var(--app-shell-safe-area-bottom)]">
            <div className="flex h-[22px] items-center gap-4 px-3 font-mono text-[10.5px] text-white/90">
                <span className="opacity-80">{t('app.status.product')}</span>
                <span className="hidden sm:inline">◉ {t('app.status.language')}</span>
                <span className="hidden sm:inline">{t('app.status.encoding')}</span>
                <span className="ml-auto">{t('app.status.connected')}</span>
                <span className="h-1.5 w-1.5 rounded-full bg-[#30d158]" />
            </div>
        </footer>
    )
}

export function App() {
    return (
        <ToastProvider>
            <PwaUpdateProvider>
                <AppInner />
            </PwaUpdateProvider>
        </ToastProvider>
    )
}

function AppInner() {
    const { t } = useTranslation()
    const { serverUrl, baseUrl, setServerUrl, clearServerUrl } = useServerUrl()
    const { authSource, isLoading: isAuthSourceLoading, setWebSession, clearAuth } = useAuthSource(baseUrl)
    const { token, user, api, isLoading: isAuthLoading, error: authError, needsBinding, bind } = useAuth(authSource, baseUrl)
    const goBack = useAppGoBack()
    const pathname = useLocation({ select: (location) => location.pathname })
    const matchRoute = useMatchRoute()
    const router = useRouter()
    const { addToast } = useToast()

    useEffect(() => {
        const tg = getTelegramWebApp()
        tg?.ready()
        tg?.expand()
        initializeTheme()
        initializeThemeColors()
        initializeChatSurfaceColors()
    }, [])

    // Track visual viewport height for mobile keyboard avoidance (see useViewportHeight.ts)
    useViewportHeight()

    useEffect(() => {
        const preventDefault = (event: Event) => {
            event.preventDefault()
        }

        const onWheel = (event: WheelEvent) => {
            if (event.ctrlKey) {
                event.preventDefault()
            }
        }

        const onKeyDown = (event: KeyboardEvent) => {
            const modifier = event.ctrlKey || event.metaKey
            if (!modifier) return
            if (event.key === '+' || event.key === '-' || event.key === '=' || event.key === '0') {
                event.preventDefault()
            }
        }

        document.addEventListener('gesturestart', preventDefault as EventListener, { passive: false })
        document.addEventListener('gesturechange', preventDefault as EventListener, { passive: false })
        document.addEventListener('gestureend', preventDefault as EventListener, { passive: false })

        window.addEventListener('wheel', onWheel, { passive: false })
        window.addEventListener('keydown', onKeyDown)

        return () => {
            document.removeEventListener('gesturestart', preventDefault as EventListener)
            document.removeEventListener('gesturechange', preventDefault as EventListener)
            document.removeEventListener('gestureend', preventDefault as EventListener)

            window.removeEventListener('wheel', onWheel)
            window.removeEventListener('keydown', onKeyDown)
        }
    }, [])

    useEffect(() => {
        const tg = getTelegramWebApp()
        const backButton = tg?.BackButton
        if (!backButton) return

        if (pathname === '/' || pathname === '/sessions') {
            backButton.offClick(goBack)
            backButton.hide()
            return
        }

        backButton.show()
        backButton.onClick(goBack)
        return () => {
            backButton.offClick(goBack)
            backButton.hide()
        }
    }, [goBack, pathname])
    const queryClient = useQueryClient()
    const sessionMatch = matchRoute({ to: '/sessions/$sessionId' })
    const selectedSessionId = sessionMatch && sessionMatch.sessionId !== 'new' ? sessionMatch.sessionId : null
    const { isSyncing, startSync, endSync } = useSyncingState()
    const [sseDisconnected, setSseDisconnected] = useState(false)
    const [sseDisconnectReason, setSseDisconnectReason] = useState<string | null>(null)
    const syncTokenRef = useRef(0)
    const isFirstConnectRef = useRef(true)
    const baseUrlRef = useRef(baseUrl)
    const pushPromptedRef = useRef(false)
    const { isSupported: isPushSupported, permission: pushPermission, requestPermission, subscribe } = usePushNotifications(api)

    useEffect(() => {
        if (baseUrlRef.current === baseUrl) {
            return
        }
        baseUrlRef.current = baseUrl
        isFirstConnectRef.current = true
        syncTokenRef.current = 0
        queryClient.clear()
    }, [baseUrl, queryClient])

    // Clean up URL params after successful auth (for direct access links)
    useEffect(() => {
        if (!token || !api) return
        const { pathname, search, hash, state } = router.history.location
        const searchParams = new URLSearchParams(search)
        if (!searchParams.has('server') && !searchParams.has('hub') && !searchParams.has('token')) {
            return
        }
        searchParams.delete('server')
        searchParams.delete('hub')
        searchParams.delete('token')
        const nextSearch = searchParams.toString()
        const nextHref = `${pathname}${nextSearch ? `?${nextSearch}` : ''}${hash}`
        router.history.replace(nextHref, state)
    }, [token, api, router])

    useEffect(() => {
        if (!api || !token) {
            pushPromptedRef.current = false
            return
        }
        if (isTelegramApp() || !isPushSupported) {
            return
        }
        if (pushPromptedRef.current) {
            return
        }
        pushPromptedRef.current = true

        const run = async () => {
            if (pushPermission === 'granted') {
                await subscribe()
                return
            }
            if (pushPermission === 'default') {
                const granted = await requestPermission()
                if (granted) {
                    await subscribe()
                }
            }
        }

        void run()
    }, [api, isPushSupported, pushPermission, requestPermission, subscribe, token])

    const handleSseConnect = useCallback(() => {
        // Clear disconnected state on successful connection
        setSseDisconnected(false)
        setSseDisconnectReason(null)

        // Increment token to track this specific connection
        const token = ++syncTokenRef.current

        // Only force show banner on first connect (page load)
        // Subsequent connects (session switches) use non-forced mode
        // which only shows banner when returning from background
        if (isFirstConnectRef.current) {
            isFirstConnectRef.current = false
            startSync({ force: true })
        } else {
            startSync()
        }
        const invalidations = [
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
            // Invalidate ALL cached session-detail entries on reconnect, not just
            // the selected one.  With `SESSION_DETAIL_STALE_TIME_MS` extending the
            // freshness window on `useSession`, a previously-viewed session that
            // received updates during the SSE gap would otherwise serve stale
            // cached data on remount.  See tiann/hapi#884.
            queryClient.invalidateQueries({ queryKey: ['session'] })
        ]
        const refreshMessages = (selectedSessionId && api)
            ? syncTailMessages(api, selectedSessionId)
            : Promise.resolve()
        Promise.all([...invalidations, refreshMessages])
            .catch((error) => {
                console.error('Failed to invalidate queries on SSE connect:', error)
            })
            .finally(() => {
                // Only end sync if this is still the latest connection
                if (syncTokenRef.current === token) {
                    endSync()
                }
            })
    }, [api, queryClient, selectedSessionId, startSync, endSync])

    const handleSseDisconnect = useCallback((reason: string) => {
        // Only show reconnecting banner if we've already connected once
        if (!isFirstConnectRef.current) {
            setSseDisconnected(true)
            setSseDisconnectReason(reason)
        }
    }, [])

    const handleSseEvent = useCallback((event: SyncEvent) => {
        if (event.type !== 'messages-invalidated') {
            return
        }
        if (!api || event.sessionId !== selectedSessionId) {
            return
        }
        clearMessageWindow(event.sessionId)
        void syncTailMessages(api, event.sessionId)
    }, [api, selectedSessionId])

    const handleSessionSseConnect = useCallback(() => {
        if (!api || !selectedSessionId) {
            return
        }
        void reconcileQueuedStateAfterConnect(api, selectedSessionId).catch((error) => {
            console.error('Failed to reconcile queued state after SSE connect:', error)
        })
    }, [api, selectedSessionId])

    const translateIncomingToast = useCallback((title: string, body: string): { title: string; body: string } => {
        const normalizedTitle = title.trim()
        const normalizedBody = body.trim()

        if (normalizedTitle === 'Ready for input') {
            const waitingMatch = normalizedBody.match(/^(.+)\s+is waiting in\s+(.+)$/i)
            if (waitingMatch) {
                const agent = waitingMatch[1]?.trim() ?? ''
                const sessionName = waitingMatch[2]?.trim() ?? ''
                return {
                    title: t('toast.ready.title'),
                    body: t('toast.ready.body', { agent, session: sessionName })
                }
            }
            return {
                title: t('toast.ready.title'),
                body: normalizedBody
            }
        }

        if (normalizedTitle === 'Permission Request') {
            return {
                title: t('toast.permission.title'),
                body: normalizedBody
            }
        }

        if (normalizedTitle === 'Task completed') {
            return {
                title: t('toast.task.completed'),
                body: normalizedBody
            }
        }

        if (normalizedTitle === 'Task failed') {
            return {
                title: t('toast.task.failed'),
                body: normalizedBody
            }
        }

        return { title, body }
    }, [t])

    const handleToast = useCallback((event: ToastEvent) => {
        const localized = translateIncomingToast(event.data.title, event.data.body)
        addToast({
            title: localized.title,
            body: localized.body,
            sessionId: event.data.sessionId,
            url: event.data.url
        })
    }, [addToast, translateIncomingToast])

    const globalEventSubscription = useMemo(() => getAppGlobalSseSubscription(), [])
    const sessionEventSubscription = useMemo(
        () => getAppSessionSseSubscription(selectedSessionId),
        [selectedSessionId]
    )
    const sseEnabled = Boolean(api && token)
    const showReconnectingBanner = sseDisconnected && !isSyncing
    const telegramApp = isTelegramApp()
    const appShellStyle = {
        '--app-shell-safe-area-top': telegramApp ? '0px' : 'env(safe-area-inset-top)',
        '--app-shell-safe-area-bottom': telegramApp ? '0px' : 'env(safe-area-inset-bottom)',
        '--app-page-safe-area-top': telegramApp ? 'env(safe-area-inset-top)' : '0px',
        '--app-page-safe-area-bottom': telegramApp ? 'env(safe-area-inset-bottom)' : '0px',
    } as CSSProperties

    const { subscriptionId: globalSubscriptionId } = useSSE({
        enabled: sseEnabled,
        token: token ?? '',
        baseUrl,
        subscription: globalEventSubscription,
        scope: 'global',
        onConnect: handleSseConnect,
        onDisconnect: handleSseDisconnect,
        onEvent: () => {},
        onToast: handleToast
    })

    const { subscriptionId: sessionSubscriptionId } = useSSE({
        enabled: sseEnabled && Boolean(sessionEventSubscription),
        token: token ?? '',
        baseUrl,
        subscription: sessionEventSubscription ?? undefined,
        scope: 'full',
        onConnect: handleSessionSseConnect,
        onEvent: handleSseEvent
    })

    useVisibilityReporter({
        api,
        subscriptionId: globalSubscriptionId,
        enabled: sseEnabled
    })

    useVisibilityReporter({
        api,
        subscriptionId: sessionSubscriptionId,
        enabled: sseEnabled && Boolean(sessionEventSubscription)
    })

    // Loading auth source
    if (isAuthSourceLoading) {
        return withPwaBanner(
            <div className="h-full flex items-center justify-center p-4">
                <LoadingState label={t('loading')} className="text-sm" />
            </div>,
        )
    }

    // No auth source (browser environment, not logged in)
    if (!authSource) {
        return withPwaBanner(
            <LoginPrompt
                onLogin={setWebSession}
                baseUrl={baseUrl}
                serverUrl={serverUrl}
                setServerUrl={setServerUrl}
                clearServerUrl={clearServerUrl}
                requireServerUrl={REQUIRE_SERVER_URL}
            />,
        )
    }

    if (needsBinding) {
        return withPwaBanner(
            <LoginPrompt
                mode="bind"
                onBind={bind}
                baseUrl={baseUrl}
                serverUrl={serverUrl}
                setServerUrl={setServerUrl}
                clearServerUrl={clearServerUrl}
                requireServerUrl={REQUIRE_SERVER_URL}
                error={authError ?? undefined}
            />,
        )
    }

    // Authenticating (also covers the gap before useAuth effect starts)
    if (isAuthLoading || (authSource && !token && !authError)) {
        return withPwaBanner(
            <div className="h-full flex items-center justify-center p-4">
                <LoadingState label={t('authorizing')} className="text-sm" />
            </div>,
        )
    }

    // Auth error
    if (authError || !token || !api || !user) {
        // If using a browser Web session and auth failed, show login again.
        if (authSource.type === 'webSession') {
            return withPwaBanner(
                <LoginPrompt
                    onLogin={setWebSession}
                    baseUrl={baseUrl}
                    serverUrl={serverUrl}
                    setServerUrl={setServerUrl}
                    clearServerUrl={clearServerUrl}
                    requireServerUrl={REQUIRE_SERVER_URL}
                    error={authError ?? t('login.error.authFailed')}
                />,
            )
        }

        // Telegram auth failed
        return withPwaBanner(
            <div className="p-4 space-y-3">
                <div className="text-base font-semibold">{t('login.title')}</div>
                <div className="text-sm text-red-600">
                    {authError ?? t('login.error.authFailed')}
                </div>
                <div className="text-xs text-[var(--app-hint)]">
                    Open this page from Telegram using the bot's "Open App" button (not "Open in browser").
                </div>
            </div>,
        )
    }

    return (
        <AppContextProvider value={{ api, token, baseUrl, user, clearAuth }}>
            <VoiceProvider>
                <PwaUpdateBannerWithStatusOffset
                    isSyncing={isSyncing}
                    isReconnecting={showReconnectingBanner}
                />
                <SyncingBanner isSyncing={isSyncing} />
                <ReconnectingBanner
                    isReconnecting={showReconnectingBanner}
                    reason={sseDisconnectReason}
                />
                <VoiceErrorBanner />
                <OfflineBanner
                    isHubConnected={globalSubscriptionId !== null}
                    isReconnecting={showReconnectingBanner}
                />
                <div
                    className="flex h-full min-h-0 flex-col bg-[var(--background)] text-[var(--foreground)]"
                    style={appShellStyle}
                >
                    {!telegramApp ? <AppTitleBar /> : null}
                    <div className="min-h-0 flex-1">
                        <Outlet />
                    </div>
                    {!telegramApp ? <AppStatusBar /> : null}
                </div>
                <ToastContainer />
                <InstallPrompt />
            </VoiceProvider>
        </AppContextProvider>
    )
}
