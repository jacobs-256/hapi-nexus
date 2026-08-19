import type { StoredMessage } from '../types'
import type {
    CancelQueuedMessageResult,
    LocalMessageState,
    LookupQueuedMessageResult,
    MessagePosition
} from '../messages'
import type { ConversationStore } from '../ports/conversationStore'
import {
    ELASTIC_SCHEDULED_SEARCH_SIZE,
    ELASTIC_SEARCH_SIZE
} from './constants'
import {
    comparePosition,
    limitValue,
    position,
    rowToStored,
    toMessageRow
} from './codec'
import type {
    ElasticsearchTarget,
    EpochRow,
    EsOp,
    EsTable,
    EsWriteOperation,
    MessageCounterRow
} from './types'
import {
    localIdsFilter,
    matureScheduledMessagesQuery,
    messageEpochQuery,
    messageIdentityFilter,
    seqBoundedSessionQuery,
    sessionFilter
} from './queries'
import { ElasticsearchClient } from './client'
import { ElasticsearchWriter } from './writer'
import { ElasticsearchReader } from './reader'
import { createOutboundMessage, prepareCopiedMessage, prepareCopiedMessages, type CopyMessageInput } from './messageBuilder'
import {
    readDeliverableMessagesAfterWindow,
    readFirstMessagesWindow,
    readLatestMessagesWindow,
    readMessagesAfterPositionWindow,
    readMessagesBeforePositionWindow,
    type SeqRange
} from './messageReadWindows'
import {
    deleteMessagesForSessionOps,
    deleteMessagesForSessionsOps,
    mergeSessionMessageOps,
    planMergeSessionMessages
} from './messageLifecycle'
import {
    deleteQueuedMessageOp,
    immediateQueuedLocalMessages,
    localMessageStates,
    lookupQueuedMessageInRows,
    markInvokedMessages,
    matureScheduledMessages,
    uninvokedLocalMessages,
    upsertMessageOps
} from './messageQueue'
import { SequenceLock } from './sequenceLock'

export class ElasticsearchMessageStore implements ConversationStore {
    private readonly client: ElasticsearchClient
    private readonly writer: ElasticsearchWriter
    private readonly reader: ElasticsearchReader
    private readonly sequenceLock = new SequenceLock()

    constructor(target: ElasticsearchTarget) {
        this.client = new ElasticsearchClient(target)
        this.writer = new ElasticsearchWriter(this.client)
        this.reader = new ElasticsearchReader(this.client)
    }

    private appendMany(docs: EsWriteOperation[]): void {
        this.writer.appendMany(docs)
    }

    private async appendManyAsync(docs: EsWriteOperation[]): Promise<void> {
        await this.writer.appendManyAsync(docs)
    }

    private append(table: EsTable, rowKey: string, op: EsOp, row?: Record<string, unknown>): void {
        this.writer.append(table, rowKey, op, row)
    }

    private async getMaxSeqForReadAsync(sessionId: string): Promise<number> {
        return await this.getPersistedMaxSeqAsync(sessionId)
            ?? (await this.sessionMessagesAsync(sessionId, Number.POSITIVE_INFINITY))
                .reduce((max, message) => Math.max(max, message.seq), 0)
    }

    private latestRows(table: EsTable, query: Record<string, unknown>, size = ELASTIC_SEARCH_SIZE): Record<string, unknown>[] {
        return this.reader.latestRows(table, query, size)
    }

    private async latestRowsAsync(table: EsTable, query: Record<string, unknown>, size = ELASTIC_SEARCH_SIZE): Promise<Record<string, unknown>[]> {
        return await this.reader.latestRowsAsync(table, query, size)
    }

