import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { isBareSessionFileName, resolveSessionFilePath } from './session-file-path'

describe('session file path resolution', () => {
    it.each(['DatabaseConnectionPanel.tsx', 'README.md'])('recognizes bare filename %s', (path) => {
        expect(isBareSessionFileName(path)).toBe(true)
    })

    it.each(['frontend/DatabaseConnectionPanel.tsx', './README.md', 'C:\\work\\README.md'])('keeps qualified path %s', (path) => {
        expect(isBareSessionFileName(path)).toBe(false)
    })

    it('resolves a unique filename from the session workspace', async () => {
        const api = {
            searchSessionFiles: vi.fn().mockResolvedValue({
                success: true,
                files: [
                    { fileName: 'DatabaseConnectionPanel.tsx', fullPath: 'frontend/src/features/database/DatabaseConnectionPanel.tsx' },
                    { fileName: 'Other.tsx', fullPath: 'frontend/src/Other.tsx' },
                ],
            }),
        } as unknown as ApiClient

        await expect(resolveSessionFilePath(api, 'session-1', 'DatabaseConnectionPanel.tsx'))
            .resolves.toBe('frontend/src/features/database/DatabaseConnectionPanel.tsx')
        expect(api.searchSessionFiles).toHaveBeenCalledWith('session-1', 'DatabaseConnectionPanel.tsx', 200)
    })

    it('keeps ambiguous and failed lookups unchanged', async () => {
        const ambiguous = {
            searchSessionFiles: vi.fn().mockResolvedValue({
                success: true,
                files: [
                    { fileName: 'README.md', fullPath: 'README.md' },
                    { fileName: 'README.md', fullPath: 'docs/README.md' },
                ],
            }),
        } as unknown as ApiClient
        const failed = {
            searchSessionFiles: vi.fn().mockRejectedValue(new Error('offline')),
        } as unknown as ApiClient

        await expect(resolveSessionFilePath(ambiguous, 'session-1', 'README.md')).resolves.toBe('README.md')
        await expect(resolveSessionFilePath(failed, 'session-1', 'README.md')).resolves.toBe('README.md')
    })
})
