import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { useSessionDirectory } from './useSessionDirectory'

const clients: QueryClient[] = []

afterEach(() => {
    cleanup()
    for (const client of clients) client.clear()
    clients.length = 0
})

function createHarness() {
    const client = new QueryClient({
        defaultOptions: {
            queries: { staleTime: 5_000, retry: 1, retryDelay: 0 },
        },
    })
    clients.push(client)
    const listSessionDirectory = vi.fn<ApiClient['listSessionDirectory']>()
    const api = { listSessionDirectory } as unknown as ApiClient
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    return { api, listSessionDirectory, wrapper }
}

describe('useSessionDirectory recovery', () => {
    const failure = {
        success: false,
        error: 'RPC handler not registered: session-1:listDirectory',
    }
    const entries = [{ name: 'src', type: 'directory' as const }]

    it('retries a missing RPC handler and displays the directory when the CLI connects', async () => {
        const { api, listSessionDirectory, wrapper } = createHarness()
        listSessionDirectory
            .mockResolvedValueOnce(failure)
            .mockResolvedValueOnce({ success: true, entries })

        const { result } = renderHook(() => useSessionDirectory(api, 'session-1', ''), { wrapper })

        await waitFor(() => expect(result.current.entries).toEqual(entries))
        expect(result.current.error).toBeNull()
        expect(listSessionDirectory).toHaveBeenCalledTimes(2)
    })

    it('reloads a failed directory on remount even within the cache freshness window', async () => {
        const { api, listSessionDirectory, wrapper } = createHarness()
        listSessionDirectory
            .mockResolvedValueOnce(failure)
            .mockResolvedValueOnce(failure)
            .mockResolvedValueOnce({ success: true, entries })

        const first = renderHook(() => useSessionDirectory(api, 'session-1', ''), { wrapper })
        await waitFor(() => expect(first.result.current.error).toBe(failure.error))
        expect(listSessionDirectory).toHaveBeenCalledTimes(2)
        first.unmount()

        const reopened = renderHook(() => useSessionDirectory(api, 'session-1', ''), { wrapper })
        await waitFor(() => expect(reopened.result.current.entries).toEqual(entries))
        expect(reopened.result.current.error).toBeNull()
        expect(listSessionDirectory).toHaveBeenCalledTimes(3)
    })
})
