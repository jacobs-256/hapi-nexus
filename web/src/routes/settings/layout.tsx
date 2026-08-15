import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { useTranslation } from '@/lib/use-translation'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { SettingsNav } from '@/components/settings/SettingsNav'
import { getSettingsCategory } from './categories'

function BackIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
        </svg>
    )
}

export default function SettingsLayout() {
    const { t } = useTranslation()
    const goBack = useAppGoBack()
    const navigate = useNavigate()
    const pathname = useLocation({ select: (location) => location.pathname })
    const category = getSettingsCategory(pathname)
    const mobileTitleKey = pathname === '/settings/voice/voices'
        ? 'settings.voice.voice'
        : pathname === '/settings/voice/advanced'
            ? 'settings.voice.advanced.title'
            : category?.titleKey ?? 'settings.title'
    const mobileTitle = t(mobileTitleKey)

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--app-bg)]">
            <header className="shrink-0 border-b border-[var(--app-border)] bg-[var(--app-dialog-bg)] pt-[var(--app-page-safe-area-top)]">
                <div className="flex w-full items-center gap-3 px-3 py-3 sm:px-5 lg:px-6">
                    <button type="button" onClick={goBack} aria-label={t('common.back')} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] lg:hidden">
                        <BackIcon />
                    </button>
                    <button type="button" onClick={() => navigate({ to: '/sessions' })} aria-label={t('common.back')} className="hidden h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] lg:flex">
                        <BackIcon />
                    </button>
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-lg font-semibold text-[var(--app-fg)] lg:hidden">{mobileTitle}</h1>
                        <div className="hidden min-w-0 lg:block">
                            <div className="text-base font-semibold text-[var(--app-fg)]">{t('settings.title')}</div>
                            <div className="text-xs text-[var(--app-hint)]">{t('settings.hub.description')}</div>
                        </div>
                    </div>
                </div>
            </header>

            <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--app-bg)]">
                <aside className="absolute bottom-4 left-4 top-4 z-20 hidden w-72 lg:block xl:bottom-5 xl:left-6 xl:top-5">
                    <div className="app-scroll-y h-full rounded-2xl border border-[var(--app-border)] bg-[var(--app-dialog-bg)]/95 shadow-xl shadow-black/10 backdrop-blur">
                        <SettingsNav activeId={category?.id ?? 'display'} />
                    </div>
                </aside>
                <main className="app-scroll-y h-full min-w-0 bg-[var(--app-bg)] lg:py-4 lg:pl-[20rem] lg:pr-4 lg:[scrollbar-gutter:stable_both-edges] xl:py-5 xl:pl-[21rem] xl:pr-6">
                    <Outlet />
                </main>
            </div>
        </div>
    )
}
