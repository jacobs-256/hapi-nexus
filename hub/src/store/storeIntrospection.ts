import type { Database } from 'bun:sqlite'
import type { ExternalStorageSync, ExternalStorageSyncGroupStatus } from './external'
import type { StorageConfig } from './storageConfig'
import { getSqliteUserVersion } from './sqlite/schema'

export function sqliteMirrorStorageConfig(dbPath: string, conversationDbPath: string): StorageConfig {
    return {
        conversation: { backend: 'sqlite', sqlite: { path: conversationDbPath } },
        core: { backend: 'sqlite', sqlite: { path: dbPath } }
    }
}

export function externalStorageSyncStatus(
    externalSync: ExternalStorageSync | null
): Partial<Record<'core' | 'conversation', ExternalStorageSyncGroupStatus>> {
    return externalSync?.getStatus() ?? {}
}

export function sqliteSchemaVersion(db: Database): number {
    return getSqliteUserVersion(db)
}