    private rows(table: 'messages'): StoredMessage[]
    private rows(table: 'message_epochs'): EpochRow[]
    private rows(table: 'message_counters'): MessageCounterRow[]
    private rows(table: EsTable): StoredMessage[] | EpochRow[] | MessageCounterRow[] {
        const rows = this.latestRows(table, { term: { table } })

        if (table === 'messages') {
            return rows.map(rowToStored)
        }
        if (table === 'message_epochs') {
            return rows.map((row) => ({
                session_id: String(row.session_id),
                epoch: Number(row.epoch)
            }))
        }
        return rows.map((row) => ({
            session_id: String(row.session_id),
            max_seq: Number(row.max_seq)
        }))
    }

    private sessionMessages(sessionId: string): StoredMessage[] {
        const rows = this.latestRows('messages', {
            bool: {
                filter: [
                    { term: { table: 'messages' } },
                    sessionFilter(sessionId)
                ]
            }
        })
        return rows.map(rowToStored).filter((message) => message.sessionId === sessionId)
    }

    private async sessionMessagesAsync(sessionId: string, size = ELASTIC_SEARCH_SIZE): Promise<StoredMessage[]> {
        const rows = await this.latestRowsAsync('messages', {
            bool: {
                filter: [
                    { term: { table: 'messages' } },
                    sessionFilter(sessionId)
                ]
            }
        }, size)
        return rows.map(rowToStored).filter((message) => message.sessionId === sessionId)
    }

    private async sessionMessagesBySeqRangeAsync(sessionId: string, range: SeqRange): Promise<StoredMessage[]> {
        const rows = await this.latestRowsAsync('messages', seqBoundedSessionQuery(sessionId, range), Number.POSITIVE_INFINITY)
        return rows.map(rowToStored).filter((message) => message.sessionId === sessionId)
    }

    private maxSeq(sessionId: string): number {
        return this.sessionMessages(sessionId).reduce((max, message) => Math.max(max, message.seq), 0)
    }

