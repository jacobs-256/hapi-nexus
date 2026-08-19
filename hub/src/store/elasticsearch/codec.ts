import type { StoredMessage } from '../types'
import type { MessagePosition } from '../messages'
import type { EsTable, MessageRow } from './types'

function safeJsonParse(value: string): unknown {
    try {
        return JSON.parse(value)
    } catch {
        return value
    }
}

export function toStoredMessage(row: MessageRow): StoredMessage {
    return {
        id: row.id,
        sessionId: row.session_id,
        content: safeJsonParse(row.content),
        createdAt: row.created_at,
        seq: row.seq,
        localId: row.local_id,
        invokedAt: row.invoked_at,
        scheduledAt: row.scheduled_at
    }
}

export function toMessageRow(message: StoredMessage): MessageRow {
    return {
        id: message.id,
        session_id: message.sessionId,
        content: JSON.stringify(message.content),
        created_at: message.createdAt,
        seq: message.seq,
        local_id: message.localId,
        invoked_at: message.invokedAt,
        scheduled_at: message.scheduledAt
    }
}

export function rowToStored(row: Record<string, unknown>): StoredMessage {
    return toStoredMessage({
        id: String(row.id),
        session_id: String(row.session_id),
        content: typeof row.content === 'string' ? row.content : JSON.stringify(row.content),
        created_at: Number(row.created_at),
        seq: Number(row.seq),
        local_id: typeof row.local_id === 'string' ? row.local_id : null,
        invoked_at: row.invoked_at === null || row.invoked_at === undefined ? null : Number(row.invoked_at),
        scheduled_at: row.scheduled_at === null || row.scheduled_at === undefined ? null : Number(row.scheduled_at)
    })
}

export function position(message: StoredMessage): MessagePosition {
    return { at: message.invokedAt ?? message.createdAt, seq: message.seq }
}

export function comparePosition(a: MessagePosition, b: MessagePosition): number {
    return a.at !== b.at ? a.at - b.at : a.seq - b.seq
}

export function limitValue(limit: number | undefined, fallback: number): number {
    return Number.isFinite(limit) ? Math.max(1, Math.min(200, Number(limit))) : fallback
}

export function elasticMessageSourceFields(): string[] {
    return [
        '@timestamp',
        'table',
        'row_key',
        'op',
        'version_at',
        'row',
        'id',
        'session_id',
        'content',
        'created_at',
        'seq',
        'local_id',
        'invoked_at',
        'scheduled_at',
        'epoch',
        'max_seq'
    ]
}

export function canonicalRowKey(table: EsTable, row: Record<string, unknown>, sourceRowKey?: string): string {
    if (table === 'messages') {
        const id = row.id ?? (typeof sourceRowKey === 'string' ? sourceRowKey.replace(/^messages:/, '') : '')
        return String(id)
    }
    const sessionId = row.session_id ?? (typeof sourceRowKey === 'string' ? sourceRowKey.replace(/^(message_epochs|message_counters):/, '') : '')
    return String(sessionId)
}
