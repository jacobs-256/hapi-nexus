import type { StoredMessage } from '../types'
import type { EsWriteOperation } from './types'
import { toMessageRow } from './codec'
import { upsertMessageOps } from './messageQueue'

export type MergeSessionMessagesPlan = {
    moved: number
    oldMaxSeq: number
    newMaxSeq: number
    messagesToUpsert: StoredMessage[]
}

export function planMergeSessionMessages(
    fromSessionId: string,
    toSessionId: string,
    from: StoredMessage[],
    to: StoredMessage[]
): MergeSessionMessagesPlan {
    if (fromSessionId === toSessionId) {
        return { moved: 0, oldMaxSeq: 0, newMaxSeq: 0, messagesToUpsert: [] }
    }

    const oldMaxSeq = maxSeq(from)
    const newMaxSeq = maxSeq(to)
    const messagesToUpsert: StoredMessage[] = []

    if (newMaxSeq > 0 && oldMaxSeq > 0) {
        messagesToUpsert.push(...to.map((message) => ({ ...message, seq: message.seq + oldMaxSeq })))
    }

    const toLocalIds = new Set(to.map((message) => message.localId).filter((id): id is string => Boolean(id)))
    for (const message of from) {
        const collides = message.localId && toLocalIds.has(message.localId)
        messagesToUpsert.push({
            ...message,
            sessionId: toSessionId,
            localId: collides ? null : message.localId,
            invokedAt: collides ? (message.invokedAt ?? message.createdAt) : message.invokedAt
        })
    }

    return { moved: from.length, oldMaxSeq, newMaxSeq, messagesToUpsert }
}

export function mergeSessionMessageOps(plan: MergeSessionMessagesPlan): EsWriteOperation[] {
    return upsertMessageOps(plan.messagesToUpsert)
}

export function deleteMessagesForSessionOps(sessionId: string, messages: StoredMessage[]): EsWriteOperation[] {
    return [
        ...messages.map((message) => ({
            table: 'messages' as const,
            rowKey: message.id,
            op: 'delete' as const,
            row: toMessageRow(message)
        })),
        { table: 'message_epochs' as const, rowKey: sessionId, op: 'delete' as const },
        { table: 'message_counters' as const, rowKey: sessionId, op: 'delete' as const }
    ]
}

export function deleteMessagesForSessionsOps(sessionIds: string[], messagesBySession: StoredMessage[][]): EsWriteOperation[] {
    return [
        ...messagesBySession.flatMap((messages) => messages.map((message) => ({
            table: 'messages' as const,
            rowKey: message.id,
            op: 'delete' as const,
            row: toMessageRow(message)
        }))),
        ...sessionIds.flatMap((id) => [
            { table: 'message_epochs' as const, rowKey: id, op: 'delete' as const },
            { table: 'message_counters' as const, rowKey: id, op: 'delete' as const }
        ])
    ]
}

function maxSeq(messages: StoredMessage[]): number {
    return messages.reduce((max, message) => Math.max(max, message.seq), 0)
}
