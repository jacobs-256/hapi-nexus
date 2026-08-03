import { posix, win32 } from 'node:path'
import type { Machine } from '../../sync/syncEngine'
import type { StoredProjectWorkspace } from '../../store'

export function isWindowsMachine(machine: Machine): boolean {
    return machine.metadata?.platform === 'win32'
        || (machine.metadata?.workspaceRoots ?? []).some((root) => /^[a-zA-Z]:[\\/]/.test(root))
}

export function normalizeForMachine(value: string, windows: boolean): string {
    const path = windows ? win32 : posix
    const normalized = path.normalize(value.trim())
    return windows ? normalized.toLowerCase() : normalized
}

export function isPathInsideRoot(candidate: string, root: string, windows: boolean): boolean {
    const path = windows ? win32 : posix
    const normalizedRoot = normalizeForMachine(root, windows)
    const normalizedCandidate = normalizeForMachine(candidate, windows)
    const relative = path.relative(normalizedRoot, normalizedCandidate)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function isPathInsideMachineRoots(machine: Machine, candidate: string, roots: readonly string[]): boolean {
    const windows = isWindowsMachine(machine)
    return roots.some((root) => isPathInsideRoot(candidate, root, windows))
}

export function machineAllowsWorkspace(machine: Machine, rootPath: string): boolean {
    const roots = machine.metadata?.workspaceRoots ?? []
    if (roots.length === 0) {
        return false
    }
    return isPathInsideMachineRoots(machine, rootPath, roots)
}

export function findWorkspaceForPath(
    machine: Machine,
    workspaces: readonly StoredProjectWorkspace[],
    directory: string
): StoredProjectWorkspace | null {
    const windows = isWindowsMachine(machine)
    return workspaces.find((workspace) =>
        workspace.machineId === machine.id
        && isPathInsideRoot(directory, workspace.rootPath, windows)
    ) ?? null
}
