import type { Database } from 'bun:sqlite'

import type { StoredMessage } from './types'
import type { ConversationStore, CopyMessageInput } from './ports/conversationStore'
import {
    addMessage,
    cancelQueuedMessage,
    deleteQueuedMessageById,
    lookupQueuedMessage,
    getMessages,
    getFirstMessages,
    getDeliverableMessagesAfter,
    getMessagesByPosition,
    getMessagesAfterPosition,
    getNewestMessagePosition,
    getMessageEpoch,
    bumpMessageEpoch,
    getLocalMessageStates,
    getUninvokedLocalMessages,
    getMatureScheduledMessages,
    getImmediateQueuedLocalMessages,
    countFutureScheduledBySessionIds,
    countFutureScheduledLocalMessages,
    minFutureScheduledAtBySessionIds,
    countMessages,
    markMessagesInvoked,
    mergeSessionMessages,
    copyMessageToSession as copyStoredMessageToSession,
    getAllMessages,
    deleteMessagesForSession,
    deleteMessagesForSessions,
    type CancelQueuedMessageResult,
    type LookupQueuedMessageResult,
    type LocalMessageState,
    type MessagePosition,
} from './messages'

export type { ConversationStore, CopyMessageInput, MessageStoreLike } from './ports/conversationStore'


export class MessageStore implements ConversationStore {
    private readonly db: Database

    constructor(db: Database, private readonly onChange?: () => void) {
        this.db = db
    }

    addMessage(sessionId: string, content: unknown, localId?: string, scheduledAt?: number | null): StoredMessage {
        const result = addMessage(this.db, sessionId, content, localId, scheduledAt)
        this.onChange?.()
        return result
    }

    async addMessageAsync(sessionId: string, content: unknown, localId?: string, scheduledAt?: number | null): Promise<StoredMessage> {
        return this.addMessage(sessionId, content, localId, scheduledAt)
    }

    copyMessageToSession(
        sessionId: string,
        message: CopyMessageInput
    ): StoredMessage {
        // Duplicate-session merge must preserve source timestamps and queued state, so use the copy path instead of addMessage.
        const result = copyStoredMessageToSession(this.db, sessionId, message)
        this.onChange?.()
        return result
    }

    async copyMessageToSessionAsync(
        sessionId: string,
        message: CopyMessageInput
    ): Promise<StoredMessage> {
        return this.copyMessageToSession(sessionId, message)
    }


    copyMessagesToSession(
        sessionId: string,
        messages: Array<CopyMessageInput>
    ): StoredMessage[] {
        if (messages.length === 0) return []
        const tx = this.db.transaction(() => messages.map((message) => copyStoredMessageToSession(this.db, sessionId, message)))
        const result = tx()
        this.onChange?.()
        return result
    }

    async copyMessagesToSessionAsync(
        sessionId: string,
        messages: Array<CopyMessageInput>
    ): Promise<StoredMessage[]> {
        return this.copyMessagesToSession(sessionId, messages)
    }

    getAllMessages(sessionId: string): StoredMessage[] {
        return getAllMessages(this.db, sessionId)
    }

    async getAllMessagesAsync(sessionId: string): Promise<StoredMessage[]> {
        return this.getAllMessages(sessionId)
    }

    getMessages(sessionId: string, limit: number = 200): StoredMessage[] {
        return getMessages(this.db, sessionId, limit)
    }

    async getMessagesAsync(sessionId: string, limit: number = 200): Promise<StoredMessage[]> {
        return this.getMessages(sessionId, limit)
    }

    getFirstMessages(sessionId: string, limit: number = 50): StoredMessage[] {
        return getFirstMessages(this.db, sessionId, limit)
    }

    async getFirstMessagesAsync(sessionId: string, limit: number = 50): Promise<StoredMessage[]> {
        return this.getFirstMessages(sessionId, limit)
    }

    getDeliverableMessagesAfter(sessionId: string, afterSeq: number, now: number, limit: number = 200): StoredMessage[] {
        return getDeliverableMessagesAfter(this.db, sessionId, afterSeq, now, limit)
    }

    async getDeliverableMessagesAfterAsync(sessionId: string, afterSeq: number, now: number, limit: number = 200): Promise<StoredMessage[]> {
        return this.getDeliverableMessagesAfter(sessionId, afterSeq, now, limit)
    }

    getMessagesByPosition(sessionId: string, limit: number, before?: { at: number; seq: number }): StoredMessage[] {
        return getMessagesByPosition(this.db, sessionId, limit, before)
    }

    async getMessagesByPositionAsync(sessionId: string, limit: number, before?: { at: number; seq: number }): Promise<StoredMessage[]> {
        return this.getMessagesByPosition(sessionId, limit, before)
    }

    getMessagesAfterPosition(
        sessionId: string,
        limit: number,
        after: MessagePosition,
        until?: MessagePosition
    ): StoredMessage[] {
        return getMessagesAfterPosition(this.db, sessionId, limit, after, until)
    }

    async getMessagesAfterPositionAsync(
        sessionId: string,
        limit: number,
        after: MessagePosition,
        until?: MessagePosition
    ): Promise<StoredMessage[]> {
        return this.getMessagesAfterPosition(sessionId, limit, after, until)
    }

