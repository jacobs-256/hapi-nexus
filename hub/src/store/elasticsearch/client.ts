import { ELASTIC_CURL_TIMEOUT_SECONDS } from './constants'
import type { ElasticsearchTarget } from './types'

const DEFAULT_OK_STATUSES = new Set([200, 201])

const DEFAULT_INDEX_MAPPINGS = {
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
}

export class ElasticsearchClient {
    private indexEnsured = false

    constructor(private readonly target: ElasticsearchTarget) {}

    get index(): string {
        return this.target.index
    }

    request(method: string, path: string, body?: unknown, okStatuses = DEFAULT_OK_STATUSES): unknown {
        void body
        void okStatuses
        throw new Error(`Synchronous Elasticsearch message-store access is disabled: ${method} ${path}. Use the async message-store API instead.`)
    }

    bulkRequest(lines: string[]): void {
        if (lines.length === 0) return
        throw new Error('Synchronous Elasticsearch bulk writes are disabled. Use appendManyAsync/bulkRequestAsync instead.')
    }

    async requestAsync<T = unknown>(method: string, path: string, body?: unknown, okStatuses = DEFAULT_OK_STATUSES): Promise<T | null> {
        const response = await this.fetchWithTimeout(path, {
            method,
            headers: this.fetchHeaders(),
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }, `${method} ${path}`)
        const text = await response.text()
        if (!okStatuses.has(response.status)) {
            throw new Error(`Elasticsearch ${method} ${path} failed: ${response.status} ${text}`)
        }
        if (response.status === 404) return null
        if (!text.trim()) return null
        return JSON.parse(text) as T
    }

    async bulkRequestAsync(lines: string[]): Promise<void> {
        if (lines.length === 0) return
        const response = await this.fetchWithTimeout('_bulk?refresh=true', {
            method: 'POST',
            headers: this.fetchHeaders('application/x-ndjson'),
            body: `${lines.join('\n')}\n`
        }, 'bulk write')
        if (!response.ok) {
            throw new Error(`Elasticsearch bulk write failed: ${response.status} ${await response.text()}`)
        }
        const text = await response.text()
        if (!text.trim()) return
        const payload = JSON.parse(text) as {
            errors?: boolean
            items?: Array<Record<string, { status?: number; error?: { type?: string; reason?: string } | string }>>
        }
        if (!payload.errors) return
        const failedItem = payload.items?.find((item) => Object.values(item)[0]?.error)
        const failed = failedItem ? Object.values(failedItem)[0] : undefined
        const error = failed?.error
        const reason = typeof error === 'string' ? error : (error?.reason ?? error?.type ?? 'unknown bulk item error')
        throw new Error(`Elasticsearch bulk write failed: ${failed?.status ?? 'unknown'} ${reason}`)
    }

    ensureIndexOnce(): void {
        if (this.indexEnsured) return
        this.indexEnsured = true
        try {
            this.request('HEAD', encodeURIComponent(this.index), undefined, new Set([200, 403]))
            return
        } catch {
            // Continue to create. Low-privilege keys may fail here; the first write will surface the real error.
        }
        try {
            this.request('PUT', encodeURIComponent(this.index), DEFAULT_INDEX_MAPPINGS, new Set([200, 201, 400, 403]))
        } catch {
        }
    }

    async ensureIndexOnceAsync(): Promise<void> {
        if (this.indexEnsured) return
        this.indexEnsured = true
        try {
            await this.requestAsync('HEAD', encodeURIComponent(this.index), undefined, new Set([200, 403]))
            return
        } catch {
        }
        try {
            await this.requestAsync('PUT', encodeURIComponent(this.index), DEFAULT_INDEX_MAPPINGS, new Set([200, 201, 400, 403]))
        } catch {
        }
    }

    private baseUrl(path: string): string {
        return `${this.target.url.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
    }

    private fetchHeaders(contentType = 'application/json'): Headers {
        const headers = new Headers({ 'content-type': contentType })
        if (this.target.apiKey) {
            headers.set('authorization', `ApiKey ${this.target.apiKey}`)
        } else if (this.target.username || this.target.password) {
            const token = Buffer.from(`${this.target.username ?? ''}:${this.target.password ?? ''}`).toString('base64')
            headers.set('authorization', `Basic ${token}`)
        }
        return headers
    }

    private async fetchWithTimeout(path: string, init: RequestInit, action: string): Promise<Response> {
        const controller = new AbortController()
        const timeoutMs = Number.isFinite(ELASTIC_CURL_TIMEOUT_SECONDS) && ELASTIC_CURL_TIMEOUT_SECONDS > 0
            ? ELASTIC_CURL_TIMEOUT_SECONDS * 1000
            : 300_000
        const timeout = setTimeout(() => controller.abort(), timeoutMs)
        try {
            return await fetch(this.baseUrl(path), { ...init, signal: controller.signal })
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(`Elasticsearch ${action} timed out after ${Math.round(timeoutMs / 1000)}s`)
            }
            throw error
        } finally {
            clearTimeout(timeout)
        }
    }
}
