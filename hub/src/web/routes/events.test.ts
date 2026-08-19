import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

import type { SSEManager } from '../../sse/sseManager'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { VisibilityTracker } from '../../visibility/visibilityTracker'
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

    it('treats stale visibility subscription ids as a successful no-op', async () => {
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            c.set('userId', 2)
            await next()
        })
        app.route('/api', createEventsRoutes(
            () => null,
            () => null,
            () => new VisibilityTracker()
        ))

        const response = await app.request('/api/visibility', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ subscriptionId: 'stale-subscription', visibility: 'visible' })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: false, reason: 'subscription-not-found' })
    })
})