    getNewestMessagePosition(sessionId: string): MessagePosition | null {
        return getNewestMessagePosition(this.db, sessionId)
    }

    async getNewestMessagePositionAsync(sessionId: string): Promise<MessagePosition | null> {
        return this.getNewestMessagePosition(sessionId)
    }

    getMessageEpoch(sessionId: string): number {
        return getMessageEpoch(this.db, sessionId)
    }

    async getMessageEpochAsync(sessionId: string): Promise<number> {
        return this.getMessageEpoch(sessionId)
    }

    bumpMessageEpoch(sessionId: string): number {
        const result = bumpMessageEpoch(this.db, sessionId)
        this.onChange?.()
        return result
    }

    getLocalMessageStates(sessionId: string, localIds: string[]): LocalMessageState[] {
        return getLocalMessageStates(this.db, sessionId, localIds)
    }

    async getLocalMessageStatesAsync(sessionId: string, localIds: string[]): Promise<LocalMessageState[]> {
        return this.getLocalMessageStates(sessionId, localIds)
    }

    getUninvokedLocalMessages(sessionId: string): StoredMessage[] {
        return getUninvokedLocalMessages(this.db, sessionId)
    }

    async getUninvokedLocalMessagesAsync(sessionId: string): Promise<StoredMessage[]> {
        return this.getUninvokedLocalMessages(sessionId)
    }

    getMatureScheduledMessages(beforeTime: number): StoredMessage[] {
        return getMatureScheduledMessages(this.db, beforeTime)
    }

    async getMatureScheduledMessagesAsync(beforeTime: number): Promise<StoredMessage[]> {
        return this.getMatureScheduledMessages(beforeTime)
    }

    getImmediateQueuedLocalMessages(sessionId: string): StoredMessage[] {
        return getImmediateQueuedLocalMessages(this.db, sessionId)
    }

    async getImmediateQueuedLocalMessagesAsync(sessionId: string): Promise<StoredMessage[]> {
        return this.getImmediateQueuedLocalMessages(sessionId)
    }

    countFutureScheduledLocalMessages(sessionId: string, now: number = Date.now()): number {
        return countFutureScheduledLocalMessages(this.db, sessionId, now)
    }

    countFutureScheduledBySessionIds(sessionIds: string[], now: number = Date.now()): Map<string, number> {
        return countFutureScheduledBySessionIds(this.db, sessionIds, now)
    }

    minFutureScheduledAtBySessionIds(sessionIds: string[], now: number = Date.now()): Map<string, number> {
        return minFutureScheduledAtBySessionIds(this.db, sessionIds, now)
    }

    countMessages(sessionId: string): number {
        return countMessages(this.db, sessionId)
    }

    async countMessagesAsync(sessionId: string): Promise<number> {
        return this.countMessages(sessionId)
    }

    cancelQueuedMessage(sessionId: string, messageId: string): CancelQueuedMessageResult {
        const result = cancelQueuedMessage(this.db, sessionId, messageId)
        this.onChange?.()
        return result
    }

    lookupQueuedMessage(sessionId: string, messageId: string): LookupQueuedMessageResult {
        return lookupQueuedMessage(this.db, sessionId, messageId)
    }

    async lookupQueuedMessageAsync(sessionId: string, messageId: string): Promise<LookupQueuedMessageResult> {
        return this.lookupQueuedMessage(sessionId, messageId)
    }

    deleteQueuedMessageById(sessionId: string, messageId: string): boolean {
        const result = deleteQueuedMessageById(this.db, sessionId, messageId)
        if (result) this.onChange?.()
        return result
    }

    async deleteQueuedMessageByIdAsync(sessionId: string, messageId: string): Promise<boolean> {
        return this.deleteQueuedMessageById(sessionId, messageId)
    }

    markMessagesInvoked(sessionId: string, localIds: string[], invokedAt: number): number {
        const result = markMessagesInvoked(this.db, sessionId, localIds, invokedAt)
        if (result > 0) this.onChange?.()
        return result
    }

    async markMessagesInvokedAsync(sessionId: string, localIds: string[], invokedAt: number): Promise<number> {
        return this.markMessagesInvoked(sessionId, localIds, invokedAt)
    }

    mergeSessionMessages(fromSessionId: string, toSessionId: string): { moved: number; oldMaxSeq: number; newMaxSeq: number } {
        const result = mergeSessionMessages(this.db, fromSessionId, toSessionId)
        if (result.moved > 0) this.onChange?.()
        return result
    }

    async mergeSessionMessagesAsync(fromSessionId: string, toSessionId: string): Promise<{ moved: number; oldMaxSeq: number; newMaxSeq: number }> {
        return this.mergeSessionMessages(fromSessionId, toSessionId)
    }

    deleteMessagesForSession(sessionId: string): void {
        deleteMessagesForSession(this.db, sessionId)
        this.onChange?.()
    }

    async deleteMessagesForSessionAsync(sessionId: string): Promise<void> {
        this.deleteMessagesForSession(sessionId)
    }

    deleteMessagesForSessions(sessionIds: string[]): void {
        deleteMessagesForSessions(this.db, sessionIds)
        if (sessionIds.length > 0) this.onChange?.()
    }

    async deleteMessagesForSessionsAsync(sessionIds: string[]): Promise<void> {
        this.deleteMessagesForSessions(sessionIds)
    }
}
