import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import type { SSEManager } from '../../sse/sseManager'
import { createAppSettingsRoutes } from './appSettings'

function appWithUser(store: Store, options: { userId: number; namespace?: string; authPlatform?: string; getSseManager?: () => SSEManager | null }) {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('userId', options.userId)
        c.set('namespace', options.namespace ?? 'default')
        c.set('authPlatform', options.authPlatform ?? 'local')
        await next()
    })
    app.route('/api', createAppSettingsRoutes(store, { getSseManager: options.getSseManager }))
    return app
}

describe('global composer toolbar settings routes', () => {
    it('returns empty global disabled tools by default', async () => {
        const store = new Store(':memory:')
        try {
            const app = appWithUser(store, { userId: 1 })

            const response = await app.request('/api/settings/composer-toolbar')

            expect(response.status).toBe(200)
            expect(await response.json()).toEqual({ settings: { disabled: [] } })
        } finally {
            store.close()
        }
    })

    it('allows default-namespace admins to update global disabled tools', async () => {
        const store = new Store(':memory:')
        try {
            const admin = store.users.createLocalUser({
                namespace: 'default',
                username: 'admin',
                passwordHash: 'hash',
                role: 'admin'
            })
            const app = appWithUser(store, { userId: admin.id })

            const response = await app.request('/api/settings/composer-toolbar', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ disabled: ['terminal', 'attachment'] })
            })

            expect(response.status).toBe(200)
            expect(await response.json()).toEqual({ settings: { disabled: ['terminal', 'attachment'] } })
            expect(store.appSettings.getJson<{ disabled: string[] }>('composerToolbar', { disabled: [] })).toEqual({
                disabled: ['terminal', 'attachment']
            })
        } finally {
            store.close()
        }
    })

    it('broadcasts global toolbar updates to SSE subscribers', async () => {
        const store = new Store(':memory:')
        try {
            const admin = store.users.createLocalUser({
                namespace: 'default',
                username: 'admin',
                passwordHash: 'hash',
                role: 'admin'
            })
            const broadcasted: unknown[] = []
            const app = appWithUser(store, {
                userId: admin.id,
                getSseManager: () => ({
                    broadcast: (event: unknown) => {
                        broadcasted.push(event)
                    }
                } as unknown as SSEManager)
            })

            const response = await app.request('/api/settings/composer-toolbar', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ disabled: ['terminal'] })
            })

            expect(response.status).toBe(200)
            expect(broadcasted).toEqual([{
                type: 'app-settings-updated',
                data: {
                    key: 'composerToolbar',
                    settings: { disabled: ['terminal'] }
                }
            }])
        } finally {
            store.close()
        }
    })

    it('rejects tenant admins for global updates', async () => {
        const store = new Store(':memory:')
        try {
            const admin = store.users.createLocalUser({
                namespace: 'tenant',
                username: 'admin',
                passwordHash: 'hash',
                role: 'admin'
            })
            const app = appWithUser(store, { userId: admin.id, namespace: 'tenant' })

            const response = await app.request('/api/settings/composer-toolbar', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ disabled: ['terminal'] })
            })

            expect(response.status).toBe(403)
        } finally {
            store.close()
        }
    })
})
