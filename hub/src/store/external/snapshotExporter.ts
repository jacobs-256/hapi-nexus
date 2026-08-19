import type { Database } from 'bun:sqlite'
import { ensureMysqlCoreSchema } from '../mysql'
import { exportSqliteSnapshotToExternal, type ExternalStorageExportOptions } from './storageSync'
import { openSqliteDatabase } from '../sqlite/lifecycle'
import type { StorageConfig } from '../storageConfig'

type ExportExternalSnapshotOptions = {
    targetConfig: StorageConfig
    activeConfig: StorageConfig
    coreDb: Database
    conversationDb: Database
    dbPath: string
    conversationDbPath: string
    exportOptions?: ExternalStorageExportOptions
}

export async function exportExternalSnapshotFromRuntime(options: ExportExternalSnapshotOptions): Promise<Record<string, number>> {
    const { targetConfig, activeConfig, coreDb, conversationDb, dbPath, conversationDbPath } = options
    if (targetConfig.core.backend === 'mysql') {
        await ensureMysqlCoreSchema(targetConfig.core.mysql)
    }

    const opened: Database[] = []
    const coreSourceDb = openCoreSnapshotSource(targetConfig, activeConfig, coreDb, dbPath, opened)
    const conversationSourceDb = openConversationSnapshotSource(
        targetConfig,
        activeConfig,
        conversationDb,
        coreSourceDb,
        dbPath,
        conversationDbPath,
        opened
    )

    try {
        return await exportSqliteSnapshotToExternal(targetConfig, coreSourceDb, conversationSourceDb, options.exportOptions ?? {})
    } finally {
        closeOpenedDatabases(opened)
    }
}

function openCoreSnapshotSource(
    targetConfig: StorageConfig,
    activeConfig: StorageConfig,
    coreDb: Database,
    dbPath: string,
    opened: Database[]
): Database {
    if (targetConfig.core.backend !== 'mysql') return coreDb
    if (activeConfig.core.backend === 'sqlite') return coreDb

    const db = openSqliteDatabase(dbPath)
    opened.push(db)
    return db
}

function openConversationSnapshotSource(
    targetConfig: StorageConfig,
    activeConfig: StorageConfig,
    conversationDb: Database,
    coreSourceDb: Database,
    dbPath: string,
    conversationDbPath: string,
    opened: Database[]
): Database {
    if (targetConfig.conversation.backend !== 'elasticsearch') return conversationDb
    if (activeConfig.conversation.backend === 'sqlite') return conversationDb
    if (conversationDbPath === dbPath && opened.includes(coreSourceDb)) return coreSourceDb

    const db = openSqliteDatabase(conversationDbPath)
    opened.push(db)
    return db
}

function closeOpenedDatabases(opened: Database[]): void {
    for (const db of [...new Set(opened)].reverse()) {
        db.close()
    }
}
