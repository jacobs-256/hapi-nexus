import type { Database } from 'bun:sqlite'
import type { ConversationStore } from './ports/conversationStore'
import type { StorageConfig } from './storageConfig'
import type { StoredSession } from './types'

type SessionActivityStore = {
    getSessionByNamespace(id: string, namespace: string): StoredSession | null | Promise<StoredSession | null>
    touchSessionUpdatedAt(id: string, updatedAt: number, namespace: string): boolean | Promise<boolean>
}

type RecordMessagesConsumedOptions = {
    storageConfig: StorageConfig
    coreDb: Database
    conversationDb: Database
    messages: ConversationStore
    sessions: SessionActivityStore
    sessionId: string
    localIds: string[]
    invokedAt: number
    namespace: string
}

export function recordMessagesConsumedActivity(options: RecordMessagesConsumedOptions): number | Promise<number> {
    if (canRecordInSingleSqliteTransaction(options)) {
        return options.coreDb.transaction(() => recordSyncTransition(options, false))()
    }

    if (options.storageConfig.core.backend === 'mysql') {
        return recordAsyncCoreTransition(options)
    }

    return recordSqliteCoreTransition(options)
}

function canRecordInSingleSqliteTransaction(options: RecordMessagesConsumedOptions): boolean {
    return options.storageConfig.conversation.backend === 'sqlite'
        && options.storageConfig.core.backend === 'sqlite'
        && options.conversationDb === options.coreDb
}

async function recordAsyncCoreTransition(options: RecordMessagesConsumedOptions): Promise<number> {
    await assertSessionExistsBeforeTransition(options)
    const changes = await markMessagesInvoked(options)
    if (changes > 0) {
        await options.sessions.touchSessionUpdatedAt(options.sessionId, options.invokedAt, options.namespace)
    }
    const session = await options.sessions.getSessionByNamespace(options.sessionId, options.namespace)
    return requirePersistedActivity(session, changes, options.invokedAt)
}

function recordSqliteCoreTransition(options: RecordMessagesConsumedOptions): number | Promise<number> {
    const existing = options.sessions.getSessionByNamespace(options.sessionId, options.namespace) as StoredSession | null
    if (!existing) {
        throw new Error('session not found before messages-consumed transition')
    }

    if (options.messages.markMessagesInvokedAsync) {
        return (async () => {
            const changes = await options.messages.markMessagesInvokedAsync!(options.sessionId, options.localIds, options.invokedAt)
            if (changes > 0) {
                options.sessions.touchSessionUpdatedAt(options.sessionId, options.invokedAt, options.namespace)
            }
            const session = options.sessions.getSessionByNamespace(options.sessionId, options.namespace) as StoredSession | null
            return requirePersistedActivity(session, changes, options.invokedAt)
        })()
    }

    return recordSyncTransition(options, true)
}

function recordSyncTransition(options: RecordMessagesConsumedOptions, checkBefore: boolean): number {
    if (checkBefore) {
        const existing = options.sessions.getSessionByNamespace(options.sessionId, options.namespace) as StoredSession | null
        if (!existing) {
            throw new Error('session not found before messages-consumed transition')
        }
    }

    const changes = options.messages.markMessagesInvoked(options.sessionId, options.localIds, options.invokedAt)
    if (changes > 0) {
        options.sessions.touchSessionUpdatedAt(options.sessionId, options.invokedAt, options.namespace)
    }

    const session = options.sessions.getSessionByNamespace(options.sessionId, options.namespace) as StoredSession | null
    return requirePersistedActivity(session, changes, options.invokedAt)
}

async function assertSessionExistsBeforeTransition(options: RecordMessagesConsumedOptions): Promise<void> {
    const existing = await options.sessions.getSessionByNamespace(options.sessionId, options.namespace)
    if (!existing) {
        throw new Error('session not found before messages-consumed transition')
    }
}

async function markMessagesInvoked(options: RecordMessagesConsumedOptions): Promise<number> {
    return options.messages.markMessagesInvokedAsync
        ? await options.messages.markMessagesInvokedAsync(options.sessionId, options.localIds, options.invokedAt)
        : options.messages.markMessagesInvoked(options.sessionId, options.localIds, options.invokedAt)
}

function requirePersistedActivity(session: StoredSession | null, changes: number, invokedAt: number): number {
    if (!session) {
        throw new Error('session not found after messages-consumed transition')
    }
    if (changes > 0 && session.updatedAt < invokedAt) {
        throw new Error('session activity was not persisted after messages-consumed transition')
    }
    return session.updatedAt
}
