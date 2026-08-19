import type { StorageConfig } from '@hapi/protocol/storage'

export type ElasticsearchTarget = Extract<StorageConfig['conversation'], { backend: 'elasticsearch' }>['elasticsearch']
export type EsTable = 'messages' | 'message_epochs' | 'message_counters'
export type EsOp = 'upsert' | 'delete'

export type EsDocument = {
    '@timestamp': string
    table: EsTable
    row_key: string
    op: EsOp
    version_at: number
    row?: Record<string, unknown>
}

export type MessageRow = {
    id: string
    session_id: string
    content: string
    created_at: number
    seq: number
    local_id: string | null
    invoked_at: number | null
    scheduled_at: number | null
}

export type EpochRow = {
    session_id: string
    epoch: number
}

export type MessageCounterRow = {
    session_id: string
    max_seq: number
}

export type EsWriteOperation = {
    table: EsTable
    rowKey: string
    op: EsOp
    row?: Record<string, unknown>
}
