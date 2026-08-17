import { useEffect, useId, useRef, useState } from 'react'
import type { MachineHealthPresentation } from '@/lib/machineHealth'
import { MachineHealthTooltipBody } from '@/components/MachineHealthIndicator'
import { HoverTooltip } from '@/components/HoverTooltip'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

export type MachineFilterItem = {
    id: string
    label: string
    sessionCount: number
    healthPresentation: MachineHealthPresentation | null
}

const chipBaseClass = 'flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors'
const chipSelectedClass = 'border-[var(--app-link)] bg-[var(--app-subtle-bg)] text-[var(--app-link)] font-medium'
const chipIdleClass = 'border-[var(--app-border)] text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'

function MachineFilterChip(props: {
    machine: MachineFilterItem
    selected: boolean
    onSelect: (id: string) => void
}) {
    const { machine, selected, onSelect } = props
    const tooltipId = useId()
    const hasHealth = machine.healthPresentation && machine.healthPresentation.metrics.length > 0

    // The button carries the pill's padding so the entire visible chip is
    // clickable; when a health popup wraps it, the wrapper only draws the border.
    const button = (
        <button
            type="button"
            onClick={() => onSelect(machine.id)}
            aria-pressed={selected}
            aria-describedby={hasHealth ? tooltipId : undefined}
            title={machine.label}
            className="flex h-7 min-w-0 items-center gap-1.5 rounded-full px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
        >
            <span className="max-w-32 truncate">{machine.label}</span>
            <span className="tabular-nums opacity-70">({machine.sessionCount})</span>
        </button>
    )

    if (!hasHealth) {
        return (
            <button
                type="button"
                onClick={() => onSelect(machine.id)}
                aria-pressed={selected}
                title={machine.label}
                className={cn(chipBaseClass, selected ? chipSelectedClass : chipIdleClass)}
            >
                <span className="max-w-32 truncate">{machine.label}</span>
                <span className="tabular-nums opacity-70">({machine.sessionCount})</span>
            </button>
        )
    }

    return (
        // CPU/RAM details live in a hover popup so the chip stays compact;
        // hidden below the md breakpoint (touch devices). The `before:` bridge
        // spans the mt-1 gap so the popup stays open while the pointer enters it.
        <HoverTooltip
            id={tooltipId}
            target={button}
            side="bottom"
            align="start"
            className={cn('shrink-0 rounded-full border transition-colors', selected ? chipSelectedClass : chipIdleClass)}
            tooltipClassName="pointer-events-auto before:absolute before:inset-x-0 before:-top-1 before:h-1 before:content-[''] px-3 py-2 min-w-[16rem] max-md:hidden"
        >
            <MachineHealthTooltipBody presentation={machine.healthPresentation!} />
        </HoverTooltip>
    )
}

export function MachineFilterBar(props: {
    machines: MachineFilterItem[]
    totalCount: number
    value: string | null
    onChange: (id: string | null) => void
}) {
    const { t } = useTranslation()
    return (
        <div
            role="group"
            aria-label={t('sessions.machineFilter.label')}
            className="flex flex-wrap items-center gap-1.5 px-2 pb-2"
        >
            <button
                type="button"
                onClick={() => props.onChange(null)}
                aria-pressed={props.value === null}
                className={cn(chipBaseClass, props.value === null ? chipSelectedClass : chipIdleClass)}
            >
                <span className="truncate">{t('sessions.machineFilter.all')}</span>
                <span className="tabular-nums opacity-70">({props.totalCount})</span>
            </button>
            {props.machines.map((machine) => (
                <MachineFilterChip
                    key={machine.id}
                    machine={machine}
                    selected={props.value === machine.id}
                    onSelect={props.onChange}
                />
            ))}
        </div>
    )
}


export type ProjectFilterItem = {
    id: string
    label: string
    sessionCount: number
}

