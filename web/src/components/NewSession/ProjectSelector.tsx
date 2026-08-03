import { useMemo } from 'react'
import type { Machine, ProjectRole, ProjectWithDetails } from '@/types/api'
import { useTranslation } from '@/lib/use-translation'

const EDITABLE_ROLES = new Set<ProjectRole>(['owner', 'admin', 'editor'])

export function isEditableProject(project: ProjectWithDetails): boolean {
    return EDITABLE_ROLES.has(project.role)
}

function isWindowsMachine(machine: Machine | null): boolean {
    return machine?.metadata?.platform === 'win32'
        || Boolean(machine?.metadata?.workspaceRoots?.some((root) => /^[a-zA-Z]:[\\/]/.test(root)))
}

function trimTrailingSeparators(value: string, windows: boolean): string {
    const minimumLength = windows && /^[a-zA-Z]:\\$/.test(value) ? 3 : 1
    let result = value
    while (result.length > minimumLength && /[\\/]$/.test(result)) {
        result = result.slice(0, -1)
    }
    return result
}

function normalizePathForCompare(value: string, windows: boolean): string {
    const trimmed = value.trim()
    if (!trimmed) return ''
    const separator = windows ? '\\' : '/'
    const converted = windows ? trimmed.replace(/\//g, '\\') : trimmed.replace(/\\/g, '/')
    const collapsed = converted.replace(windows ? /\\+/g : /\/+/g, separator)
    const stripped = trimTrailingSeparators(collapsed, windows)
    const prefix = windows && /^[a-zA-Z]:\\/.test(stripped)
        ? stripped.slice(0, 3)
        : stripped.startsWith(separator)
            ? separator
            : ''
    const rest = prefix ? stripped.slice(prefix.length) : stripped
    const segments: string[] = []
    for (const segment of rest.split(separator)) {
        if (!segment || segment === '.') {
            continue
        }
        if (segment === '..') {
            if (segments.length > 0 && segments[segments.length - 1] !== '..') {
                segments.pop()
            } else if (!prefix) {
                segments.push(segment)
            }
            continue
        }
        segments.push(segment)
    }
    const normalized = prefix
        ? `${prefix}${segments.join(separator)}`
        : segments.join(separator)
    return windows ? normalized.toLowerCase() : normalized
}

export function isPathInsideProjectRoot(machine: Machine | null, candidate: string, root: string): boolean {
    const windows = isWindowsMachine(machine)
    const normalizedCandidate = normalizePathForCompare(candidate, windows)
    const normalizedRoot = normalizePathForCompare(root, windows)
    if (!normalizedCandidate || !normalizedRoot) {
        return false
    }
    const separator = windows ? '\\' : '/'
    return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${separator}`)
}

export function projectMatchesMachine(project: ProjectWithDetails, machine: Machine | null): boolean {
    if (!machine) {
        return false
    }
    return project.workspaces.some((workspace) => workspace.machineId === machine.id)
}

export function projectMatchesDirectory(
    project: ProjectWithDetails,
    machine: Machine | null,
    directory: string
): boolean {
    if (!machine) {
        return false
    }
    const trimmedDirectory = directory.trim()
    if (!trimmedDirectory) {
        return projectMatchesMachine(project, machine)
    }
    return project.workspaces.some((workspace) =>
        workspace.machineId === machine.id
        && isPathInsideProjectRoot(machine, trimmedDirectory, workspace.rootPath)
    )
}

function formatProjectLabel(
    project: ProjectWithDetails,
    matches: boolean,
    isMachineOwner: boolean,
    outsideWorkspaceLabel: string
): string {
    if (matches || isMachineOwner) {
        return project.name
    }
    return `${project.name} (${outsideWorkspaceLabel})`
}

export function ProjectSelector(props: {
    projects: ProjectWithDetails[]
    machine: Machine | null
    directory: string
    currentUserId?: number | null
    projectId: string | null
    isLoading?: boolean
    isDisabled: boolean
    error?: string | null
    onChange: (projectId: string) => void
}) {
    const { t } = useTranslation()
    const isMachineOwner = Boolean(
        props.currentUserId
        && props.machine?.ownerUserId !== null
        && props.machine?.ownerUserId === props.currentUserId
    )
    const options = useMemo(
        () => props.projects
            .filter(isEditableProject)
            .map((project) => ({
                project,
                matches: projectMatchesDirectory(project, props.machine, props.directory)
            })),
        [props.directory, props.machine, props.projects]
    )
    const selectedOption = options.find((option) => option.project.id === props.projectId)
    const selectedOutsideSharedWorkspace = Boolean(
        selectedOption
        && !isMachineOwner
        && props.directory.trim()
        && !selectedOption.matches
    )

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.project')}
            </label>
            <select
                value={props.projectId ?? ''}
                onChange={(e) => props.onChange(e.target.value)}
                disabled={props.isDisabled || props.isLoading || options.length === 0}
                className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
            >
                {props.isLoading ? (
                    <option value="">{t('loading.projects')}</option>
                ) : null}
                {!props.isLoading && options.length === 0 ? (
                    <option value="">{t('newSession.project.noneEditable')}</option>
                ) : null}
                {options.map((option) => {
                    const disabled = !isMachineOwner && props.directory.trim() !== '' && !option.matches
                    return (
                        <option
                            key={option.project.id}
                            value={option.project.id}
                            disabled={disabled}
                        >
                            {formatProjectLabel(option.project, option.matches, isMachineOwner, t('newSession.project.outsideOption'))}
                        </option>
                    )
                })}
            </select>
            {props.error ? (
                <div className="text-xs text-red-600">
                    {props.error}
                </div>
            ) : selectedOutsideSharedWorkspace ? (
                <div className="text-xs text-[var(--app-hint)]">
                    {t('newSession.project.outsideWorkspace')}
                </div>
            ) : null}
        </div>
    )
}
