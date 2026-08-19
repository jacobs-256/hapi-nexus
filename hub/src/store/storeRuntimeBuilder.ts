import type { Database } from 'bun:sqlite'
import type { ExternalStorageSync } from './external'
import type { ConversationStore } from './ports/conversationStore'
import type { StorageConfig } from './storageConfig'
import type { CoreStores } from './ports/coreStores'
import type { StoreFactoryCallbacks } from './storeFactories'
import { createRuntimeExternalSync } from './external'
import { createConversationStore, createCoreStores } from './storeFactories'
import { openStoreSqliteRuntime, resolveStoreStorageConfig } from './sqlite/runtime'

export type StoreRuntimeBindings = {
    storageConfig: StorageConfig
    dbPath: string
    conversationDbPath: string
    coreDb: Database
    conversationDb: Database
    externalSync: ExternalStorageSync | null
    messages: ConversationStore
    coreStores: CoreStores
}

export function buildStoreRuntime(
    dbPath: string,
    storageConfig: StorageConfig | undefined,
    schemaVersion: number,
    callbacks: StoreFactoryCallbacks
): StoreRuntimeBindings {
    const resolvedStorageConfig = resolveStoreStorageConfig(dbPath, storageConfig)
    const sqliteRuntime = openStoreSqliteRuntime(dbPath, resolvedStorageConfig, schemaVersion)
    const externalSync = createRuntimeExternalSync(sqliteRuntime)
    const messages = createConversationStore(resolvedStorageConfig, sqliteRuntime.conversationDb, {
        scheduleConversationSync: callbacks.scheduleConversationSync
    })
    const coreStores = createCoreStores(resolvedStorageConfig, sqliteRuntime.coreDb, callbacks)

    return {
        storageConfig: resolvedStorageConfig,
        dbPath: sqliteRuntime.dbPath,
        conversationDbPath: sqliteRuntime.conversationDbPath,
        coreDb: sqliteRuntime.coreDb,
        conversationDb: sqliteRuntime.conversationDb,
        externalSync,
        messages,
        coreStores
    }
}
