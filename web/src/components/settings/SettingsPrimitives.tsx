import type { ReactNode } from 'react'

export function SettingsFieldLabel(props: { children: ReactNode; hidden?: boolean; description?: string }) {
    if (props.hidden) return null
    if (!props.description) return <div className="mb-2 text-sm font-semibold text-[var(--app-fg)]">{props.children}</div>
    return (
        <div className="mb-2">
            <div className="text-sm font-semibold text-[var(--app-fg)]">{props.children}</div>
            <div className="mt-0.5 text-xs leading-snug text-[var(--app-hint)]">{props.description}</div>
        </div>
    )
}

export function ChevronRightIcon(props: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className} aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
        </svg>
    )
}

export function CheckIcon(props: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={props.className} aria-hidden="true">
            <path d="m20 6-11 11-5-5" />
        </svg>
    )
}

export function SettingsPageContent(props: {
    title?: string
    description?: string
    actions?: ReactNode
    className?: string
    contentClassName?: string
    children: ReactNode
}) {
    return (
        <div className={`settings-page-content mx-auto w-full max-w-[1120px] px-3 py-4 pb-8 sm:px-5 lg:px-0 lg:py-1 xl:max-w-[1180px] ${props.className ?? ''}`}>
            {(props.title || props.description || props.actions) ? (
                <div className="mb-5 flex min-w-0 flex-col gap-4 border-b border-[var(--app-divider)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        {props.title ? (
                            <h1 className="truncate text-[1.65rem] font-semibold leading-8 tracking-[-0.02em] text-[var(--app-fg)]">
                                {props.title}
                            </h1>
                        ) : null}
                        {props.description ? (
                            <p className="mt-1 max-w-2xl text-sm leading-5 text-[var(--app-hint)]">
                                {props.description}
                            </p>
                        ) : null}
                    </div>
                    {props.actions ? <div className="flex shrink-0 items-center gap-2">{props.actions}</div> : null}
                </div>
            ) : null}
            <div className={`space-y-5 ${props.contentClassName ?? ''}`}>
                {props.children}
            </div>
        </div>
    )
}

export function SettingsSection(props: { title?: string; description?: string; className?: string; cardClassName?: string; children: ReactNode }) {
    return (
        <section className={`settings-section min-w-0 ${props.className ?? ''}`}>
            {(props.title || props.description) ? (
                <div className="mb-2.5 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                    {props.title ? <h2 className="text-[0.95rem] font-semibold leading-5 text-[var(--app-fg)]">{props.title}</h2> : <div />}
                    {props.description ? <p className="max-w-2xl text-xs leading-5 text-[var(--app-hint)] sm:text-right">{props.description}</p> : null}
                </div>
            ) : null}
            <div className={`settings-section-card overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-dialog-bg)] shadow-[0_1px_2px_rgb(15_23_42/0.03)] divide-y divide-[var(--app-divider)] ${props.cardClassName ?? ''}`}>
                {props.children}
            </div>
        </section>
    )
}

export function SettingsRow(props: { label: string; description?: string; trailing?: ReactNode; children?: ReactNode }) {
    return (
        <div className="grid min-h-16 gap-3 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(220px,auto)] sm:items-center sm:gap-8">
            <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--app-fg)]">{props.label}</div>
                {props.description ? <div className="mt-0.5 text-xs leading-snug text-[var(--app-hint)]">{props.description}</div> : null}
                {props.children}
            </div>
            {props.trailing ? <div className="min-w-0 sm:justify-self-end">{props.trailing}</div> : null}
        </div>
    )
}

export function SettingsSwitch(props: { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <SettingsRow label={props.label} description={props.description} trailing={
            <label className="relative inline-flex h-6 w-11 items-center">
                <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} className="peer sr-only" aria-label={props.label} />
                <span className="absolute inset-0 rounded-full bg-[var(--app-border)] transition-colors peer-checked:bg-[var(--app-link)]" />
                <span className="absolute left-0.5 h-5 w-5 rounded-full bg-[var(--app-bg)] shadow-sm transition-transform peer-checked:translate-x-5" />
            </label>
        } />
    )
}

export function SettingsChoiceGroup<T extends string | number>(props: {
    label: string
    description?: string
    hideLabel?: boolean
    value: T
    options: ReadonlyArray<{ value: T; label: string; description?: string }>
    onChange: (value: T) => void
    columns?: 2 | 3 | 4 | 5
}) {
    const columns = props.columns === 5 ? 'grid-cols-5' : props.columns === 4 ? 'grid-cols-2 sm:grid-cols-4' : props.columns === 3 ? 'grid-cols-3' : 'grid-cols-2'
    return (
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] sm:gap-8">
            <SettingsFieldLabel hidden={props.hideLabel} description={props.description}>{props.label}</SettingsFieldLabel>
            <div role="radiogroup" aria-label={props.label} className={`grid ${columns} gap-2 ${props.hideLabel ? 'sm:col-span-2' : ''}`}>
                {props.options.map((option) => {
                    const selected = props.value === option.value
                    return (
                        <button
                            key={String(option.value)}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => props.onChange(option.value)}
                            className={`min-w-0 rounded-lg border px-3 py-2.5 text-center text-sm transition-colors ${selected
                                ? 'border-[var(--app-link)] bg-[var(--app-subtle-bg)] text-[var(--app-link)]'
                                : 'border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'}`}
                        >
                            <span className="block truncate font-medium">{option.label}</span>
                            {option.description ? <span className="mt-0.5 block text-xs text-[var(--app-hint)]">{option.description}</span> : null}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

export function SettingsLinkRow(props: { label: string; value?: string; description?: string; onClick: () => void }) {
    return (
        <button type="button" onClick={props.onClick} className="grid min-h-16 w-full gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[var(--app-subtle-bg)] sm:grid-cols-[minmax(0,1fr)_minmax(180px,auto)_auto] sm:items-center sm:gap-8">
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--app-fg)]">{props.label}</span>
                {props.description ? <span className="mt-0.5 block text-xs text-[var(--app-hint)]">{props.description}</span> : null}
            </span>
            {props.value ? <span className="min-w-0 truncate text-sm text-[var(--app-hint)] sm:text-right">{props.value}</span> : <span className="hidden sm:block" />}
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-[var(--app-hint)]" />
        </button>
    )
}
