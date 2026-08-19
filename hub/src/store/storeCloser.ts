import type { Database } from 'bun:sqlite'
import type { ExternalStorageSync } from './external'

export function closeStoreRuntime(
    coreDb: Database,
    conversationDb: Database,
    externalSync: ExternalStorageSync | null
): void {
    externalSync?.stop()
    if (conversationDb !== coreDb) {
        conversationDb.close()
    }
    coreDb.close()

    // Bun's SQLite close uses sqlite3_close_v2 by default, so prepared
    // statements that are already unreachable may keep the underlying file
    // handle alive until the next GC cycle. Windows refuses to remove a
    // directory while those SQLite WAL/SHM handles are still pending.
    if (process.platform === 'win32') {
        Bun.gc(true)
    }
}
