import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import type { ApiClient } from '@/api/client'
import type { SlashCommand } from '@/types/api'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { queryKeys } from '@/lib/query-keys'
import { getBuiltinSlashCommands, mergeSlashCommands } from '@/lib/codexSlashCommands'
import { useTranslation } from '@/lib/use-translation'

type Translate = (key: string, params?: Record<string, string | number>) => string
const LOCALIZED_BUILTIN_SLASH_COMMAND_AGENTS = new Set(['claude', 'codex', 'gemini', 'grok', 'opencode', 'cursor'])

function levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length
    if (b.length === 0) return a.length
    const matrix: number[][] = []
    for (let i = 0; i <= b.length; i++) matrix[i] = [i]
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            matrix[i][j] = b[i - 1] === a[j - 1]
                ? matrix[i - 1][j - 1]
                : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        }
    }
    return matrix[b.length][a.length]
}

export function getLocalizedSlashCommandDescription(
    command: Pick<SlashCommand, 'name' | 'description' | 'source' | 'pluginName'>,
    agentType: string,
    t: Translate
): string | undefined {
    if (command.source === 'builtin') {
        const normalizedAgent = agentType.toLowerCase()
        const agentKey = LOCALIZED_BUILTIN_SLASH_COMMAND_AGENTS.has(normalizedAgent)
            ? normalizedAgent
            : 'claude'
        const key = `slashCommands.${agentKey}.${command.name.toLowerCase()}.description`
        const localizedDescription = t(key)
        if (localizedDescription !== key) {
            return localizedDescription
        }

        return command.description
    }

    const generatedPluginDescription = command.source === 'plugin' && command.pluginName
        ? `${command.pluginName} command`
        : null

    if (
        command.description
        && command.description !== 'Custom command'
        && command.description !== generatedPluginDescription
    ) {
        return command.description
    }

    if (command.source === 'plugin' && command.pluginName) {
        return t('slashCommands.plugin.description', { pluginName: command.pluginName })
    }

    return t('slashCommands.custom.description')
}

export function useSlashCommands(
    api: ApiClient | null,
    sessionId: string | null,
    agentType: string = 'claude'
): {
    commands: SlashCommand[]
    isLoading: boolean
    error: string | null
    getSuggestions: (query: string) => Promise<Suggestion[]>
} {
    const { t } = useTranslation()
    const resolvedSessionId = sessionId ?? 'unknown'

    // Fetch user-defined commands from the CLI (requires active session)
    const query = useQuery({
        queryKey: queryKeys.slashCommands(resolvedSessionId),
        queryFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            return await api.getSlashCommands(sessionId)
        },
        enabled: Boolean(api && sessionId),
        staleTime: Infinity,
        gcTime: 30 * 60 * 1000,
        retry: false, // Don't retry RPC failures
    })

    // Merge local built-ins with commands discovered by the active CLI.
    // The CLI can expose agent-specific built-ins plus user/plugin/project commands;
    // keep local built-ins as an offline fallback, then append/override from RPC.
    const commands = useMemo(() => {
        const builtin = getBuiltinSlashCommands(agentType)
        const mergedCommands = query.data?.success && query.data.commands
            ? mergeSlashCommands([...builtin, ...query.data.commands])
            : builtin

        return mergedCommands.map(command => {
            const description = getLocalizedSlashCommandDescription(command, agentType, t)
            return description === command.description
                ? command
                : { ...command, description }
        })
    }, [agentType, query.data, t])

    const getSuggestions = useCallback(async (queryText: string): Promise<Suggestion[]> => {
        const searchTerm = queryText.startsWith('/')
            ? queryText.slice(1).toLowerCase()
            : queryText.toLowerCase()

        if (!searchTerm) {
            return commands.map(cmd => ({
                key: `/${cmd.name}`,
                text: `/${cmd.name}`,
                label: `/${cmd.name}`,
                description: cmd.description,
                content: cmd.content,
                source: cmd.source
            }))
        }

        const maxDistance = Math.max(2, Math.floor(searchTerm.length / 2))
        return commands
            .map(cmd => {
                const name = cmd.name.toLowerCase()
                let score: number
                if (name === searchTerm) score = 0
                else if (name.startsWith(searchTerm)) score = 1
                else if (name.includes(searchTerm)) score = 2
                else {
                    const dist = levenshteinDistance(searchTerm, name)
                    score = dist <= maxDistance ? 3 + dist : Infinity
                }
                return { cmd, score }
            })
            .filter(item => item.score < Infinity)
            .sort((a, b) => a.score - b.score)
            .map(({ cmd }) => ({
                key: `/${cmd.name}`,
                text: `/${cmd.name}`,
                label: `/${cmd.name}`,
                description: cmd.description,
                content: cmd.content,
                source: cmd.source
            }))
    }, [commands])

    return {
        commands,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load commands' : null,
        getSuggestions,
    }
}
