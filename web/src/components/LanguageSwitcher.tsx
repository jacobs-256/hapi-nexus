import { cn } from '@/lib/utils'
import { useTranslation, type Locale } from '@/lib/use-translation'

const locales: { value: Locale; label: string }[] = [
    { value: 'en', label: 'EN' },
    { value: 'zh-CN', label: 'ZH' },
]

export function LanguageSwitcher(props: {
    variant?: 'login' | 'toolbar'
    className?: string
}) {
    const { locale, setLocale, t } = useTranslation()
    const variant = props.variant ?? 'login'

    return (
        <div
            className={cn(
                'flex gap-0.5 rounded-lg p-0.5',
                variant === 'toolbar'
                    ? 'bg-[var(--secondary)]'
                    : 'border border-[var(--border)] bg-[var(--card)]',
                props.className
            )}
            role="radiogroup"
            aria-label={t('language.title')}
        >
            {locales.map((item) => {
                const selected = item.value === locale
                return (
                    <button
                        key={item.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setLocale(item.value)}
                        className={cn(
                            'rounded-md px-2.5 py-1 font-mono text-[11px] font-medium transition-all',
                            selected && variant === 'login'
                                ? 'bg-[var(--primary)] text-white'
                                : null,
                            selected && variant === 'toolbar'
                                ? 'bg-[var(--card)] text-[var(--foreground)] shadow-[0_1px_3px_rgba(0,0,0,0.15)]'
                                : null,
                            !selected
                                ? 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                                : null
                        )}
                    >
                        {item.label}
                    </button>
                )
            })}
        </div>
    )
}
