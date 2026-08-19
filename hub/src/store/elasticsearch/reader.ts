import {
    ELASTIC_SEARCH_PAGE_SIZE,
    ELASTIC_SEARCH_SIZE
} from './constants'
import {
    canonicalRowKey,
    elasticMessageSourceFields
} from './codec'
import type { ElasticsearchClient } from './client'
import type {
    EsDocument,
    EsOp,
    EsTable
} from './types'

export class ElasticsearchReader {
    constructor(private readonly client: ElasticsearchClient) {}

    latestRows(table: EsTable, query: Record<string, unknown>, size = ELASTIC_SEARCH_SIZE): Record<string, unknown>[] {
        const latest = new Map<string, { key: string; op: EsOp; versionAt: number; row?: Record<string, unknown> }>()
        let searchAfter: unknown[] | undefined
        let seen = 0
        while (seen < size) {
            const pageSize = Math.min(ELASTIC_SEARCH_PAGE_SIZE, size - seen)
            const payload = this.client.request('POST', `${encodeURIComponent(this.client.index)}/_search`, {
                size: pageSize,
                track_total_hits: false,
                _source: elasticMessageSourceFields(),
                query,
                sort: [{ version_at: 'asc' }, { row_key: 'asc' }, { op: 'asc' }],
                ...(searchAfter ? { search_after: searchAfter } : {})
            }, new Set([200, 404])) as { hits?: { hits?: Array<{ _source?: EsDocument; sort?: unknown[] }> } } | null
            const hits = payload?.hits?.hits ?? []
            if (hits.length === 0) break
            seen += hits.length
            for (const hit of hits) {
                this.captureLatestRow(latest, table, hit._source)
            }
            searchAfter = hits[hits.length - 1]?.sort
            if (hits.length < pageSize || !searchAfter) break
        }

        return this.materializeRows(latest)
    }

    async latestRowsAsync(table: EsTable, query: Record<string, unknown>, size = ELASTIC_SEARCH_SIZE): Promise<Record<string, unknown>[]> {
        const latest = new Map<string, { key: string; op: EsOp; versionAt: number; row?: Record<string, unknown> }>()
        let searchAfter: unknown[] | undefined
        let seen = 0
        while (seen < size) {
            const pageSize = Math.min(ELASTIC_SEARCH_PAGE_SIZE, size - seen)
            const payload = await this.client.requestAsync<{ hits?: { hits?: Array<{ _source?: EsDocument; sort?: unknown[] }> } }>('POST', `${encodeURIComponent(this.client.index)}/_search`, {
                size: pageSize,
                track_total_hits: false,
                _source: elasticMessageSourceFields(),
                query,
                sort: [{ version_at: 'asc' }, { row_key: 'asc' }, { op: 'asc' }],
                ...(searchAfter ? { search_after: searchAfter } : {})
            }, new Set([200, 404]))
            if (!payload) return []
            const hits = payload.hits?.hits ?? []
            if (hits.length === 0) break
            seen += hits.length
            for (const hit of hits) {
                this.captureLatestRow(latest, table, hit._source)
            }
            searchAfter = hits[hits.length - 1]?.sort
            if (hits.length < pageSize || !searchAfter) break
        }

        return this.materializeRows(latest)
    }

    private captureLatestRow(
        latest: Map<string, { key: string; op: EsOp; versionAt: number; row?: Record<string, unknown> }>,
        table: EsTable,
        source: EsDocument | undefined
    ): void {
        if (!source || source.table !== table) return
        const row = source.row ?? (() => {
            const { '@timestamp': _timestamp, table: _table, row_key: _rowKey, op: _op, version_at: _versionAt, ...rest } = source as unknown as Record<string, unknown>
            return rest
        })()
        const key = canonicalRowKey(table, row as Record<string, unknown>, source.row_key)
        if (!key) return
        const versionAt = Number(source.version_at ?? Date.parse(source['@timestamp']) ?? 0)
        const op = source.op ?? 'upsert'
        const previous = latest.get(key)
        if (!previous || versionAt >= previous.versionAt) {
            latest.set(key, { key, op, versionAt, row: row as Record<string, unknown> })
        }
    }

    private materializeRows(
        latest: Map<string, { key: string; op: EsOp; versionAt: number; row?: Record<string, unknown> }>
    ): Record<string, unknown>[] {
        return [...latest.values()]
            .filter((doc) => doc.op !== 'delete' && doc.row)
            .map((doc) => doc.row!)
    }
}
