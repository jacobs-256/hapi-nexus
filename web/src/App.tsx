import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Outlet, useLocation, useMatchRoute, useRouter } from '@tanstack/react-router'
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
import { AppContextProvider } from '@/lib/app-context'
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

function AppTitleBar(props: { user: AuthResponse['user'] }) {
    const { t } = useTranslation()
    const { colorScheme } = useTheme()
    const { setAppearance } = useAppearance()
    const isDark = colorScheme === 'dark' || colorScheme === 'oled'
    const userLabel = getUserLabel(props.user, t('app.user.fallback'))
    const userInitial = Array.from(userLabel)[0]?.toUpperCase() ?? 'A'
    const nextThemeLabel = isDark ? t('login.theme.light') : t('login.theme.dark')

    return (
        <div className="relative flex h-11 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--toolbar)] pl-4 pr-3 text-[var(--foreground)] sm:pl-20 sm:pr-4">
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
                <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, #0a84ff, #5e5ce6)' }}
                    title={userLabel}
                >
                    {userInitial}
                </div>
            </div>
        </div>
    )
}

function AppStatusBar() {
    const { t } = useTranslation()

    return (
        <div className="flex h-[22px] shrink-0 items-center gap-4 bg-[var(--primary)] px-3 font-mono text-[10.5px] text-white/90">
            <span className="opacity-80">{t('app.status.product')}</span>
            <span className="hidden sm:inline">◉ {t('app.status.language')}</span>
            <span className="hidden sm:inline">{t('app.status.encoding')}</span>
            <span className="ml-auto">{t('app.status.connected')}</span>
            <span className="h-1.5 w-1.5 rounded-full bg-[#30d158]" />
        </div>
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
                <div className="flex h-full min-h-0 flex-col bg-[var(--background)] text-[var(--foreground)]">
                    {!isTelegramApp() ? <AppTitleBar user={user} /> : null}
                    <div className="min-h-0 flex-1">
                        <Outlet />
                    </div>
                    {!isTelegramApp() ? <AppStatusBar /> : null}
                </div>
                <ToastContainer />
                <InstallPrompt />
            </VoiceProvider>
        </AppContextProvider>
    )
}
