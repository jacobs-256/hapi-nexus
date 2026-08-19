import type { StoredMessage } from '../types'
import type { LocalMessageState, LookupQueuedMessageResult } from '../messages'
import type { EsWriteOperation } from './types'
import { toMessageRow } from './codec'

export function lookupQueuedMessageInRows(messages: StoredMessage[], messageId: string): LookupQueuedMessageResult {
    const row = messages.find((message) => message.id === messageId || message.localId === messageId)
    if (!row) return { status: 'absent' }
    if (row.invokedAt !== null) return { status: 'invoked', message: row }
    return { status: 'queued', localId: row.localId, resolvedId: row.id, scheduledAt: row.scheduledAt }
}

export function localMessageStates(messages: StoredMessage[], localIds: string[]): LocalMessageState[] {
    const wanted = new Set(localIds)
    return messages
        .filter((message) => message.localId && wanted.has(message.localId))
        .map((message) => ({ localId: message.localId!, invokedAt: message.invokedAt }))
}

export function uninvokedLocalMessages(messages: StoredMessage[]): StoredMessage[] {
    return messages.filter((message) => message.localId !== null && message.invokedAt === null)
}

export function immediateQueuedLocalMessages(messages: StoredMessage[]): StoredMessage[] {
    return messages.filter((message) => message.localId !== null && message.invokedAt === null && message.scheduledAt === null)
}

export function matureScheduledMessages(messages: StoredMessage[], beforeTime: number): StoredMessage[] {
    return messages
        .filter((message) => message.scheduledAt !== null && message.scheduledAt <= beforeTime && message.invokedAt === null)
        .sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0))
}

export function markInvokedMessages(messages: StoredMessage[], localIds: string[], invokedAt: number): StoredMessage[] {
    const wanted = new Set(localIds)
    return messages
        .filter((message) => message.localId && wanted.has(message.localId) && message.invokedAt === null)
        .map((message) => ({ ...message, invokedAt }))
}

export function deleteQueuedMessageOp(resolvedId: string, sessionId: string, localId: string | null): EsWriteOperation {
    return {
        table: 'messages',
        rowKey: resolvedId,
        op: 'delete',
        row: { id: resolvedId, session_id: sessionId, local_id: localId }
    }
}

export function upsertMessageOps(messages: StoredMessage[]): EsWriteOperation[] {
    return messages.map((message) => ({
        table: 'messages',
        rowKey: message.id,
        op: 'upsert',
        row: toMessageRow(message)
    }))
}
