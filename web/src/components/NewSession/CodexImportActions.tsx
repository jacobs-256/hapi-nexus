import type { CodexLocalSessionSummary } from '@/types/api'
import { useTranslation } from '@/lib/use-translation'

export function CodexImportActions(props: {
    selectedSession: CodexLocalSessionSummary | null
    isLoading: boolean
    isSyncingFolder: boolean
    canSyncFolder: boolean
    isDisabled: boolean
    error: string | null
    onChooseHistory: () => void
    onSyncFolder: () => void
    onClear: () => void
}) {
    const { t } = useTranslation()

    return (
        <div className="flex flex-col gap-2 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="text-xs font-medium text-[var(--app-hint)]">{t('codexSync.newSessionInline.title')}</div>
                    <div className="truncate text-[11px] text-[var(--app-hint)]">
                        {props.selectedSession ? props.selectedSession.title : t('codexSync.newSessionInline.description')}
                    </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {props.selectedSession ? (
                        <button type="button" className="text-xs text-[var(--app-link)]" onClick={props.onClear} disabled={props.isDisabled}>
                            {t('codexSync.newSessionInline.clear')}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2 py-1.5 text-xs text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] disabled:opacity-50"
                        onClick={props.onChooseHistory}
                        disabled={props.isDisabled || props.isLoading || props.isSyncingFolder}
                    >
                        {props.isLoading ? t('codexSync.confirm.loading') : t('codexSync.newSessionInline.choose')}
                    </button>
                    <button
                        type="button"
                        className="rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2 py-1.5 text-xs text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] disabled:opacity-50"
                        onClick={props.onSyncFolder}
                        disabled={props.isDisabled || props.isLoading || props.isSyncingFolder || !props.canSyncFolder}
                    >
                        {props.isSyncingFolder ? t('codexSync.folder.syncing') : t('codexSync.folder.sync')}
                    </button>
                </div>
            </div>
            {props.error ? <div className="text-xs text-red-600">{props.error}</div> : null}
        </div>
    )
}
