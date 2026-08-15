import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import {
    COMPOSER_TOOLBAR_ITEM_IDS,
    type ComposerToolbarItemId,
} from './useComposerToolbarLayout'

export type GlobalComposerToolbarSettings = {
    disabled: ComposerToolbarItemId[]
}

const DEFAULT_SETTINGS: GlobalComposerToolbarSettings = { disabled: [] }
const CHANGE_EVENT = 'hapi-global-composer-toolbar-settings-change'

let cachedSettings: GlobalComposerToolbarSettings | null = null

function normalizeGlobalComposerToolbarSettings(value: unknown): GlobalComposerToolbarSettings {
    const candidate = value as Partial<GlobalComposerToolbarSettings> | null | undefined
    const seen = new Set<ComposerToolbarItemId>()
    const disabled = Array.isArray(candidate?.disabled)
        ? candidate.disabled.filter((item): item is ComposerToolbarItemId => {
            if (
                typeof item !== 'string'
                || !(COMPOSER_TOOLBAR_ITEM_IDS as readonly string[]).includes(item)
                || seen.has(item as ComposerToolbarItemId)
            ) {
                return false
            }
            seen.add(item as ComposerToolbarItemId)
            return true
        })
        : []
    return { disabled }
}

function apiSupportsGlobalComposerToolbarSettings(api: ApiClient | null | undefined): api is ApiClient {
    return typeof (api as { getGlobalComposerToolbarSettings?: unknown } | null | undefined)?.getGlobalComposerToolbarSettings === 'function'
}

export function dispatchGlobalComposerToolbarSettingsChange(settings: unknown): void {
    cachedSettings = normalizeGlobalComposerToolbarSettings(settings)
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent<GlobalComposerToolbarSettings>(CHANGE_EVENT, { detail: cachedSettings }))
}

export function useGlobalComposerToolbarSettings(
    api: ApiClient | null | undefined,
    enabled: boolean = true
): {
    settings: GlobalComposerToolbarSettings
    isLoading: boolean
    error: string | null
    refetch: () => Promise<GlobalComposerToolbarSettings>
} {
    const [settings, setSettings] = useState<GlobalComposerToolbarSettings>(cachedSettings ?? DEFAULT_SETTINGS)
    const [isLoading, setIsLoading] = useState(() => enabled && apiSupportsGlobalComposerToolbarSettings(api) && cachedSettings === null)
    const [error, setError] = useState<string | null>(null)
    const apiRef = useRef(api)
    apiRef.current = api
    const apiAvailable = apiSupportsGlobalComposerToolbarSettings(api)

    const refetch = useCallback(async () => {
        const currentApi = apiRef.current
        if (!enabled || !apiSupportsGlobalComposerToolbarSettings(currentApi)) {
            return cachedSettings ?? DEFAULT_SETTINGS
        }
        setIsLoading(true)
        try {
            const response = await currentApi.getGlobalComposerToolbarSettings()
            const next = normalizeGlobalComposerToolbarSettings(response.settings)
            cachedSettings = next
            setSettings(next)
            setError(null)
            return next
        } catch (fetchError) {
            setError(fetchError instanceof Error ? fetchError.message : 'Failed to load global toolbar settings')
            return cachedSettings ?? DEFAULT_SETTINGS
        } finally {
            setIsLoading(false)
        }
    }, [apiAvailable, enabled])

    useEffect(() => {
        const onChange = (event: Event) => {
            const detail = event instanceof CustomEvent ? event.detail : null
            setSettings(normalizeGlobalComposerToolbarSettings(detail ?? cachedSettings ?? DEFAULT_SETTINGS))
        }
        window.addEventListener(CHANGE_EVENT, onChange)
        return () => window.removeEventListener(CHANGE_EVENT, onChange)
    }, [])

    useEffect(() => {
        void refetch()
    }, [refetch])

    useEffect(() => {
        if (!enabled || !apiAvailable) {
            return
        }
        const onFocus = () => {
            void refetch()
        }
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void refetch()
            }
        }
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisibilityChange)
        return () => {
            window.removeEventListener('focus', onFocus)
            document.removeEventListener('visibilitychange', onVisibilityChange)
        }
    }, [apiAvailable, enabled, refetch])

    return {
        settings,
        isLoading,
        error,
        refetch,
    }
}
