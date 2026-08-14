import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'
import type { StorageConfig } from '@hapi/protocol/storage'

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

function okJson(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
    })
}

describe('Elasticsearch external conversation storage', () => {
    it('exports data-stream-compatible bulk create documents with @timestamp', async () => {
        const bulkBodies: string[] = []
        const methods: string[] = []
        globalThis.fetch = mock(async (input: FetchInput, init?: RequestInit) => {
            const url = String(input)
            methods.push(init?.method ?? 'GET')
            if (init?.method === 'HEAD') return new Response(null, { status: 403 })
            if (init?.method === 'PUT') return new Response('index creation should be skipped for pre-provisioned targets', { status: 500 })
            if (url.includes('/_delete_by_query')) return new Response(JSON.stringify({ error: 'missing on first export' }), { status: 404 })
            if (url.endsWith('/_bulk?refresh=true')) {
                bulkBodies.push(String(init?.body ?? ''))
                return okJson({ errors: false, items: [] })
            }
            return new Response(`unexpected ${url}`, { status: 500 })
        }) as unknown as typeof fetch

        const store = new Store(':memory:')
        try {
            const session = store.sessions.getOrCreateSession('elastic-export', { path: '/tmp/elastic-export' }, null, 'default')
            const message = store.messages.addMessage(session.id, { role: 'agent', content: 'hello' })
            store.messages.bumpMessageEpoch(session.id)

            await expect(store.exportExternalSnapshot(elasticStorageConfig())).resolves.toEqual({
                'conversation.message_epochs': 1,
                'conversation.messages': 1
            })

            expect(bulkBodies).toHaveLength(2)
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
            if (url.endsWith('/_bulk?refresh=true')) {
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

    it('imports data-stream documents without sorting on the _id field', async () => {
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

            expect(searchBodies).toHaveLength(2)
            expect(JSON.stringify(searchBodies)).not.toContain('"_id"')
            expect(searchBodies.every((body) => JSON.stringify(body).includes('"_doc"'))).toBe(true)
            expect(store.messages.getAllMessages('session-1')).toEqual([{
                id: 'message-1',
                sessionId: 'session-1',
                content: { role: 'agent', content: 'hello' },
                createdAt: 1786676400000,
                seq: 1,
                localId: null,
                invokedAt: 1786676400000,
                scheduledAt: null
            }])
            expect(store.messages.getMessageEpoch('session-1')).toBe(2)
        } finally {
            store.close()
            rmSync(tmp, { recursive: true, force: true })
        }
    })
})
