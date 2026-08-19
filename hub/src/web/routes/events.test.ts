import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

import type { SSEManager } from '../../sse/sseManager'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createEventsRoutes } from './events'

describe('events routes', () => {
    it('checks machine ACL before opening a machine-scoped stream', async () => {
        const app = new Hono<WebAppEnv>()
        const engine = {
            resolveMachineAccessForUser: async () => ({ ok: false as const, reason: 'access-denied' as const })
        } as Partial<SyncEngine>

        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            c.set('userId', 2)
            await next()
        })
        app.route('/api', createEventsRoutes(
            () => ({}) as SSEManager,
            () => engine as SyncEngine,
            () => null
        ))

        const response = await app.request('/api/events?machineId=machine-1')

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({ error: 'Machine access denied' })
    })
})
