import { Hono, type Context } from 'hono'
import type {
    GlobalComposerToolbarSettings,
    GlobalComposerToolbarSettingsResponse
} from '@hapi/protocol/apiTypes'
import {
    ComposerToolbarItemIdSchema,
    GlobalComposerToolbarSettingsSchema,
    UpdateGlobalComposerToolbarSettingsRequestSchema
} from '@hapi/protocol/apiTypes'
import type { WebAppEnv } from '../middleware/auth'
import type { Store } from '../../store'
import type { SSEManager } from '../../sse/sseManager'

const COMPOSER_TOOLBAR_SETTINGS_KEY = 'composerToolbar'
const DEFAULT_COMPOSER_TOOLBAR_SETTINGS: GlobalComposerToolbarSettings = { disabled: [] }

function hasGlobalSettingsAdminAccess(c: Context<WebAppEnv>, store: Store): boolean {
    const namespace = c.get('namespace')
    if (namespace !== 'default') return false
    if (c.get('authPlatform') === 'owner') return true

    const userId = c.get('userId')
    if (typeof userId !== 'number') return false
    const user = store.users.getUserById(userId, namespace)
    return user?.role === 'admin' && user.disabledAt === null
}

function normalizeComposerToolbarSettings(value: unknown): GlobalComposerToolbarSettings {
    const parsed = GlobalComposerToolbarSettingsSchema.safeParse(value)
    if (!parsed.success) {
        return DEFAULT_COMPOSER_TOOLBAR_SETTINGS
    }
    const seen = new Set<string>()
    return {
        disabled: parsed.data.disabled.filter((item) => {
            if (!ComposerToolbarItemIdSchema.safeParse(item).success || seen.has(item)) {
                return false
            }
            seen.add(item)
            return true
        })
    }
}

function readComposerToolbarSettings(store: Store): GlobalComposerToolbarSettings {
    return normalizeComposerToolbarSettings(
        store.appSettings.getJson(COMPOSER_TOOLBAR_SETTINGS_KEY, DEFAULT_COMPOSER_TOOLBAR_SETTINGS)
    )
}

export function createAppSettingsRoutes(
    store: Store,
    options?: { getSseManager?: () => SSEManager | null }
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/settings/composer-toolbar', (c) => {
        c.header('Cache-Control', 'no-store')
        const response: GlobalComposerToolbarSettingsResponse = {
            settings: readComposerToolbarSettings(store)
        }
        return c.json(response)
    })

    app.put('/settings/composer-toolbar', async (c) => {
        if (!hasGlobalSettingsAdminAccess(c, store)) {
            return c.json({ error: 'Global toolbar settings are only available to default-namespace administrators' }, 403)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = UpdateGlobalComposerToolbarSettingsRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }

        const settings = normalizeComposerToolbarSettings(parsed.data)
        store.appSettings.setJson(COMPOSER_TOOLBAR_SETTINGS_KEY, settings)
        options?.getSseManager?.()?.broadcast({
            type: 'app-settings-updated',
            data: {
                key: COMPOSER_TOOLBAR_SETTINGS_KEY,
                settings
            }
        })

        const response: GlobalComposerToolbarSettingsResponse = { settings }
        return c.json(response)
    })

    return app
}
