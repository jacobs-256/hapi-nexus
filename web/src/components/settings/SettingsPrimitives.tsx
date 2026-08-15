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

export function SettingsPageContent(props: { title?: string; description?: string; actions?: ReactNode; children: ReactNode }) {
    return (
        <div className="w-full px-3 py-4 sm:px-5 lg:p-0">
            {(props.title || props.description || props.actions) ? (
                <div className="mb-6 flex min-w-0 flex-col gap-3 border-b border-[var(--app-divider)] pb-5 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0">
                        {props.title ? (
                            <h1 className="truncate text-2xl font-semibold tracking-normal text-[var(--app-fg)]">
                                {props.title}
                            </h1>
                        ) : null}
                        {props.description ? (
                            <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--app-hint)]">
                                {props.description}
                            </p>
                        ) : null}
                    </div>
                    {props.actions ? <div className="shrink-0">{props.actions}</div> : null}
                </div>
            ) : null}
            <div className="space-y-6">
                {props.children}
            </div>
        </div>
    )
}

export function SettingsSection(props: { title?: string; description?: string; children: ReactNode }) {
    return (
        <section className="min-w-0">
            {(props.title || props.description) ? (
                <div className="mb-3 grid gap-1 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] sm:gap-6">
                    {props.title ? <h2 className="text-base font-semibold text-[var(--app-fg)]">{props.title}</h2> : <div />}
                    {props.description ? <p className="text-sm leading-6 text-[var(--app-hint)]">{props.description}</p> : null}
                </div>
            ) : null}
            <div className="overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-dialog-bg)] divide-y divide-[var(--app-divider)]">
                {props.children}
            </div>
        </section>
    )
}

export function SettingsRow(props: { label: string; description?: string; trailing?: ReactNode; children?: ReactNode }) {
    return (
        <div className="grid min-h-14 gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,auto)] sm:items-center sm:gap-6">
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
    columns?: 2 | 4 | 5
}) {
    const columns = props.columns === 5 ? 'grid-cols-5' : props.columns === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'
    return (
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] sm:gap-6">
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
                            className={`min-w-0 rounded-md border px-2.5 py-2 text-center text-sm transition-colors ${selected
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
        <button type="button" onClick={props.onClick} className="grid min-h-14 w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)] sm:grid-cols-[minmax(0,1fr)_minmax(180px,auto)_auto] sm:items-center sm:gap-6">
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--app-fg)]">{props.label}</span>
                {props.description ? <span className="mt-0.5 block text-xs text-[var(--app-hint)]">{props.description}</span> : null}
            </span>
            {props.value ? <span className="min-w-0 truncate text-sm text-[var(--app-hint)] sm:text-right">{props.value}</span> : <span className="hidden sm:block" />}
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-[var(--app-hint)]" />
        </button>
    )
}
