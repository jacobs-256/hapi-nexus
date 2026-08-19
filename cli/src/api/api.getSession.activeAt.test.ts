import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configuration } from '@/configuration'

const axiosGetMock = vi.hoisted(() => vi.fn())

vi.mock('axios', () => ({
    default: {
        get: axiosGetMock,
        post: vi.fn()
    }
}))

vi.mock('@/api/auth', () => ({
    getAuthToken: () => 'cli-token'
}))

import { ApiClient } from './api'

describe('ApiClient.getSession activeAt coerce', () => {
    const now = 1_710_000_000_000

    beforeEach(() => {
        configuration._setApiUrl('https://hapi.example.com')
        configuration._setExtraHeaders({})
        axiosGetMock.mockReset()
    })

    it('accepts hub payloads with null activeAt without throwing', async () => {
        axiosGetMock.mockResolvedValue({
            data: {
                session: {
                    id: '11111111-1111-4111-8111-111111111111',
                    namespace: 'default',
                    seq: 1,
                    createdAt: now,
                    updatedAt: now,
                    active: false,
                    activeAt: null,
                    metadata: {
                        path: '/tmp/project',
                        host: 'test-host'
                    },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 0,
                    thinking: false,
                    thinkingAt: now,
                    todos: [],
                    model: null,
                    modelReasoningEffort: null,
                    effort: null,
                    serviceTier: null
                }
            }
        })

        const client = await ApiClient.create()
        const session = await client.getSession('11111111-1111-4111-8111-111111111111')

        expect(session.activeAt).toBe(0)
        expect(typeof session.activeAt).toBe('number')
    })

    it('tolerates older MySQL-shaped session payloads and drops invalid metadata', async () => {
        axiosGetMock.mockResolvedValue({
            data: {
                session: {
                    id: '22222222-2222-4222-8222-222222222222',
                    namespace: 'default',
                    projectId: null,
                    createdByUserId: '42',
                    seq: '7',
                    createdAt: String(now),
                    updatedAt: String(now + 1),
                    active: '0',
                    activeAt: String(now + 2),
                    metadata: {
                        path: '/tmp/project'
                    },
                    metadataVersion: '3',
                    agentState: undefined,
                    agentStateVersion: '4',
                    thinking: 0,
                    thinkingAt: '0',
                    todos: 'not-a-todo-list',
                    model: null,
                    modelReasoningEffort: null,
                    effort: null,
                    serviceTier: null,
                    permissionMode: 'not-a-mode',
                    collaborationMode: 'not-a-mode'
                }
            }
        })

        const client = await ApiClient.create()
        const session = await client.getSession('22222222-2222-4222-8222-222222222222')

        expect(session.createdByUserId).toBe(42)
        expect(session.seq).toBe(7)
        expect(session.active).toBe(false)
        expect(session.activeAt).toBe(now + 2)
        expect(session.metadata).toBeNull()
        expect(session.agentState).toBeNull()
        expect(session.todos).toBeUndefined()
        expect(session.permissionMode).toBeUndefined()
        expect(session.collaborationMode).toBeUndefined()
    })

    it('includes the invalid field path when core session fields are missing', async () => {
        axiosGetMock.mockResolvedValue({
            data: {
                session: {
                    namespace: 'default'
                }
            }
        })

        const client = await ApiClient.create()
        await expect(client.getSession('missing-id')).rejects.toThrow('session.id')
    })
})
