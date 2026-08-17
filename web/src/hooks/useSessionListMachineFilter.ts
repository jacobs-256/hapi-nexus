import { useCallback, useEffect, useState } from 'react'

// Empty array = "All machines" (no filtering). Items are machine ids, or
// UNKNOWN_MACHINE_ID ('__unknown__') for sessions without machine metadata.
export type SessionListMachineFilter = string[]

export const DEFAULT_SESSION_LIST_MACHINE_FILTER: SessionListMachineFilter = []

function getSessionListMachineFilterStorageKey(): string {
    return 'hapi-session-list-machine-filter'
}

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function safeGetItem(key: string): string | null {
    if (!isBrowser()) {
        return null
    }
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeSetItem(key: string, value: string): void {
    if (!isBrowser()) {
        return
    }
    try {
        localStorage.setItem(key, value)
    } catch {
        // Ignore storage errors
    }
}

function safeRemoveItem(key: string): void {
    if (!isBrowser()) {
        return
    }
    try {
        localStorage.removeItem(key)
    } catch {
        // Ignore storage errors
    }
}

function parseSessionListMachineFilter(raw: string | null): SessionListMachineFilter {
    const trimmed = raw?.trim() ?? ''
    if (!trimmed) return DEFAULT_SESSION_LIST_MACHINE_FILTER
    try {
        const parsed = JSON.parse(trimmed) as unknown
        if (Array.isArray(parsed)) {
            return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        }
    } catch {
        // Backward compatibility: old versions stored a single raw machine id.
    }
    return [trimmed]
}

export function getInitialSessionListMachineFilter(): SessionListMachineFilter {
    return parseSessionListMachineFilter(safeGetItem(getSessionListMachineFilterStorageKey()))
}

export function useSessionListMachineFilter(): {
    machineFilter: SessionListMachineFilter
    setMachineFilter: (filter: SessionListMachineFilter) => void
} {
    const [machineFilter, setMachineFilterState] = useState<SessionListMachineFilter>(getInitialSessionListMachineFilter)

    useEffect(() => {
        if (!isBrowser()) {
            return
        }

        const onStorage = (event: StorageEvent) => {
            if (event.key !== getSessionListMachineFilterStorageKey()) {
                return
            }
            setMachineFilterState(parseSessionListMachineFilter(event.newValue))
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setMachineFilter = useCallback((filter: SessionListMachineFilter) => {
        setMachineFilterState(filter)

        if (filter.length === 0) {
            safeRemoveItem(getSessionListMachineFilterStorageKey())
        } else {
            safeSetItem(getSessionListMachineFilterStorageKey(), JSON.stringify(filter))
        }
    }, [])

    return { machineFilter, setMachineFilter }
}
