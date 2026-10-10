import type { CSSProperties, ReactNode } from 'react'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { useTranslation } from '@/lib/use-translation'

export function SessionsWorkspace(props: {
    isIndex: boolean
    sidebar: ReactNode
    children: ReactNode
}) {
    const { t } = useTranslation()
    const sidebar = useSidebarResize()

    return (
        <div className="sessions-workspace flex h-full min-h-0 bg-[var(--app-bg)] split:p-2">
            <aside
                aria-label={t('sessions.title')}
                className={`sessions-sidebar ${props.isIndex ? 'flex' : 'hidden split:flex'} min-h-0 w-full shrink-0 flex-col bg-[var(--session-list-bg)] text-[var(--session-list-fg)] split:overflow-hidden split:rounded-2xl split:border split:border-[var(--app-border)] split:shadow-sm`}
                style={{ '--sidebar-w': `${sidebar.width}px` } as CSSProperties}
            >
                {props.sidebar}
            </aside>

            {/* Keep the sidebar immediately before the handle: resizing measures it. */}
            <div
                className="sidebar-resize-handle hidden shrink-0 split:block"
                data-dragging={sidebar.isDragging || undefined}
                onPointerDown={sidebar.onPointerDown}
            />

            <div className={`${props.isIndex ? 'hidden split:flex' : 'flex'} min-h-0 min-w-0 flex-1 flex-col bg-[var(--app-dialog-bg)] split:overflow-hidden split:rounded-2xl split:border split:border-[var(--app-border)] split:shadow-sm`}>
                <div className="min-h-0 flex-1">{props.children}</div>
            </div>
        </div>
    )
}

export function SessionWelcome(props: { onNewSession: () => void; onBrowse: () => void }) {
    const { t } = useTranslation()

    return (
        <div className="app-scroll-y flex h-full flex-col">
            <div className="my-auto px-6 py-12 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-hint)]">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7" aria-hidden="true">
                        <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
                        <path d="M9 9h7M9 13h4" />
                    </svg>
                </div>
                <h1 className="mt-6 text-2xl font-semibold tracking-tight text-[var(--app-fg)]">{t('sessions.welcome.title')}</h1>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[var(--app-hint)]">{t('sessions.welcome.description')}</p>
                <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                    <button type="button" onClick={props.onNewSession} className="rounded-lg bg-[var(--app-button)] px-4 py-2.5 text-sm font-medium text-[var(--app-button-text)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-dialog-bg)]">
                        {t('sessions.new')}
                    </button>
                    <button type="button" onClick={props.onBrowse} className="rounded-lg border border-[var(--app-border)] px-4 py-2.5 text-sm font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]">
                        {t('sessions.welcome.browse')}
                    </button>
                </div>
            </div>
        </div>
    )
}
