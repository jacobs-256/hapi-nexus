import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { ConversationOutlineItem } from '@/chat/outline'

const OUTLINE_PAGE_SIZE = 50

type OutlineState = {
    items: ConversationOutlineItem[]
    hasMore: boolean
    nextBeforeSeq: number | null
    nextBeforeAt: number | null
    isLoading: boolean
    error: string | null
}

const EMPTY_STATE: OutlineState = {
    items: [],
    hasMore: false,
    nextBeforeSeq: null,
    nextBeforeAt: null,
    isLoading: false,
    error: null
}

export function useConversationOutline(
    api: ApiClient | null,
    sessionId: string | null,
    enabled: boolean
): OutlineState & { loadMore: () => Promise<void> } {
    const [state, setState] = useState<OutlineState>(EMPTY_STATE)
    const requestIdRef = useRef(0)
    const loadingRef = useRef(false)

    useEffect(() => {
        if (!enabled || !api || !sessionId) {
            return
        }

        const requestId = ++requestIdRef.current
        loadingRef.current = true
        setState({ ...EMPTY_STATE, isLoading: true })
        void api.getConversationOutline(sessionId, { limit: OUTLINE_PAGE_SIZE })
            .then((response) => {
                if (requestId !== requestIdRef.current) return
                setState({
                    items: response.items,
                    hasMore: response.page.hasMore,
                    nextBeforeSeq: response.page.nextBeforeSeq,
                    nextBeforeAt: response.page.nextBeforeAt,
                    isLoading: false,
                    error: null
                })
            })
            .catch((error: unknown) => {
                if (requestId !== requestIdRef.current) return
                setState({ ...EMPTY_STATE, isLoading: false, error: error instanceof Error ? error.message : 'Failed to load outline' })
            })
            .finally(() => {
                if (requestId === requestIdRef.current) {
                    loadingRef.current = false
                }
            })

        return () => {
            requestIdRef.current += 1
            loadingRef.current = false
        }
    }, [api, enabled, sessionId])

    const loadMore = useCallback(async () => {
        if (!api || !sessionId || loadingRef.current || !state.hasMore) return
        const beforeAt = state.nextBeforeAt
        const beforeSeq = state.nextBeforeSeq
        if (beforeAt === null || beforeSeq === null) return

        loadingRef.current = true
        setState((current) => ({ ...current, isLoading: true, error: null }))
        try {
            const response = await api.getConversationOutline(sessionId, {
                limit: OUTLINE_PAGE_SIZE,
                beforeAt,
                beforeSeq
            })
            setState((current) => {
                const existingIds = new Set(current.items.map((item) => item.id))
                const appended = response.items.filter((item) => !existingIds.has(item.id))
                return {
                    items: [...current.items, ...appended],
                    hasMore: response.page.hasMore,
                    nextBeforeSeq: response.page.nextBeforeSeq,
                    nextBeforeAt: response.page.nextBeforeAt,
                    isLoading: false,
                    error: null
                }
            })
        } catch (error: unknown) {
            setState((current) => ({
                ...current,
                isLoading: false,
                error: error instanceof Error ? error.message : 'Failed to load outline'
            }))
        } finally {
            loadingRef.current = false
        }
    }, [api, sessionId, state.hasMore, state.nextBeforeAt, state.nextBeforeSeq])

    return { ...state, loadMore }
}
