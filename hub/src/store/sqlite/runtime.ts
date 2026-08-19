import { Database } from 'bun:sqlite'
import type { StorageConfig } from '../storageConfig'
import { chmodSqliteFiles, ensureSqlitePath, openSqliteDatabase } from './lifecycle'
import { initializeConversationSqliteSchema, initializeCoreSqliteSchema } from './storeInitializer'

export type StoreSqliteRuntime = {
    storageConfig: StorageConfig
    coreDb: Database
    conversationDb: Database
    dbPath: string
    conversationDbPath: string
    hasSqliteCore: boolean
    hasSqliteConversation: boolean
}

export function resolveStoreStorageConfig(dbPath: string, storageConfig?: StorageConfig): StorageConfig {
    return storageConfig ?? {
        conversation: { backend: 'sqlite', sqlite: { path: dbPath } },
        core: { backend: 'sqlite', sqlite: { path: dbPath } }
    }
}

export function openStoreSqliteRuntime(dbPath: string, storageConfig: StorageConfig, schemaVersion: number): StoreSqliteRuntime {
    const hasSqliteCore = storageConfig.core.backend === 'sqlite'
    const hasSqliteConversation = storageConfig.conversation.backend === 'sqlite'
    const resolvedDbPath = storageConfig.core.backend === 'sqlite' ? storageConfig.core.sqlite.path : dbPath
    const conversationDbPath = storageConfig.conversation.backend === 'sqlite' ? storageConfig.conversation.sqlite.path : resolvedDbPath

    if (hasSqliteCore) ensureSqlitePath(resolvedDbPath)
    if (hasSqliteConversation) ensureSqlitePath(conversationDbPath)

    const coreDb = openCoreDatabase(resolvedDbPath, hasSqliteCore, schemaVersion)
    const conversationDb = openConversationDatabase(coreDb, resolvedDbPath, conversationDbPath, hasSqliteCore, hasSqliteConversation, schemaVersion)

    if (hasSqliteCore) chmodSqliteFiles(resolvedDbPath)
    if (hasSqliteConversation) chmodSqliteFiles(conversationDbPath)

    return {
        storageConfig,
        coreDb,
        conversationDb,
        dbPath: resolvedDbPath,
        conversationDbPath,
        hasSqliteCore,
        hasSqliteConversation
    }
}

function openCoreDatabase(dbPath: string, hasSqliteCore: boolean, schemaVersion: number): Database {
    if (!hasSqliteCore) {
        return new Database(':memory:', { create: true, readwrite: true, strict: true })
    }
    const db = openSqliteDatabase(dbPath)
    initializeCoreSqliteSchema(db, dbPath, schemaVersion)
    return db
}

function openConversationDatabase(
    coreDb: Database,
    dbPath: string,
    conversationDbPath: string,
    hasSqliteCore: boolean,
    hasSqliteConversation: boolean,
    schemaVersion: number
): Database {
    if (!hasSqliteConversation) return coreDb
    const conversationDb = hasSqliteCore && conversationDbPath === dbPath
        ? coreDb
        : openSqliteDatabase(conversationDbPath)
    initializeConversationSqliteSchema(conversationDb, conversationDbPath, schemaVersion)
    return conversationDb
}
