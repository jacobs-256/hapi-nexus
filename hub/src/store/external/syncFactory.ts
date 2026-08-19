import { ExternalStorageSync } from './storageSync'
import type { StorageConfig } from '../storageConfig'
import type { StoreSqliteRuntime } from '../sqlite/runtime'

export function createRuntimeExternalSync(runtime: StoreSqliteRuntime): ExternalStorageSync | null {
    if (!runtime.hasSqliteCore || !runtime.hasSqliteConversation) return null

    const runtimeSyncConfig: StorageConfig = {
        // ExternalStorageSync is disabled for direct external runtime backends;
        // migration code still uses explicit snapshots when requested.
        core: { backend: 'sqlite', sqlite: { path: runtime.dbPath } },
        conversation: { backend: 'sqlite', sqlite: { path: runtime.conversationDbPath } }
    }
    return new ExternalStorageSync(runtimeSyncConfig, runtime.coreDb, runtime.conversationDb)
}

export type RuntimeExternalSync = ExternalStorageSync
