import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useMachines(
    api: ApiClient | null,
    enabled: boolean,
    options: { includeOffline?: boolean } = {}
): {
    machines: Machine[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const includeOffline = options.includeOffline === true
    const query = useQuery({
        queryKey: includeOffline ? queryKeys.machinesAll : queryKeys.machines,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getMachines({ includeOffline })
        },
        enabled: Boolean(api && enabled),
    })

    return {
        machines: query.data?.machines ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load machines' : null,
        refetch: query.refetch,
    }
}