export function MachineFilterDropdown(props: {
    machines: MachineFilterItem[]
    totalCount: number
    value: string[]
    onChange: (ids: string[]) => void
    projects?: ProjectFilterItem[]
    projectValue?: string | null
    onProjectChange?: (id: string | null) => void
    className?: string
}) {
    const { t } = useTranslation()
    const dropdownRef = useRef<HTMLDivElement | null>(null)
    const [open, setOpen] = useState(false)
    const selectedMachineIds = new Set(props.value)
    const selectedMachineLabels = props.machines
        .filter((machine) => selectedMachineIds.has(machine.id))
        .map((machine) => machine.label)
    const selectedProject = props.projects?.find((project) => project.id === props.projectValue)
    const machineSummary = selectedMachineLabels.length === 0
        ? t('sessions.machineFilter.all')
        : selectedMachineLabels.length === 1
            ? selectedMachineLabels[0]
            : t('sessions.machineFilter.selected', { n: selectedMachineLabels.length })
    const summary = selectedProject
        ? `${machineSummary} · ${selectedProject.label}`
        : machineSummary

    useEffect(() => {
        if (!open) return
        const onPointerDown = (event: PointerEvent) => {
            if (dropdownRef.current?.contains(event.target as Node)) return
            setOpen(false)
        }
        window.addEventListener('pointerdown', onPointerDown)
        return () => window.removeEventListener('pointerdown', onPointerDown)
    }, [open])

    const toggleMachine = (id: string) => {
        if (selectedMachineIds.has(id)) {
            props.onChange(props.value.filter((value) => value !== id))
        } else {
            props.onChange([...props.value, id])
        }
    }

    return (
        <div ref={dropdownRef} className={cn('relative min-w-0', props.className)}>
            <button
                type="button"
                aria-label={t('sessions.machineFilter.label')}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                className="flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-2.5 text-xs font-medium text-[var(--app-fg)] outline-none transition-colors hover:bg-[var(--app-subtle-bg)] focus:border-[var(--app-link)] focus:ring-2 focus:ring-[var(--app-link)]/20"
            >
                <span className="min-w-0 truncate">{summary}</span>
                <span className="shrink-0 text-[10px] text-[var(--app-hint)]">▾</span>
            </button>
            {open ? (
                <div
                    role="menu"
                    className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-auto rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-xs text-[var(--app-fg)] shadow-lg"
                >
                    <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                        {t('sessions.machineFilter.machines')}
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--app-subtle-bg)]">
                        <input
                            type="checkbox"
                            checked={props.value.length === 0}
                            onChange={() => props.onChange([])}
                        />
                        <span className="min-w-0 flex-1 truncate">{t('sessions.machineFilter.all')}</span>
                        <span className="tabular-nums text-[var(--app-hint)]">({props.totalCount})</span>
                    </label>
                    {props.machines.map((machine) => (
                        <label key={machine.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--app-subtle-bg)]">
                            <input
                                type="checkbox"
                                checked={selectedMachineIds.has(machine.id)}
                                onChange={() => toggleMachine(machine.id)}
                            />
                            <span className="min-w-0 flex-1 truncate">{machine.label}</span>
                            <span className="tabular-nums text-[var(--app-hint)]">({machine.sessionCount})</span>
                        </label>
                    ))}

                    {props.projects && props.projects.length > 0 && props.onProjectChange ? (
                        <>
                            <div className="my-2 border-t border-[var(--app-border)]" />
                            <label className="block px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                                {t('sessions.projectFilter.label')}
                            </label>
                            <select
                                aria-label={t('sessions.projectFilter.label')}
                                value={props.projectValue ?? ''}
                                onChange={(event) => props.onProjectChange?.(event.target.value ? event.target.value : null)}
                                className="h-8 w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-2 text-xs text-[var(--app-fg)] outline-none focus:border-[var(--app-link)]"
                            >
                                <option value="">{t('sessions.projectFilter.all')} ({props.totalCount})</option>
                                {props.projects.map((project) => (
                                    <option key={project.id} value={project.id}>{project.label} ({project.sessionCount})</option>
                                ))}
                            </select>
                        </>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}
