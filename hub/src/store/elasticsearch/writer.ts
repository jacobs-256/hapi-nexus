import {
    ELASTIC_BULK_MAX_BYTES,
    ELASTIC_BULK_MAX_DOCS
} from './constants'
import type { ElasticsearchClient } from './client'
import type {
    EsDocument,
    EsOp,
    EsTable,
    EsWriteOperation
} from './types'

export class ElasticsearchWriter {
    constructor(private readonly client: ElasticsearchClient) {}

    append(table: EsTable, rowKey: string, op: EsOp, row?: Record<string, unknown>): void {
        this.appendMany([{ table, rowKey, op, row }])
    }

    appendMany(docs: EsWriteOperation[]): void {
        if (docs.length === 0) return
        this.client.ensureIndexOnce()
        for (const lines of this.toBulkLineBatches(docs)) {
            this.client.bulkRequest(lines)
        }
    }

    async appendManyAsync(docs: EsWriteOperation[]): Promise<void> {
        if (docs.length === 0) return
        await this.client.ensureIndexOnceAsync()
        for (const lines of this.toBulkLineBatches(docs)) {
            await this.client.bulkRequestAsync(lines)
        }
    }

    private *toBulkLineBatches(docs: EsWriteOperation[]): Generator<string[]> {
        const now = Date.now()
        let lines: string[] = []
        let bytes = 0

        for (const item of docs) {
            const doc: EsDocument = {
                '@timestamp': new Date(now).toISOString(),
                table: item.table,
                row_key: item.rowKey,
                op: item.op,
                version_at: now,
                ...(item.row ? { row: item.row } : {})
            }
            // Data streams require create semantics; append-only versioned docs make auto IDs safe.
            const docLines = [
                JSON.stringify({ create: { _index: this.client.index } }),
                JSON.stringify(doc)
            ]
            const docBytes = Buffer.byteLength(`${docLines.join('\n')}\n`, 'utf8')
            if (lines.length > 0 && (bytes + docBytes > ELASTIC_BULK_MAX_BYTES || lines.length / 2 >= ELASTIC_BULK_MAX_DOCS)) {
                yield lines
                lines = []
                bytes = 0
            }
            lines.push(...docLines)
            bytes += docBytes
        }

        if (lines.length > 0) {
            yield lines
        }
    }
}
