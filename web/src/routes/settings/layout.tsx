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
        <div className="flex h-full min-h-0 flex-col bg-[var(--app-bg)]">
            <header className="shrink-0 border-b border-[var(--app-border)] bg-[var(--app-dialog-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto flex w-full max-w-[1440px] items-center gap-3 px-3 py-3 sm:px-5 lg:px-6">
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

            <div className="min-h-0 flex-1 bg-[var(--app-bg)]">
                <div className="mx-auto flex h-full w-full max-w-[1440px] min-h-0">
                    <aside className="hidden w-72 shrink-0 border-r border-[var(--app-border)] bg-[var(--app-bg)] lg:block">
                        <SettingsNav activeId={category?.id ?? 'display'} />
                    </aside>
                    <main className="app-scroll-y min-w-0 flex-1 bg-[var(--app-bg)] lg:[scrollbar-gutter:stable_both-edges]">
                        <Outlet />
                    </main>
                </div>
            </div>
        </div>
    )
}
