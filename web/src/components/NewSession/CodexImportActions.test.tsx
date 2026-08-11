// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CodexImportActions } from './CodexImportActions'

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

describe('CodexImportActions', () => {
    it('exposes Codex history picker and folder sync entry points', () => {
        const onChooseHistory = vi.fn()
        const onSyncFolder = vi.fn()

        render(
            <CodexImportActions
                selectedSession={null}
                isLoading={false}
                isSyncingFolder={false}
                canSyncFolder={true}
                isDisabled={false}
                error={null}
                onChooseHistory={onChooseHistory}
                onSyncFolder={onSyncFolder}
                onClear={vi.fn()}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'codexSync.newSessionInline.choose' }))
        fireEvent.click(screen.getByRole('button', { name: 'codexSync.folder.sync' }))

        expect(onChooseHistory).toHaveBeenCalledOnce()
        expect(onSyncFolder).toHaveBeenCalledOnce()
        expect(screen.getAllByRole('button')).toHaveLength(2)
    })

    it('disables Codex history actions while sessions are loading', () => {
        render(
            <CodexImportActions
                selectedSession={null}
                isLoading={true}
                isSyncingFolder={false}
                canSyncFolder={true}
                isDisabled={false}
                error={null}
                onChooseHistory={vi.fn()}
                onSyncFolder={vi.fn()}
                onClear={vi.fn()}
            />
        )

        expect(screen.getByRole('button', { name: 'codexSync.confirm.loading' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'codexSync.folder.sync' })).toBeDisabled()
    })
})
