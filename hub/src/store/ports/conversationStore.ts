import type { StoredMessage } from '../types'
import type {
    CancelQueuedMessageResult,
    LocalMessageState,
    LookupQueuedMessageResult,
    MessagePosition
} from '../messages'

export type CopyMessageInput = Pick<StoredMessage, 'content' | 'createdAt' | 'localId' | 'invokedAt' | 'scheduledAt'>

export type MergeSessionMessagesResult = {
    moved: number
    oldMaxSeq: number
    newMaxSeq: number
}

export interface ConversationStore {
    addMessage(sessionId: string, content: unknown, localId?: string, scheduledAt?: number | null): StoredMessage
    addMessageAsync?(sessionId: string, content: unknown, localId?: string, scheduledAt?: number | null): Promise<StoredMessage>
    copyMessageToSession(sessionId: string, message: CopyMessageInput): StoredMessage
    copyMessageToSessionAsync?(sessionId: string, message: CopyMessageInput): Promise<StoredMessage>
    copyMessagesToSession?(sessionId: string, messages: Array<CopyMessageInput>): StoredMessage[]
    copyMessagesToSessionAsync?(sessionId: string, messages: Array<CopyMessageInput>): Promise<StoredMessage[]>
    getAllMessages(sessionId: string): StoredMessage[]
    getAllMessagesAsync?(sessionId: string): Promise<StoredMessage[]>
    getMessages(sessionId: string, limit?: number): StoredMessage[]
    getMessagesAsync?(sessionId: string, limit?: number): Promise<StoredMessage[]>
    getFirstMessages(sessionId: string, limit?: number): StoredMessage[]
    getFirstMessagesAsync?(sessionId: string, limit?: number): Promise<StoredMessage[]>
    getDeliverableMessagesAfter(sessionId: string, afterSeq: number, now: number, limit?: number): StoredMessage[]
    getDeliverableMessagesAfterAsync?(sessionId: string, afterSeq: number, now: number, limit?: number): Promise<StoredMessage[]>
    getMessagesByPosition(sessionId: string, limit: number, before?: MessagePosition): StoredMessage[]
    getMessagesByPositionAsync?(sessionId: string, limit: number, before?: MessagePosition): Promise<StoredMessage[]>
    getMessagesAfterPosition(sessionId: string, limit: number, after: MessagePosition, until?: MessagePosition): StoredMessage[]
    getMessagesAfterPositionAsync?(sessionId: string, limit: number, after: MessagePosition, until?: MessagePosition): Promise<StoredMessage[]>
    getNewestMessagePosition(sessionId: string): MessagePosition | null
    getNewestMessagePositionAsync?(sessionId: string): Promise<MessagePosition | null>
    getMessageEpoch(sessionId: string): number
    getMessageEpochAsync?(sessionId: string): Promise<number>
    bumpMessageEpoch(sessionId: string): number
    getLocalMessageStates(sessionId: string, localIds: string[]): LocalMessageState[]
    getLocalMessageStatesAsync?(sessionId: string, localIds: string[]): Promise<LocalMessageState[]>
    getUninvokedLocalMessages(sessionId: string): StoredMessage[]
    getUninvokedLocalMessagesAsync?(sessionId: string): Promise<StoredMessage[]>
    getMatureScheduledMessages(beforeTime: number): StoredMessage[]
    getMatureScheduledMessagesAsync?(beforeTime: number): Promise<StoredMessage[]>
    getImmediateQueuedLocalMessages(sessionId: string): StoredMessage[]
    getImmediateQueuedLocalMessagesAsync?(sessionId: string): Promise<StoredMessage[]>
    countFutureScheduledLocalMessages(sessionId: string, now?: number): number
    countFutureScheduledBySessionIds(sessionIds: string[], now?: number): Map<string, number>
    minFutureScheduledAtBySessionIds(sessionIds: string[], now?: number): Map<string, number>
    countMessages(sessionId: string): number
    countMessagesAsync?(sessionId: string): Promise<number>
    cancelQueuedMessage(sessionId: string, messageId: string): CancelQueuedMessageResult
    lookupQueuedMessage(sessionId: string, messageId: string): LookupQueuedMessageResult
    lookupQueuedMessageAsync?(sessionId: string, messageId: string): Promise<LookupQueuedMessageResult>
    deleteQueuedMessageById(sessionId: string, messageId: string): boolean
    deleteQueuedMessageByIdAsync?(sessionId: string, messageId: string): Promise<boolean>
    markMessagesInvoked(sessionId: string, localIds: string[], invokedAt: number): number
    markMessagesInvokedAsync?(sessionId: string, localIds: string[], invokedAt: number): Promise<number>
    mergeSessionMessages(fromSessionId: string, toSessionId: string): MergeSessionMessagesResult
    mergeSessionMessagesAsync?(fromSessionId: string, toSessionId: string): Promise<MergeSessionMessagesResult>
    deleteMessagesForSession(sessionId: string): void
    deleteMessagesForSessionAsync?(sessionId: string): Promise<void>
    deleteMessagesForSessions(sessionIds: string[]): void
    deleteMessagesForSessionsAsync?(sessionIds: string[]): Promise<void>
}

/** @deprecated Use ConversationStore. */
export type MessageStoreLike = ConversationStore
