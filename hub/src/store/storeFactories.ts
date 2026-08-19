import type { Database } from 'bun:sqlite'
import type { StorageConfig } from './storageConfig'
import { AppSettingsStore } from './appSettingsStore'
import { CodexImportJobStore } from './codexImportJobStore'
import { ElasticsearchMessageStore } from './elasticsearch'
import { FcmStore } from './fcmStore'
import { MachineStore } from './machineStore'
import { MessageStore } from './messageStore'
import type { ConversationStore } from './ports/conversationStore'
import type { CoreStores } from './ports/coreStores'
import { StoreBackendRegistry } from './storeBackendRegistry'
import {
    MysqlAppSettingsStore,
    MysqlCodexImportJobStore,
    MysqlFcmStore,
    MysqlMachineStore,
    MysqlProjectStore,
    MysqlPushStore,
    MysqlScratchlistStore,
    MysqlSessionStore,
    MysqlUserStore
} from './mysql'
import { ProjectStore } from './projectStore'
import { PushStore } from './pushStore'
import { ScratchlistStore } from './scratchlistStore'
import { SessionStore } from './sessionStore'
import { UserStore } from './userStore'

export type StoreFactoryCallbacks = {
    scheduleCoreSync: () => void
    scheduleConversationSync: () => void
    deleteMessagesForSession: (sessionId: string) => Promise<void>
    deleteMessagesForSessions: (sessionIds: string[]) => Promise<void>
    warn?: Pick<Console, 'warn'>['warn']
}


const storeBackendRegistry = new StoreBackendRegistry()
    .registerConversation('sqlite', ({ conversationDb, callbacks }) => new MessageStore(conversationDb, callbacks.scheduleConversationSync))
    .registerConversation('elasticsearch', ({ storageConfig }) => {
        if (storageConfig.conversation.backend !== 'elasticsearch') throw new Error('Elasticsearch conversation storage config expected')
        return new ElasticsearchMessageStore(storageConfig.conversation.elasticsearch)
    })
    .registerCore('sqlite', ({ coreDb, callbacks }) => createSqliteCoreStores(coreDb, callbacks))
    .registerCore('mysql', ({ storageConfig, callbacks }) => {
        if (storageConfig.core.backend !== 'mysql') throw new Error('MySQL core storage config expected')
        return createMysqlCoreStores(storageConfig.core.mysql, callbacks)
    })

export function createConversationStore(
    storageConfig: StorageConfig,
    conversationDb: Database,
    callbacks: Pick<StoreFactoryCallbacks, 'scheduleConversationSync'>
): ConversationStore {
    return storeBackendRegistry.createConversation({ storageConfig, conversationDb, callbacks })
}

export function createCoreStores(
    storageConfig: StorageConfig,
    coreDb: Database,
    callbacks: StoreFactoryCallbacks
): CoreStores {
    return storeBackendRegistry.createCore({ storageConfig, coreDb, callbacks })
}

function createMysqlCoreStores(mysql: Extract<StorageConfig['core'], { backend: 'mysql' }>['mysql'], callbacks: StoreFactoryCallbacks): CoreStores {
    return {
        sessions: new MysqlSessionStore(mysql, callbacks.deleteMessagesForSession, () => undefined),
        machines: new MysqlMachineStore(mysql, callbacks.deleteMessagesForSessions, () => undefined),
        users: new MysqlUserStore(mysql, () => undefined),
        projects: new MysqlProjectStore(mysql, () => undefined),
        appSettings: new MysqlAppSettingsStore(mysql, () => undefined),
        codexImportJobs: new MysqlCodexImportJobStore(mysql, () => undefined),
        push: new MysqlPushStore(mysql, () => undefined),
        fcm: new MysqlFcmStore(mysql, () => undefined),
        scratchlist: new MysqlScratchlistStore(mysql, () => undefined)
    }
}

function createSqliteCoreStores(coreDb: Database, callbacks: StoreFactoryCallbacks): CoreStores {
    const warn = callbacks.warn ?? console.warn
    return {
        sessions: new SessionStore(coreDb, (sessionId) => {
            void callbacks.deleteMessagesForSession(sessionId).catch((error) => {
                warn('[Storage] Failed to delete conversation messages for removed session:', error instanceof Error ? error.message : error)
            })
            callbacks.scheduleCoreSync()
        }, callbacks.scheduleCoreSync),
        machines: new MachineStore(coreDb, (sessionIds) => {
            void callbacks.deleteMessagesForSessions(sessionIds).catch((error) => {
                warn('[Storage] Failed to delete conversation messages for removed machine sessions:', error instanceof Error ? error.message : error)
            })
            callbacks.scheduleCoreSync()
        }, callbacks.scheduleCoreSync),
        users: new UserStore(coreDb, callbacks.scheduleCoreSync),
        projects: new ProjectStore(coreDb, callbacks.scheduleCoreSync),
        appSettings: new AppSettingsStore(coreDb, callbacks.scheduleCoreSync),
        codexImportJobs: new CodexImportJobStore(coreDb, callbacks.scheduleCoreSync),
        push: new PushStore(coreDb, callbacks.scheduleCoreSync),
        fcm: new FcmStore(coreDb, callbacks.scheduleCoreSync),
        scratchlist: new ScratchlistStore(coreDb, callbacks.scheduleCoreSync)
    }
}
