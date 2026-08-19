import type { Database } from 'bun:sqlite'
import type { StorageConfig } from '@hapi/protocol/storage'
import { CONVERSATION_TABLES, ELASTIC_CONVERSATION_TABLES } from './tables'
import type { ExternalStorageExportOptions } from './types'
import { insertSqliteRows, sqliteRowCount, sqliteRowsBatchNewestFirst, sqliteTableExists } from './sqlite'
import { positiveIntegerEnv } from './env'

type ElasticsearchTarget = Extract<StorageConfig['conversation'], { backend: 'elasticsearch' }>['elasticsearch']

function elasticHeaders(target: ElasticsearchTarget): Headers {
    const headers = new Headers({ 'content-type': 'application/json' })
    if (target.apiKey) {
        headers.set('authorization', `ApiKey ${target.apiKey}`)
    } else if (target.username || target.password) {
        headers.set('authorization', `Basic ${btoa(`${target.username ?? ''}:${target.password ?? ''}`)}`)
    }
    return headers
}

function elasticUrl(target: ElasticsearchTarget, path: string): string {
    return `${target.url.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}


async function elasticFetch(target: ElasticsearchTarget, path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timeoutMs = Number(process.env.HAPI_ELASTICSEARCH_REQUEST_TIMEOUT_MS ?? 300_000)
    const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300_000)
    try {
        return await fetch(elasticUrl(target, path), { ...init, signal: controller.signal })
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`Elasticsearch request timed out after ${Math.round((Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300_000) / 1000)}s: ${init?.method ?? 'GET'} ${path}`)
        }
        throw error
    } finally {
        clearTimeout(timeout)
    }
}


export async function elasticIndexExists(target: ElasticsearchTarget): Promise<boolean> {
    const response = await elasticFetch(target, encodeURIComponent(target.index), {
        method: 'HEAD',
        headers: elasticHeaders(target)
    })
    if (response.status === 404) return false
    if (response.status === 403) return true
    if (!response.ok) {
        throw new Error(`Elasticsearch index check failed: ${response.status} ${await response.text()}`)
    }
    return true
}

async function ensureElasticIndex(target: ElasticsearchTarget): Promise<void> {
    const existing = await elasticFetch(target, encodeURIComponent(target.index), {
        method: 'HEAD',
        headers: elasticHeaders(target)
    })
    if (existing.ok) return
    if (existing.status === 403) {
        // Production deployments often pre-create the index/data stream and give HAPI
        // a low-privilege write key. Continue so the real write permission check happens later.
        return
    }
    if (existing.status !== 404) {
        throw new Error(`Elasticsearch index check failed: ${existing.status} ${await existing.text()}`)
    }

    const response = await elasticFetch(target, encodeURIComponent(target.index), {
        method: 'PUT',
        headers: elasticHeaders(target),
        body: JSON.stringify({
            mappings: {
                dynamic: true,
                properties: {
                    '@timestamp': { type: 'date' },
                    table: { type: 'keyword' },
                    row_key: { type: 'keyword' },
                    op: { type: 'keyword' },
                    version_at: { type: 'date', format: 'epoch_millis' }
                }
            }
        })
    })
    if (!response.ok && response.status !== 400) {
        throw new Error(`Elasticsearch index setup failed: ${response.status} ${await response.text()}`)
    }
}

function elasticRowKey(table: typeof ELASTIC_CONVERSATION_TABLES[number], row: Record<string, unknown>): string {
    if (table === 'messages') return String(row.id ?? `${Date.now()}-${Math.random()}`)
    return String(row.session_id ?? `${Date.now()}-${Math.random()}`)
}

function elasticTimestamp(row: Record<string, unknown>, fallbackNow: number): string {
    const value = row.created_at ?? row.updated_at ?? row.applied_at ?? fallbackNow
    const numeric = typeof value === 'number' ? value : Number(value)
    const timestamp = Number.isFinite(numeric) && numeric > 0 ? numeric : fallbackNow
    return new Date(timestamp).toISOString()
}

async function assertElasticOk(response: Response, action: string): Promise<void> {
    if (!response.ok) {
        throw new Error(`Elasticsearch ${action} failed: ${response.status} ${await response.text()}`)
    }
}

async function assertElasticBulkOk(response: Response): Promise<void> {
    await assertElasticOk(response, 'bulk write')
    const payload = await response.json() as {
        errors?: boolean
        items?: Array<Record<string, { status?: number; error?: { type?: string; reason?: string } | string }>>
    }
    if (!payload.errors) return
    const failedItem = payload.items?.find((item) => {
        const result = Object.values(item)[0]
        if (!result?.error) return false
        // Migration uses deterministic _id values. Timeouts/retries can produce 409
        // for already-written row snapshots; treat those conflicts as idempotent success.
        return result.status !== 409
    })
    if (!failedItem) return
    const result = failedItem ? Object.values(failedItem)[0] : undefined
    const error = result?.error
    const reason = typeof error === 'string' ? error : (error?.reason ?? error?.type ?? 'unknown bulk item error')
    throw new Error(`Elasticsearch bulk write failed: ${result?.status ?? 'unknown'} ${reason}`)
}

const ELASTIC_BULK_MAX_BYTES = positiveIntegerEnv('HAPI_ELASTICSEARCH_BULK_MAX_BYTES', 2 * 1024 * 1024)
const ELASTIC_BULK_MAX_DOCS = positiveIntegerEnv('HAPI_ELASTICSEARCH_BULK_MAX_DOCS', 2000)
const ELASTIC_SQLITE_BATCH_SIZE = positiveIntegerEnv('HAPI_ELASTICSEARCH_SQLITE_BATCH_SIZE', 2000)
const ELASTIC_BACKGROUND_SEGMENT_DOCS = positiveIntegerEnv('HAPI_ELASTICSEARCH_BACKGROUND_SEGMENT_DOCS', 500)

function buildElasticBulkLines(target: ElasticsearchTarget, table: typeof ELASTIC_CONVERSATION_TABLES[number], row: Record<string, unknown>, now: number): string[] {
    const rowKey = elasticRowKey(table, row)
    return [
        JSON.stringify({ create: { _index: target.index, _id: rowKey } }),
        JSON.stringify({
            '@timestamp': elasticTimestamp(row, now),
            table,
            row_key: rowKey,
            op: 'upsert',
            version_at: now,
            ...row,
            row
        })
    ]
}

async function flushElasticBulkLines(target: ElasticsearchTarget, lines: string[]): Promise<void> {
    if (lines.length === 0) return
    try {
        const response = await elasticFetch(target, '_bulk', {
            method: 'POST',
            headers: new Headers({ ...Object.fromEntries(elasticHeaders(target)), 'content-type': 'application/x-ndjson' }),
            body: `${lines.join('\n')}\n`
        })
        await assertElasticBulkOk(response)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const transient = message.includes('timed out')
            || message.includes('failed: 429')
            || message.includes('failed: 502')
            || message.includes('failed: 503')
            || message.includes('failed: 504')
        if (!transient) throw error
        const documentCount = lines.length / 2
        if (documentCount <= 1) throw error
        const middleDocument = Math.floor(documentCount / 2)
        const splitAt = middleDocument * 2
        await flushElasticBulkLines(target, lines.slice(0, splitAt))
        await flushElasticBulkLines(target, lines.slice(splitAt))
    }
}

async function writeElasticBulkChunked(target: ElasticsearchTarget, table: typeof ELASTIC_CONVERSATION_TABLES[number], rows: Array<Record<string, unknown>>): Promise<void> {
    const now = Date.now()
    let lines: string[] = []
    let bytes = 0
    for (const row of rows) {
        const rowLines = buildElasticBulkLines(target, table, row, now)
        const rowBytes = Buffer.byteLength(`${rowLines.join('\n')}\n`, 'utf8')
        if (lines.length > 0 && (bytes + rowBytes > ELASTIC_BULK_MAX_BYTES || lines.length / 2 >= ELASTIC_BULK_MAX_DOCS)) {
            await flushElasticBulkLines(target, lines)
            lines = []
            bytes = 0
        }
        lines.push(...rowLines)
        bytes += rowBytes
    }
    await flushElasticBulkLines(target, lines)
}

function sqliteMessageCounterCount(db: Database): number {
    if (!sqliteTableExists(db, 'messages')) return 0
    const row = db.prepare('SELECT COUNT(*) AS count FROM (SELECT 1 FROM messages GROUP BY session_id)').get() as { count?: number } | undefined
    return row?.count ?? 0
}

function sqliteMessageCountersBatch(db: Database, limit: number, offset: number): Array<Record<string, unknown>> {
    if (!sqliteTableExists(db, 'messages')) return []
    return db.prepare('SELECT session_id, MAX(seq) AS max_seq FROM messages GROUP BY session_id LIMIT ? OFFSET ?').all(limit, offset) as Array<Record<string, unknown>>
}

export async function replaceElasticMessageCounters(
    target: ElasticsearchTarget,
    db: Database,
    options?: ExternalStorageExportOptions
): Promise<number> {
    await ensureElasticIndex(target)
    const total = sqliteMessageCounterCount(db)
    if (total === 0) return 0
    const offsetKey = 'conversation.message_counters'
    let copied = Math.min(options?.initialOffsets?.[offsetKey] ?? 0, total)
    for (let offset = copied; offset < total; offset += ELASTIC_SQLITE_BATCH_SIZE) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        const rows = sqliteMessageCountersBatch(db, ELASTIC_SQLITE_BATCH_SIZE, offset)
        if (rows.length === 0) break
        await writeElasticBulkChunked(target, 'message_counters', rows)
        copied = Math.min(offset + rows.length, total)
        await options?.onProgress?.({
            group: 'conversation',
            table: 'message_counters',
            copiedRows: copied,
            totalRows: total,
            offset: copied
        })
    }
    return total
}

export async function replaceElasticTable(
    target: ElasticsearchTarget,
    db: Database,
    table: typeof CONVERSATION_TABLES[number],
    options?: ExternalStorageExportOptions
): Promise<number> {
    await ensureElasticIndex(target)
    // ES/data stream migration writes append-only versioned documents and avoids
    // delete-by-query, which often needs extra privileges and can block large indices.
    const total = sqliteRowCount(db, table)
    if (total === 0) return 0
    const batchSize = ELASTIC_SQLITE_BATCH_SIZE
    const offsetKey = `conversation.${table}`
    let copied = Math.min(options?.initialOffsets?.[offsetKey] ?? 0, total)
    for (let offset = copied; offset < total; offset += batchSize) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        const rows = sqliteRowsBatchNewestFirst(db, table, batchSize, offset)
        let rowOffset = 0
        while (rowOffset < rows.length) {
            const remainingToUnblock = Math.max(0, 500 - copied)
            const segmentSize = remainingToUnblock > 0
                ? Math.min(remainingToUnblock, rows.length - rowOffset)
                : Math.min(ELASTIC_BACKGROUND_SEGMENT_DOCS, rows.length - rowOffset)
            const segment = rows.slice(rowOffset, rowOffset + segmentSize)
            await writeElasticBulkChunked(target, table, segment)
            rowOffset += segment.length
            copied = Math.min(offset + rowOffset, total)
            await options?.onProgress?.({
                group: 'conversation',
                table,
                copiedRows: copied,
                totalRows: total,
                offset: copied
            })
            await new Promise((resolve) => setTimeout(resolve, 0))
        }
        if (rows.length === 0) break
    }
    const finalTotal = sqliteRowCount(db, table)
    if (finalTotal > total) {
        // After the UI is unblocked, the previous SQLite runtime may still receive
        // new messages. Migration scans newest-first, so sweep the newest delta again.
        const deltaRows = sqliteRowsBatchNewestFirst(db, table, finalTotal - total, 0)
        if (deltaRows.length > 0) {
            await writeElasticBulkChunked(target, table, deltaRows)
            copied = finalTotal
            await options?.onProgress?.({
                group: 'conversation',
                table,
                copiedRows: copied,
                totalRows: finalTotal,
                offset: copied
            })
        }
    }
    return finalTotal
}


export async function refreshElasticIndex(target: ElasticsearchTarget): Promise<void> {
    const response = await elasticFetch(target, `${encodeURIComponent(target.index)}/_refresh`, {
        method: 'POST',
        headers: elasticHeaders(target)
    })
    if (response.status !== 404 && response.status !== 403) {
        await assertElasticOk(response, 'refresh')
    }
}

export async function importElasticTable(target: ElasticsearchTarget, db: Database, table: typeof CONVERSATION_TABLES[number]): Promise<number> {
    const latest = new Map<string, { row?: Record<string, unknown>; op: string; versionAt: number }>()
    let searchAfter: unknown[] | undefined
    while (true) {
        const response = await elasticFetch(target, `${encodeURIComponent(target.index)}/_search`, {
            method: 'POST',
            headers: elasticHeaders(target),
            body: JSON.stringify({
                size: 1000,
                track_total_hits: false,
                query: { term: { table } },
                sort: [{ version_at: 'asc' }, { row_key: 'asc' }, { op: 'asc' }],
                _source: ['@timestamp', 'table', 'row_key', 'op', 'version_at', 'row', 'id', 'session_id', 'content', 'created_at', 'seq', 'local_id', 'invoked_at', 'scheduled_at', 'epoch'],
                ...(searchAfter ? { search_after: searchAfter } : {})
            })
        })
        if (response.status === 404) return 0
        if (!response.ok) {
            throw new Error(`Elasticsearch import failed: ${response.status} ${await response.text()}`)
        }
        const payload = await response.json() as { hits?: { hits?: Array<{ _source?: Record<string, unknown>; sort?: unknown[] }> } }
        const hits = payload.hits?.hits ?? []
        if (hits.length === 0) break
        for (const hit of hits) {
            const source = hit._source ?? {}
            const row = (source.row && typeof source.row === 'object' && !Array.isArray(source.row))
                ? source.row as Record<string, unknown>
                : (() => {
                    const { table: _table, '@timestamp': _timestamp, row_key: _rowKey, op: _op, version_at: _versionAt, ...rest } = source
                    return rest
                })()
            const rowKey = elasticRowKey(table, row)
            const versionAt = Number(source.version_at ?? Date.parse(String(source['@timestamp'] ?? '')) ?? 0)
            const existing = latest.get(rowKey)
            if (!existing || versionAt >= existing.versionAt) {
                latest.set(rowKey, { row, op: String(source.op ?? 'upsert'), versionAt })
            }
        }
        searchAfter = hits[hits.length - 1]?.sort
        if (hits.length < 1000 || !searchAfter) break
    }
    const rows = [...latest.values()]
        .filter((item) => item.op !== 'delete' && item.row)
        .map((item) => item.row!)
    if (rows.length === 0) return 0
    insertSqliteRows(db, table, rows)
    return rows.length
}