    private async withSequenceLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
        return await this.sequenceLock.run(sessionId, fn)
    }

    private async getPersistedMaxSeqAsync(sessionId: string): Promise<number | null> {
        const rows = await this.latestRowsAsync('message_counters', {
            bool: {
                filter: [
                    { term: { table: 'message_counters' } },
                    sessionFilter(sessionId)
                ]
            }
        }, Number.POSITIVE_INFINITY)
        const maxSeq = Number(rows.find((row) => String(row.session_id) === sessionId)?.max_seq)
        return Number.isFinite(maxSeq) && maxSeq >= 0 ? maxSeq : null
    }

    private async getCurrentMaxSeqForReservationAsync(sessionId: string): Promise<number> {
        const persisted = await this.getPersistedMaxSeqAsync(sessionId)
        if (persisted !== null) return persisted
        return (await this.sessionMessagesAsync(sessionId, Number.POSITIVE_INFINITY))
            .reduce((max, message) => Math.max(max, message.seq), 0)
    }

    private counterOp(sessionId: string, maxSeq: number): EsWriteOperation {
        return {
            table: 'message_counters',
            rowKey: sessionId,
            op: 'upsert',
            row: { session_id: sessionId, max_seq: maxSeq } satisfies MessageCounterRow
        }
    }

    private async findMessageByLocalIdAsync(sessionId: string, localId: string): Promise<StoredMessage | null> {
        const rows = await this.latestRowsAsync('messages', {
            bool: {
                filter: [
                    { term: { table: 'messages' } },
                    sessionFilter(sessionId),
                    localIdsFilter([localId])
                ]
            }
        }, Number.POSITIVE_INFINITY)
        return rows.map(rowToStored).find((message) => message.sessionId === sessionId && message.localId === localId) ?? null
    }

    private upsertMessage(message: StoredMessage): void {
        this.append('messages', message.id, 'upsert', {
            id: message.id,
            session_id: message.sessionId,
            content: JSON.stringify(message.content),
            created_at: message.createdAt,
            seq: message.seq,
            local_id: message.localId,
            invoked_at: message.invokedAt,
            scheduled_at: message.scheduledAt
        })
    }

    addMessage(sessionId: string, content: unknown, localId?: string, scheduledAt?: number | null): StoredMessage {
        if (scheduledAt != null && !localId) {
            throw new Error('addMessage: scheduledAt requires a localId for the ack flow')
        }
        if (localId) {
            const existing = this.sessionMessages(sessionId).find((message) => message.localId === localId)
            if (existing) return existing
        }
        const message = createOutboundMessage(sessionId, content, this.maxSeq(sessionId) + 1, localId, scheduledAt)
        this.upsertMessage(message)
        return message
    }

    async addMessageAsync(sessionId: string, content: unknown, localId?: string, scheduledAt?: number | null): Promise<StoredMessage> {
        if (scheduledAt != null && !localId) {
            throw new Error('addMessage: scheduledAt requires a localId for the ack flow')
        }
        return await this.withSequenceLock(sessionId, async () => {
            if (localId) {
                const existing = await this.findMessageByLocalIdAsync(sessionId, localId)
                if (existing) return existing
            }
            const seq = await this.getCurrentMaxSeqForReservationAsync(sessionId) + 1
            const message = createOutboundMessage(sessionId, content, seq, localId, scheduledAt)
            await this.appendManyAsync([
                { table: 'messages', rowKey: message.id, op: 'upsert', row: toMessageRow(message) },
                this.counterOp(sessionId, seq)
            ])
            return message
        })
    }

    copyMessageToSession(
        sessionId: string,
        message: CopyMessageInput
    ): StoredMessage {
        const stored = prepareCopiedMessage(
            sessionId,
            message,
            this.maxSeq(sessionId) + 1,
            (localId) => this.sessionMessages(sessionId).some((row) => row.localId === localId)
        )
        this.upsertMessage(stored)
        this.bumpMessageEpoch(sessionId)
        return stored
    }

    async copyMessageToSessionAsync(
        sessionId: string,
        message: CopyMessageInput
    ): Promise<StoredMessage> {
        return await this.withSequenceLock(sessionId, async () => {
            const seq = await this.getCurrentMaxSeqForReservationAsync(sessionId) + 1
            const localIdExists = message.localId ? await this.findMessageByLocalIdAsync(sessionId, message.localId) !== null : false
            const stored = prepareCopiedMessage(sessionId, message, seq, (localId) => localId === message.localId && localIdExists)
            await this.appendManyAsync([
                { table: 'messages', rowKey: stored.id, op: 'upsert', row: toMessageRow(stored) },
                { table: 'message_epochs', rowKey: sessionId, op: 'upsert', row: { session_id: sessionId, epoch: await this.getMessageEpochAsync(sessionId) + 1 } },
                this.counterOp(sessionId, seq)
            ])
            return stored
        })
    }


    copyMessagesToSession(
        sessionId: string,
        messages: Array<CopyMessageInput>
    ): StoredMessage[] {
        if (messages.length === 0) return []
        const existing = this.getAllMessages(sessionId)
        const localIds = new Set(existing.map((message) => message.localId).filter((id): id is string => Boolean(id)))
        let seq = existing.reduce((max, message) => Math.max(max, message.seq), 0)
        const stored = prepareCopiedMessages(sessionId, messages, seq, localIds)
        this.appendMany(stored.map((message) => ({
            table: 'messages',
            rowKey: message.id,
            op: 'upsert',
            row: toMessageRow(message)
        })))
        this.bumpMessageEpoch(sessionId)
        return stored
    }

    async copyMessagesToSessionAsync(
        sessionId: string,
        messages: Array<CopyMessageInput>
    ): Promise<StoredMessage[]> {
        if (messages.length === 0) return []
        return await this.withSequenceLock(sessionId, async () => {
            const incomingLocalIds = messages.map((message) => message.localId).filter((id): id is string => Boolean(id))
            const existingStates = incomingLocalIds.length > 0
                ? await this.getLocalMessageStatesAsync(sessionId, incomingLocalIds)
                : []
            const localIds = new Set(existingStates.map((state) => state.localId))
            let seq = await this.getCurrentMaxSeqForReservationAsync(sessionId)
            const stored = prepareCopiedMessages(sessionId, messages, seq, localIds)
            seq += stored.length
            await this.appendManyAsync([
                ...stored.map((message) => ({
                    table: 'messages' as const,
                    rowKey: message.id,
                    op: 'upsert' as const,
                    row: toMessageRow(message)
                })),
                { table: 'message_epochs', rowKey: sessionId, op: 'upsert', row: { session_id: sessionId, epoch: await this.getMessageEpochAsync(sessionId) + 1 } },
                this.counterOp(sessionId, seq)
            ])
            return stored
        })
    }

    getAllMessages(sessionId: string): StoredMessage[] {
        return this.sessionMessages(sessionId).sort((a, b) => a.seq - b.seq)
    }

    async getAllMessagesAsync(sessionId: string): Promise<StoredMessage[]> {
        return (await this.sessionMessagesAsync(sessionId, Number.POSITIVE_INFINITY)).sort((a, b) => a.seq - b.seq)
    }

    getMessages(sessionId: string, limit = 200): StoredMessage[] {
        const safeLimit = limitValue(limit, 200)
        return this.getAllMessages(sessionId).slice(-safeLimit)
    }

    getFirstMessages(sessionId: string, limit = 50): StoredMessage[] {
        return this.getAllMessages(sessionId).slice(0, limitValue(limit, 50))
    }

    async getMessagesAsync(sessionId: string, limit = 200): Promise<StoredMessage[]> {
        const safeLimit = limitValue(limit, 200)
        const maxSeq = await this.getMaxSeqForReadAsync(sessionId)
        return await readLatestMessagesWindow(maxSeq, safeLimit, (range) => this.sessionMessagesBySeqRangeAsync(sessionId, range))
    }

    async getFirstMessagesAsync(sessionId: string, limit = 50): Promise<StoredMessage[]> {
        const safeLimit = limitValue(limit, 50)
        const maxSeq = await this.getMaxSeqForReadAsync(sessionId)
        return await readFirstMessagesWindow(maxSeq, safeLimit, (range) => this.sessionMessagesBySeqRangeAsync(sessionId, range))
    }

    getDeliverableMessagesAfter(sessionId: string, afterSeq: number, now: number, limit = 200): StoredMessage[] {
        return this.getAllMessages(sessionId)
            .filter((message) => message.seq > afterSeq && (message.scheduledAt === null || message.scheduledAt <= now))
            .slice(0, limitValue(limit, 200))
    }

    async getDeliverableMessagesAfterAsync(sessionId: string, afterSeq: number, now: number, limit = 200): Promise<StoredMessage[]> {
        const safeLimit = limitValue(limit, 200)
        const maxSeq = await this.getMaxSeqForReadAsync(sessionId)
        return await readDeliverableMessagesAfterWindow(afterSeq, maxSeq, now, safeLimit, (range) => this.sessionMessagesBySeqRangeAsync(sessionId, range))
    }

    getMessagesByPosition(sessionId: string, limit: number, before?: MessagePosition): StoredMessage[] {
        const rows = this.sessionMessages(sessionId)
            .filter((message) => !before || comparePosition(position(message), before) < 0)
            .sort((a, b) => -comparePosition(position(a), position(b)))
            .slice(0, limitValue(limit, 200))
        return rows.reverse()
    }

    async getMessagesByPositionAsync(sessionId: string, limit: number, before?: MessagePosition): Promise<StoredMessage[]> {
        const safeLimit = limitValue(limit, 200)
        const maxSeq = await this.getMaxSeqForReadAsync(sessionId)
        return await readMessagesBeforePositionWindow(maxSeq, safeLimit, before, (range) => this.sessionMessagesBySeqRangeAsync(sessionId, range))
    }

    getMessagesAfterPosition(sessionId: string, limit: number, after: MessagePosition, until?: MessagePosition): StoredMessage[] {
        return this.sessionMessages(sessionId)
            .filter((message) => {
                const p = position(message)
                return comparePosition(p, after) > 0 && (!until || comparePosition(p, until) <= 0)
            })
            .sort((a, b) => comparePosition(position(a), position(b)))
            .slice(0, limitValue(limit, 200))
    }

    async getMessagesAfterPositionAsync(sessionId: string, limit: number, after: MessagePosition, until?: MessagePosition): Promise<StoredMessage[]> {
        const safeLimit = limitValue(limit, 200)
        const maxSeq = await this.getMaxSeqForReadAsync(sessionId)
        return await readMessagesAfterPositionWindow(maxSeq, safeLimit, after, until, (range) => this.sessionMessagesBySeqRangeAsync(sessionId, range))
    }

    getNewestMessagePosition(sessionId: string): MessagePosition | null {
        const newest = this.sessionMessages(sessionId)
            .sort((a, b) => -comparePosition(position(a), position(b)))[0]
        return newest ? position(newest) : null
    }

    async getNewestMessagePositionAsync(sessionId: string): Promise<MessagePosition | null> {
        const newest = (await this.getMessagesByPositionAsync(sessionId, 1))[0]
        return newest ? position(newest) : null
    }

    getMessageEpoch(sessionId: string): number {
        return (this.rows('message_epochs') as EpochRow[]).find((row) => row.session_id === sessionId)?.epoch ?? 0
    }

    async getMessageEpochAsync(sessionId: string): Promise<number> {
        const rows = await this.latestRowsAsync('message_epochs', messageEpochQuery(sessionId), 100)
        return rows.map((row) => ({
            session_id: String(row.session_id),
            epoch: Number(row.epoch)
        })).find((row) => row.session_id === sessionId)?.epoch ?? 0
    }

    bumpMessageEpoch(sessionId: string): number {
        const epoch = this.getMessageEpoch(sessionId) + 1
        this.append('message_epochs', sessionId, 'upsert', { session_id: sessionId, epoch })
        return epoch
    }

    getLocalMessageStates(sessionId: string, localIds: string[]): LocalMessageState[] {
        return localMessageStates(this.getAllMessages(sessionId), localIds)
    }

    async getLocalMessageStatesAsync(sessionId: string, localIds: string[]): Promise<LocalMessageState[]> {
        const wantedIds = [...new Set(localIds)].filter(Boolean)
        if (wantedIds.length === 0) return []
        const rows = await this.latestRowsAsync('messages', {
            bool: {
                filter: [
                    { term: { table: 'messages' } },
                    sessionFilter(sessionId),
                    localIdsFilter(wantedIds)
                ]
            }
        }, Number.POSITIVE_INFINITY)
        return localMessageStates(rows.map(rowToStored).filter((message) => message.sessionId === sessionId), wantedIds)
    }

    getUninvokedLocalMessages(sessionId: string): StoredMessage[] {
        return uninvokedLocalMessages(this.getAllMessages(sessionId))
    }

    async getUninvokedLocalMessagesAsync(sessionId: string): Promise<StoredMessage[]> {
        return uninvokedLocalMessages(await this.sessionMessagesAsync(sessionId))
    }

    getMatureScheduledMessages(beforeTime: number): StoredMessage[] {
        const rows = this.latestRows('messages', matureScheduledMessagesQuery(beforeTime), ELASTIC_SCHEDULED_SEARCH_SIZE)
        return matureScheduledMessages(rows.map(rowToStored), beforeTime)
    }

    async getMatureScheduledMessagesAsync(beforeTime: number): Promise<StoredMessage[]> {
        const rows = await this.latestRowsAsync('messages', matureScheduledMessagesQuery(beforeTime), ELASTIC_SCHEDULED_SEARCH_SIZE)
        return matureScheduledMessages(rows.map(rowToStored), beforeTime)
    }

    getImmediateQueuedLocalMessages(sessionId: string): StoredMessage[] {
        return immediateQueuedLocalMessages(this.getAllMessages(sessionId))
    }

    async getImmediateQueuedLocalMessagesAsync(sessionId: string): Promise<StoredMessage[]> {
        return immediateQueuedLocalMessages(await this.sessionMessagesAsync(sessionId))
    }

    countFutureScheduledLocalMessages(sessionId: string, now: number = Date.now()): number {
        void sessionId
        void now
        // Session lists call this synchronously. Per-session ES queries can block login/home.
        // Mature scheduled delivery uses the async path; this only affects list badges.
        return 0
    }

    countFutureScheduledBySessionIds(sessionIds: string[], now: number = Date.now()): Map<string, number> {
        void sessionIds
        void now
        return new Map()
    }

    minFutureScheduledAtBySessionIds(sessionIds: string[], now: number = Date.now()): Map<string, number> {
        void sessionIds
        void now
        return new Map()
    }

    countMessages(sessionId: string): number {
        return this.sessionMessages(sessionId).length
    }

    async countMessagesAsync(sessionId: string): Promise<number> {
        return (await this.sessionMessagesAsync(sessionId, Number.POSITIVE_INFINITY)).length
    }

    lookupQueuedMessage(sessionId: string, messageId: string): LookupQueuedMessageResult {
        return lookupQueuedMessageInRows(this.sessionMessages(sessionId), messageId)
    }

    async lookupQueuedMessageAsync(sessionId: string, messageId: string): Promise<LookupQueuedMessageResult> {
        const rows = await this.latestRowsAsync('messages', {
            bool: {
                filter: [
                    { term: { table: 'messages' } },
                    sessionFilter(sessionId),
                    messageIdentityFilter(messageId)
                ]
            }
        }, Number.POSITIVE_INFINITY)
        return lookupQueuedMessageInRows(rows.map(rowToStored).filter((message) => message.sessionId === sessionId), messageId)
    }

    cancelQueuedMessage(sessionId: string, messageId: string): CancelQueuedMessageResult {
        const lookup = this.lookupQueuedMessage(sessionId, messageId)
        if (lookup.status === 'absent') return { status: 'cancelled', localId: null }
        if (lookup.status === 'invoked') return lookup
        this.appendMany([deleteQueuedMessageOp(lookup.resolvedId, sessionId, lookup.localId)])
        this.bumpMessageEpoch(sessionId)
        return { status: 'cancelled', localId: lookup.localId }
    }

    deleteQueuedMessageById(sessionId: string, messageId: string): boolean {
        const lookup = this.lookupQueuedMessage(sessionId, messageId)
        if (lookup.status !== 'queued') return false
        this.appendMany([deleteQueuedMessageOp(lookup.resolvedId, sessionId, lookup.localId)])
        this.bumpMessageEpoch(sessionId)
        return true
    }

    async deleteQueuedMessageByIdAsync(sessionId: string, messageId: string): Promise<boolean> {
        const lookup = await this.lookupQueuedMessageAsync(sessionId, messageId)
        if (lookup.status !== 'queued') return false
        await this.appendManyAsync([
            deleteQueuedMessageOp(lookup.resolvedId, sessionId, lookup.localId),
            { table: 'message_epochs', rowKey: sessionId, op: 'upsert', row: { session_id: sessionId, epoch: await this.getMessageEpochAsync(sessionId) + 1 } }
        ])
        return true
    }

    markMessagesInvoked(sessionId: string, localIds: string[], invokedAt: number): number {
        const changedMessages = markInvokedMessages(this.getAllMessages(sessionId), localIds, invokedAt)
        this.appendMany(upsertMessageOps(changedMessages))
        return changedMessages.length
    }

    async markMessagesInvokedAsync(sessionId: string, localIds: string[], invokedAt: number): Promise<number> {
        const wantedIds = [...new Set(localIds)].filter(Boolean)
        if (wantedIds.length === 0) return 0
        const rows = await this.latestRowsAsync('messages', {
            bool: {
                filter: [
                    { term: { table: 'messages' } },
                    sessionFilter(sessionId),
                    localIdsFilter(wantedIds)
                ]
            }
        }, Number.POSITIVE_INFINITY)
        const changedMessages = markInvokedMessages(rows.map(rowToStored).filter((message) => message.sessionId === sessionId), wantedIds, invokedAt)
        await this.appendManyAsync(upsertMessageOps(changedMessages))
        return changedMessages.length
    }

    mergeSessionMessages(fromSessionId: string, toSessionId: string): { moved: number; oldMaxSeq: number; newMaxSeq: number } {
        if (fromSessionId === toSessionId) return { moved: 0, oldMaxSeq: 0, newMaxSeq: 0 }
        const plan = planMergeSessionMessages(
            fromSessionId,
            toSessionId,
            this.getAllMessages(fromSessionId),
            this.getAllMessages(toSessionId)
        )
        this.appendMany(mergeSessionMessageOps(plan))
        if (plan.moved > 0) {
            this.bumpMessageEpoch(fromSessionId)
            this.bumpMessageEpoch(toSessionId)
        }
        return { moved: plan.moved, oldMaxSeq: plan.oldMaxSeq, newMaxSeq: plan.newMaxSeq }
    }

    async mergeSessionMessagesAsync(fromSessionId: string, toSessionId: string): Promise<{ moved: number; oldMaxSeq: number; newMaxSeq: number }> {
        if (fromSessionId === toSessionId) return { moved: 0, oldMaxSeq: 0, newMaxSeq: 0 }
        const [from, to] = await Promise.all([
            this.getAllMessagesAsync(fromSessionId),
            this.getAllMessagesAsync(toSessionId)
        ])
        const plan = planMergeSessionMessages(fromSessionId, toSessionId, from, to)
        const ops = mergeSessionMessageOps(plan)
        if (plan.moved > 0) {
            ops.push(
                { table: 'message_epochs', rowKey: fromSessionId, op: 'upsert', row: { session_id: fromSessionId, epoch: await this.getMessageEpochAsync(fromSessionId) + 1 } },
                { table: 'message_epochs', rowKey: toSessionId, op: 'upsert', row: { session_id: toSessionId, epoch: await this.getMessageEpochAsync(toSessionId) + 1 } },
                this.counterOp(toSessionId, plan.oldMaxSeq + plan.newMaxSeq)
            )
        }
        await this.appendManyAsync(ops)
        return { moved: plan.moved, oldMaxSeq: plan.oldMaxSeq, newMaxSeq: plan.newMaxSeq }
    }

    deleteMessagesForSession(sessionId: string): void {
        this.appendMany(deleteMessagesForSessionOps(sessionId, this.sessionMessages(sessionId)))
    }

    async deleteMessagesForSessionAsync(sessionId: string): Promise<void> {
        await this.appendManyAsync(deleteMessagesForSessionOps(sessionId, await this.getAllMessagesAsync(sessionId)))
    }

    deleteMessagesForSessions(sessionIds: string[]): void {
        for (const id of sessionIds) this.deleteMessagesForSession(id)
    }

    async deleteMessagesForSessionsAsync(sessionIds: string[]): Promise<void> {
        if (sessionIds.length === 0) return
        const messagesBySession = await Promise.all(sessionIds.map((id) => this.getAllMessagesAsync(id)))
        await this.appendManyAsync(deleteMessagesForSessionsOps(sessionIds, messagesBySession))
    }
}
