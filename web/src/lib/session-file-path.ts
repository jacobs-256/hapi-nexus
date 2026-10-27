import type { ApiClient } from '@/api/client'

/** A markdown citation containing only a filename needs workspace lookup. */
export function isBareSessionFileName(path: string): boolean {
    return path.length > 0
        && !path.includes('/')
        && !path.includes('\\')
        && !/^[A-Za-z]:/.test(path)
}

/**
 * Resolve a bare filename to its workspace-relative path when there is exactly
 * one matching file. Ambiguous or unavailable searches return null, so callers
 * can show the matching files instead of sending a filename that cannot be
 * resolved to the file RPC (which would otherwise produce a 404).
 */
export async function resolveSessionFilePath(
    api: ApiClient,
    sessionId: string,
    path: string
): Promise<string | null> {
    if (!isBareSessionFileName(path)) {
        return path
    }

    try {
        const result = await api.searchSessionFiles(sessionId, path, 200)
        if (!result.success) {
            return null
        }

        const matches = (result.files ?? []).filter((file) => file.fileName === path)
        return matches.length === 1 ? matches[0]!.fullPath : null
    } catch {
        return null
    }
}
