import type { AppSettingsStore } from './appSettingsStore'
import type { CodexImportJobStore } from './codexImportJobStore'
import type { FcmStore } from './fcmStore'
import type { MachineStore } from './machineStore'
import type { ProjectStore } from './projectStore'
import type { PushStore } from './pushStore'
import type { ScratchlistStore } from './scratchlistStore'
import type { SessionStore } from './sessionStore'
import type { UserStore } from './userStore'

type AsyncMethod<T> = T extends (...args: infer Args) => infer Return
    ? (...args: Args) => Promise<Awaited<Return>>
    : T

type AsyncStoreMethods<T> = {
    [K in keyof T]: AsyncMethod<T[K]>
}

// Direct MySQL backends require the core store call chain to move to async first.
// This file defines target interfaces for gradually replacing sync call sites by module.
export type AsyncUserStore = AsyncStoreMethods<UserStore>
export type AsyncSessionStore = AsyncStoreMethods<SessionStore>
export type AsyncMachineStore = AsyncStoreMethods<MachineStore>
export type AsyncProjectStore = AsyncStoreMethods<ProjectStore>
export type AsyncAppSettingsStore = AsyncStoreMethods<AppSettingsStore>
export type AsyncCodexImportJobStore = AsyncStoreMethods<CodexImportJobStore>
export type AsyncPushStore = AsyncStoreMethods<PushStore>
export type AsyncFcmStore = AsyncStoreMethods<FcmStore>
export type AsyncScratchlistStore = AsyncStoreMethods<ScratchlistStore>

export type AsyncCoreStore = {
    sessions: AsyncSessionStore
    machines: AsyncMachineStore
    users: AsyncUserStore
    projects: AsyncProjectStore
    appSettings: AsyncAppSettingsStore
    codexImportJobs: AsyncCodexImportJobStore
    push: AsyncPushStore
    fcm: AsyncFcmStore
    scratchlist: AsyncScratchlistStore
}
