import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { CodexModelSummary } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useCodexModels(args: {
    api: ApiClient | null
    machineId?: string | null
    sessionId?: string | null
    projectId?: string | null
    enabled?: boolean
}): {
    models: CodexModelSummary[]
    isLoading: boolean
    error: string | null
} {
    const { api, machineId, sessionId, projectId } = args
    const enabled = Boolean(args.enabled && api && machineId)
    const queryKey = queryKeys.machineCodexModels(machineId ?? 'unknown', { sessionId, projectId })

    const query = useQuery({
        queryKey,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (machineId) {
                return await api.getMachineCodexModels(machineId, { sessionId, projectId })
            }
            throw new Error('Codex models target unavailable')
        },
        enabled,
        staleTime: 30_000,
        retry: false,
    })

    return {
        models: query.data?.models ?? [],
        isLoading: query.isLoading,
        error: query.data?.success === false
            ? (query.data.error ?? 'Failed to load Codex models')
            : query.error instanceof Error
                ? query.error.message
                : query.error
                    ? 'Failed to load Codex models'
                    : null,
    }
}
