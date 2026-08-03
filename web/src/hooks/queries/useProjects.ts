import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { ProjectWithDetails } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useProjects(api: ApiClient | null, enabled: boolean = true): {
    projects: ProjectWithDetails[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: queryKeys.projects,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getProjects()
        },
        enabled: Boolean(api && enabled),
    })

    return {
        projects: query.data?.projects ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load projects' : null,
        refetch: query.refetch,
    }
}
