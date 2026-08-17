import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from '@/lib/use-translation'
import { useAppearance } from '@/hooks/useTheme'
import { useFontScale } from '@/hooks/useFontScale'
import { useComposerEnterBehavior } from '@/hooks/useComposerEnterBehavior'
import { useAppContext } from '@/lib/app-context'
import { getVisibleSettingsCategories, settingsCategoryGroups, type SettingsCategoryId } from '@/routes/settings/categories'
import { ChevronRightIcon } from './SettingsPrimitives'

function CategoryIcon(props: { id: SettingsCategoryId; active: boolean }) {
    const common = 'h-4 w-4'
    const stroke = props.active ? '2.2' : '1.8'
    switch (props.id) {
        case 'general':
            return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} className={common} aria-hidden="true"><path d="M12 3v18M5 8h14M7 16h10" /></svg>
        case 'display':
            return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} className={common} aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="2" /><path d="M9 20h6M12 16v4" /></svg>
        case 'chat':
            return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} className={common} aria-hidden="true"><path d="M5 6h14v9H8l-3 3V6Z" /></svg>
        case 'voice':
            return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} className={common} aria-hidden="true"><path d="M12 5v14M8 9v6M16 9v6M4 11v2M20 11v2" /></svg>
        case 'account':
            return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} className={common} aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
        case 'users':
            return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} className={common} aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
        case 'projects':
            return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} className={common} aria-hidden="true"><path d="M4 7h6l2 2h8v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" /></svg>
        case 'machines':
            return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} className={common} aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="2" /><path d="M8 20h8" /></svg>
        case 'storage':
            return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} className={common} aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" /></svg>
        case 'tasks':
            return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} className={common} aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11" /><path d="m4 6 1 1 2-2M4 12h3M4 18h3" /></svg>
        case 'about':
            return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} className={common} aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 11v5M12 8h.01" /></svg>
    }
}

export function SettingsNav(props: { activeId?: string; mobile?: boolean }) {
    const navigate = useNavigate()
    const { token, user } = useAppContext()
    const { t, locale } = useTranslation()
    const { appearance } = useAppearance()
    const { fontScale } = useFontScale()
    const { composerEnterBehavior } = useComposerEnterBehavior()

    const summaries: Record<string, string> = {
        general: locale === 'zh-CN' ? '简体中文' : 'English',
        display: `${t(`settings.display.appearance.${appearance}`)} · ${Math.round(fontScale * 100)}%`,
        chat: t(`settings.chat.enterBehavior.${composerEnterBehavior}`),
        voice: t('settings.hub.voice.summary'),
        account: t('settings.hub.account.summary'),
        users: t('settings.hub.users.summary'),
        projects: t('settings.hub.projects.summary'),
        machines: t('settings.hub.machines.summary'),
        storage: t('settings.storage.summary'),
        tasks: t('settings.tasks.summary'),
        about: `v${__APP_VERSION__}`,
    }
    const visibleCategories = getVisibleSettingsCategories({ token, user })
    const visibleById = new Map(visibleCategories.map((category) => [category.id, category]))

    return (
        <nav aria-label={t('settings.title')} className={props.mobile ? 'space-y-5 px-3 py-3' : 'space-y-5 p-4'}>
            {settingsCategoryGroups.map((group) => {
                const items = group.categoryIds
                    .map((id) => visibleById.get(id))
                    .filter((category): category is NonNullable<typeof category> => Boolean(category))
                if (items.length === 0) return null
                return (
                    <section key={group.id} aria-label={t(group.titleKey)}>
                        <div className={props.mobile
                            ? 'mb-2 px-1 text-[11px] font-semibold uppercase text-[var(--app-hint)]'
                            : 'mb-2 px-2 text-[11px] font-semibold uppercase text-[var(--app-hint)]'}
                        >
                            {t(group.titleKey)}
                        </div>
                        <div className={props.mobile ? 'overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-dialog-bg)] divide-y divide-[var(--app-divider)]' : 'space-y-1'}>
                            {items.map((category) => {
                                const active = props.activeId === category.id
                                return (
                                    <button
                                        key={category.id}
                                        type="button"
                                        onClick={() => navigate({ to: category.path })}
                                        aria-current={active ? 'page' : undefined}
                                        className={props.mobile
                                            ? 'grid min-h-16 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)]'
                                            : `grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md px-2.5 py-2.5 text-left transition-colors ${active ? 'bg-[var(--app-subtle-bg)] text-[var(--app-link)]' : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'}`}
                                    >
                                        <span className={`flex h-8 w-8 items-center justify-center rounded-md ${active ? 'bg-[var(--app-bg)] text-[var(--app-link)]' : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'}`}>
                                            <CategoryIcon id={category.id} active={active} />
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block text-sm font-semibold">{t(category.titleKey)}</span>
                                            <span className="mt-0.5 block truncate text-xs text-[var(--app-hint)]">{summaries[category.id]}</span>
                                        </span>
                                        {props.mobile ? <ChevronRightIcon className="h-4 w-4 text-[var(--app-hint)]" /> : null}
                                    </button>
                                )
                            })}
                        </div>
                    </section>
                )
            })}
        </nav>
    )
}
