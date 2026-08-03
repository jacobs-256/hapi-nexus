import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getTelegramWebApp, isTelegramEnvironment } from './useTelegram'
import type { AuthSource } from './useAuth'
import type { AuthResponse } from '@/types/api'

const ACCESS_TOKEN_PREFIX = 'hapi_access_token::'
const WEB_SESSION_PREFIX = 'hapi_web_session::'

function getTelegramInitData(): string | null {
    const tg = getTelegramWebApp()
    if (tg?.initData) {
        return tg.initData
    }

    // Fallback: check URL parameters (for testing or alternative flows)
    const query = new URLSearchParams(window.location.search)
    const tgWebAppData = query.get('tgWebAppData')
    if (tgWebAppData) {
        return tgWebAppData
    }

    const initData = query.get('initData')
    return initData || null
}

function getAccessTokenKey(baseUrl: string): string {
    return `${ACCESS_TOKEN_PREFIX}${baseUrl}`
}

function getWebSessionKey(baseUrl: string): string {
    return `${WEB_SESSION_PREFIX}${baseUrl}`
}

function getStoredWebSession(key: string): AuthSource | null {
    const read = (storage: Storage): AuthSource | null => {
        const raw = storage.getItem(key)
        if (!raw) return null
        try {
            const parsed = JSON.parse(raw) as { token?: unknown }
            return typeof parsed.token === 'string' && parsed.token
                ? { type: 'webSession', token: parsed.token }
                : null
        } catch {
            return null
        }
    }

    try {
        return read(localStorage) ?? read(sessionStorage)
    } catch {
        return null
    }
}

function storeWebSession(key: string, token: string, remember: boolean): void {
    try {
        const value = JSON.stringify({ token })
        if (remember) {
            localStorage.setItem(key, value)
            sessionStorage.removeItem(key)
        } else {
            sessionStorage.setItem(key, value)
            localStorage.removeItem(key)
        }
    } catch {
        // Ignore storage errors
    }
}

function storeCompanionAccessToken(key: string, token: string): void {
    try {
        localStorage.setItem(key, token)
    } catch {
        // Ignore storage errors
    }
}

function clearStoredWebSession(key: string): void {
    try {
        localStorage.removeItem(key)
        sessionStorage.removeItem(key)
    } catch {
        // Ignore storage errors
    }
}

function clearStoredCompanionAccessToken(key: string): void {
    try {
        localStorage.removeItem(key)
    } catch {
        // Ignore storage errors
    }
}

function clearTokenUrlParam(): void {
    if (typeof window === 'undefined') return
    try {
        const url = new URL(window.location.href)
        if (!url.searchParams.has('token')) return
        url.searchParams.delete('token')
        const nextUrl = `${url.pathname}${url.search}${url.hash}`
        window.history.replaceState(window.history.state, '', nextUrl)
    } catch {
        // Ignore URL cleanup errors
    }
}

export function useAuthSource(baseUrl: string): {
    authSource: AuthSource | null
    isLoading: boolean
    isTelegram: boolean
    setWebSession: (auth: AuthResponse, remember: boolean) => void
    clearAuth: () => void
} {
    const [authSource, setAuthSource] = useState<AuthSource | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isTelegram, setIsTelegram] = useState(false)
    const retryCountRef = useRef(0)
    const accessTokenKey = useMemo(() => getAccessTokenKey(baseUrl), [baseUrl])
    const webSessionKey = useMemo(() => getWebSessionKey(baseUrl), [baseUrl])

    // Initialize auth source on mount, with retry for delayed Telegram initData
    useEffect(() => {
        retryCountRef.current = 0
        setAuthSource(null)
        setIsTelegram(false)
        setIsLoading(true)

        const telegramInitData = getTelegramInitData()

        if (telegramInitData) {
            // Telegram Mini App environment
            setAuthSource({ type: 'telegram', initData: telegramInitData })
            setIsTelegram(true)
            setIsLoading(false)
            return
        }

        clearTokenUrlParam()

        // Plain browser sessions only restore Web JWTs created by username/password login.
        // Access-token URL params/localStorage are intentionally ignored for Web login.
        const storedWebSession = getStoredWebSession(webSessionKey)
        if (storedWebSession) {
            setAuthSource(storedWebSession)
            setIsLoading(false)
            return
        }

        // Check if we're in a Telegram environment before polling
        if (!isTelegramEnvironment()) {
            // Plain browser - show login prompt immediately
            setIsLoading(false)
            return
        }

        // Telegram environment detected - poll for delayed initData
        // Telegram WebApp SDK may initialize slightly after page mount
        const maxRetries = 20
        const retryInterval = 250 // ms

        const interval = setInterval(() => {
            retryCountRef.current += 1
            const initData = getTelegramInitData()

            if (initData) {
                setAuthSource({ type: 'telegram', initData })
                setIsTelegram(true)
                setIsLoading(false)
                clearInterval(interval)
            } else if (retryCountRef.current >= maxRetries) {
                // Give up - show login prompt for browser access
                setIsLoading(false)
                clearInterval(interval)
            }
        }, retryInterval)

        return () => {
            clearInterval(interval)
        }
    }, [webSessionKey])

    const setWebSession = useCallback((auth: AuthResponse, remember: boolean) => {
        storeWebSession(webSessionKey, auth.token, remember)
        if (auth.user.accessToken) {
            storeCompanionAccessToken(accessTokenKey, auth.user.accessToken)
        }
        setAuthSource({ type: 'webSession', token: auth.token })
    }, [accessTokenKey, webSessionKey])

    const clearAuth = useCallback(() => {
        clearStoredWebSession(webSessionKey)
        clearStoredCompanionAccessToken(accessTokenKey)
        clearTokenUrlParam()
        setAuthSource(null)
    }, [accessTokenKey, webSessionKey])

    return {
        authSource,
        isLoading,
        isTelegram,
        setWebSession,
        clearAuth
    }
}
