import type { Database } from 'bun:sqlite'
import type { ConversationStorageBackend, CoreStorageBackend } from '@hapi/protocol/storage'
import type { ConversationStore } from './ports/conversationStore'
import type { CoreStores } from './ports/coreStores'
import type { StorageConfig } from './storageConfig'
import type { StoreFactoryCallbacks } from './storeFactories'

export type ConversationStoreFactoryContext = {
    storageConfig: StorageConfig
    conversationDb: Database
    callbacks: Pick<StoreFactoryCallbacks, 'scheduleConversationSync'>
}

export type CoreStoresFactoryContext = {
    storageConfig: StorageConfig
    coreDb: Database
    callbacks: StoreFactoryCallbacks
}

export type ConversationStoreFactory = (context: ConversationStoreFactoryContext) => ConversationStore
export type CoreStoresFactory = (context: CoreStoresFactoryContext) => CoreStores

export class StoreBackendRegistry {
    private readonly conversationFactories = new Map<ConversationStorageBackend, ConversationStoreFactory>()
    private readonly coreFactories = new Map<CoreStorageBackend, CoreStoresFactory>()

    registerConversation(backend: ConversationStorageBackend, factory: ConversationStoreFactory): this {
        this.conversationFactories.set(backend, factory)
        return this
    }

    registerCore(backend: CoreStorageBackend, factory: CoreStoresFactory): this {
        this.coreFactories.set(backend, factory)
        return this
    }

    createConversation(context: ConversationStoreFactoryContext): ConversationStore {
        const backend = context.storageConfig.conversation.backend
        const factory = this.conversationFactories.get(backend)
        if (!factory) throw new Error(`Unsupported conversation storage backend: ${backend}`)
        return factory(context)
    }

    createCore(context: CoreStoresFactoryContext): CoreStores {
        const backend = context.storageConfig.core.backend
        const factory = this.coreFactories.get(backend)
        if (!factory) throw new Error(`Unsupported core storage backend: ${backend}`)
        return factory(context)
    }
}
