import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../index'
import type { StorageConfig } from '@hapi/protocol/storage'
import { ElasticsearchMessageStore } from '../../elasticsearch'

const originalFetch = globalThis.fetch
type FetchInput = Parameters<typeof fetch>[0]

afterEach(() => {
    globalThis.fetch = originalFetch
})

function elasticStorageConfig(): StorageConfig {
    return {
        core: { backend: 'sqlite', sqlite: { path: ':memory:' } },
        conversation: {
            backend: 'elasticsearch',
            elasticsearch: {
                url: 'http://elastic.example',
                index: 'hapi-conversations'
            }
        }
    }
}

function elasticStorageConfigWithSqliteCore(path: string): StorageConfig {
    return {
        core: { backend: 'sqlite', sqlite: { path } },
        conversation: {
            backend: 'elasticsearch',
            elasticsearch: {
                url: 'http://elastic.example',
                index: 'hapi-conversations'
            }
        }
    }
}

function okJson(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
    })
}

describe('Elasticsearch external conversation storage', () => {
    it('fails fast instead of running blocking synchronous Elasticsearch reads', () => {
        const config = elasticStorageConfig()
        if (config.conversation.backend !== 'elasticsearch') throw new Error('expected Elasticsearch config')
        const store = new ElasticsearchMessageStore(config.conversation.elasticsearch)
        expect(() => store.getMessages('session-1')).toThrow('Synchronous Elasticsearch message-store access is disabled')
    })

    it('exports data-stream-compatible bulk create documents with @timestamp', async () => {
        const bulkBodies: string[] = []
        const methods: string[] = []
        globalThis.fetch = mock(async (input: FetchInput, init?: RequestInit) => {
            const url = String(input)
            methods.push(init?.method ?? 'GET')
            if (init?.method === 'HEAD') return new Response(null, { status: 403 })
            if (init?.method === 'PUT') return new Response('index creation should be skipped for pre-provisioned targets', { status: 500 })
            if (url.includes('/_delete_by_query')) return new Response(JSON.stringify({ error: 'missing on first export' }), { status: 404 })
            if (url.endsWith('/_bulk')) {
                bulkBodies.push(String(init?.body ?? ''))
                return okJson({ errors: false, items: [] })
            }
            if (url.endsWith('/_refresh')) return okJson({ refreshed: true })
            return new Response(`unexpected ${url}`, { status: 500 })
        }) as unknown as typeof fetch

        const store = new Store(':memory:')
        try {
            const session = store.sessions.getOrCreateSession('elastic-export', { path: '/tmp/elastic-export' }, null, 'default')
            const message = store.messages.addMessage(session.id, { role: 'agent', content: 'hello' })
            store.messages.bumpMessageEpoch(session.id)

            await expect(store.exportExternalSnapshot(elasticStorageConfig())).resolves.toEqual({
                'conversation.message_counters': 1,
                'conversation.message_epochs': 1,
                'conversation.messages': 1
            })

            expect(bulkBodies).toHaveLength(3)
            expect(methods).not.toContain('PUT')
            const documents: Array<Record<string, unknown>> = []
            for (const body of bulkBodies) {
                const lines = body.trim().split('\n')
                expect(lines).toHaveLength(2)

                const action = JSON.parse(lines[0]) as Record<string, { _index?: string; _id?: string }>
                expect(action.create?._index).toBe('hapi-conversations')
                expect(action.create?._id).toBeString()
                expect('index' in action).toBe(false)

                const document = JSON.parse(lines[1]) as Record<string, unknown>
                expect(typeof document['@timestamp']).toBe('string')
                expect(Number.isNaN(Date.parse(String(document['@timestamp'])))).toBe(false)
                documents.push(document)
            }

            const messageDocument = documents.find((document) => document.table === 'messages')
            expect(messageDocument?.id).toBe(message.id)
            expect(messageDocument?.['@timestamp']).toBe(new Date(message.createdAt).toISOString())

            const epochDocument = documents.find((document) => document.table === 'message_epochs')
            expect(epochDocument?.session_id).toBe(session.id)
            expect(typeof epochDocument?.['@timestamp']).toBe('string')

            const counterDocument = documents.find((document) => document.table === 'message_counters')
            expect(counterDocument?.session_id).toBe(session.id)
            expect(counterDocument?.max_seq).toBe(message.seq)
        } finally {
            store.close()
        }
    })

    it('fails strict export when Elasticsearch reports bulk item errors', async () => {
        globalThis.fetch = mock(async (input: FetchInput, init?: RequestInit) => {
            const url = String(input)
            if (init?.method === 'HEAD') return new Response(null, { status: 200 })
            if (init?.method === 'PUT') return okJson({ acknowledged: true })
            if (url.includes('/_delete_by_query')) return okJson({ deleted: 0 })
            if (url.endsWith('/_bulk')) {
                return okJson({
                    errors: true,
                    items: [{
                        create: {
                            status: 400,
                            error: {
                                type: 'mapper_parsing_exception',
                                reason: '@timestamp is required'
                            }
                        }
                    }]
                })
            }
            return new Response(`unexpected ${url}`, { status: 500 })
        }) as unknown as typeof fetch

        const store = new Store(':memory:')
        try {
            const session = store.sessions.getOrCreateSession('elastic-fail', { path: '/tmp/elastic-fail' }, null, 'default')
            store.messages.addMessage(session.id, { role: 'agent', content: 'hello' })

            await expect(store.exportExternalSnapshot(elasticStorageConfig())).rejects.toThrow('@timestamp is required')
        } finally {
            store.close()
        }
    })

    it('does not import Elasticsearch into a SQLite mirror when Elasticsearch is the direct conversation store', async () => {
        const searchBodies: Array<Record<string, unknown>> = []
        globalThis.fetch = mock(async (input: FetchInput, init?: RequestInit) => {
            const url = String(input)
            if (init?.method === 'HEAD') return new Response(null, { status: 200 })
            if (url.endsWith('/_search')) {
                const body = JSON.parse(String(init?.body ?? '{}')) as {
                    query?: { term?: { table?: string } }
                }
                searchBodies.push(body as unknown as Record<string, unknown>)
                const table = body.query?.term?.table
                if (table === 'messages') {
                    return okJson({
                        hits: {
                            hits: [{
                                _source: {
                                    table: 'messages',
                                    '@timestamp': '2026-08-14T03:00:00.000Z',
                                    id: 'message-1',
                                    session_id: 'session-1',
                                    content: JSON.stringify({ role: 'agent', content: 'hello' }),
                                    created_at: 1786676400000,
                                    seq: 1,
                                    local_id: null,
                                    invoked_at: 1786676400000,
                                    scheduled_at: null
                                }
                            }]
                        }
                    })
                }
                if (table === 'message_epochs') {
                    return okJson({
                        hits: {
                            hits: [{
                                _source: {
                                    table: 'message_epochs',
                                    '@timestamp': '2026-08-14T03:00:00.000Z',
                                    session_id: 'session-1',
                                    epoch: 2
                                }
                            }]
                        }
                    })
                }
            }
            return new Response(`unexpected ${url}`, { status: 500 })
        }) as unknown as typeof fetch

        const tmp = mkdtempSync(join(tmpdir(), 'hapi-es-import-'))
        const store = new Store(join(tmp, 'hapi.db'), elasticStorageConfig())
        try {
            await expect(store.initializeExternalStorage()).resolves.toBeUndefined()

            expect(searchBodies).toHaveLength(0)
        } finally {
            store.close()
            rmSync(tmp, { recursive: true, force: true })
        }
    })

    it('exports from the legacy SQLite file when Elasticsearch is already the active conversation store', async () => {
        const bulkBodies: string[] = []
        globalThis.fetch = mock(async (input: FetchInput, init?: RequestInit) => {
            const url = String(input)
            if (init?.method === 'HEAD') return new Response(null, { status: 403 })
            if (url.endsWith('/_bulk')) {
                bulkBodies.push(String(init?.body ?? ''))
                return okJson({ errors: false, items: [] })
            }
            if (url.endsWith('/_refresh')) return okJson({ refreshed: true })
            return new Response(`unexpected ${url}`, { status: 500 })
        }) as unknown as typeof fetch

        const tmp = mkdtempSync(join(tmpdir(), 'hapi-es-direct-export-'))
        const dbPath = join(tmp, 'hapi.db')
        const legacy = new Store(dbPath)
        const session = legacy.sessions.getOrCreateSession('legacy-export', { path: '/tmp/legacy-export' }, null, 'default')
        legacy.messages.addMessage(session.id, { role: 'agent', content: 'legacy hello' })
        legacy.close()

        const config = elasticStorageConfigWithSqliteCore(dbPath)
        const store = new Store(dbPath, config)
        try {
            await expect(store.exportExternalSnapshot(config)).resolves.toEqual({
                'conversation.message_counters': 1,
                'conversation.message_epochs': 0,
                'conversation.messages': 1
            })
            expect(bulkBodies).toHaveLength(2)
            expect(bulkBodies[0]).toContain('legacy hello')
        } finally {
            store.close()
            rmSync(tmp, { recursive: true, force: true })
        }
    })
})
