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
 * one matching file. Ambiguous or unavailable searches keep the original path,
 * so we never open a different file silently.
 */
export async function resolveSessionFilePath(
    api: ApiClient,
    sessionId: string,
    path: string
): Promise<string> {
    if (!isBareSessionFileName(path)) {
        return path
    }

    try {
        const result = await api.searchSessionFiles(sessionId, path, 200)
        if (!result.success) {
            return path
        }

        const matches = (result.files ?? []).filter((file) => file.fileName === path)
        return matches.length === 1 ? matches[0]!.fullPath : path
    } catch {
        return path
    }
}
