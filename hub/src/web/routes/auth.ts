import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { AuthRequestSchema } from '@hapi/protocol'
import { getConfiguration } from '../../configuration'
import { constantTimeEquals } from '../../utils/crypto'
import { DEFAULT_NAMESPACE, parseAccessToken } from '../../utils/accessToken'
import { validateTelegramInitData } from '../telegramInitData'
import { getOrCreateOwnerId } from '../../config/ownerId'
import type { WebAppEnv } from '../middleware/auth'
import type { Store } from '../../store'

async function verifyPassword(password: string, passwordHash: string | null): Promise<boolean> {
    if (!passwordHash) return false
    try {
        return await Bun.password.verify(password, passwordHash)
    } catch {
        return false
    }
}

export function createAuthRoutes(jwtSecret: Uint8Array, store: Store): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.post('/auth', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = AuthRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        let userId: number
        let username: string | undefined
        let displayName: string | null | undefined
        let firstName: string | undefined
        let lastName: string | undefined
        let platform: string | undefined
        let role: 'admin' | 'user' | undefined
        let userAccessToken: string | null | undefined
        let namespace: string

        // Access Token authentication (CLI_API_TOKEN)
        if ('accessToken' in parsed.data) {
            const configuration = getConfiguration()
            const rawAccessToken = parsed.data.accessToken.trim()
            const parsedToken = parseAccessToken(rawAccessToken)
            if (parsedToken && constantTimeEquals(parsedToken.baseToken, configuration.cliApiToken)) {
                userId = await getOrCreateOwnerId()
                username = 'admin'
                displayName = 'Hub Owner'
                firstName = 'Web User'
                platform = 'owner'
                role = 'admin'
                userAccessToken = rawAccessToken
                namespace = parsedToken.namespace
                store.projects.ensureDefaults(namespace, userId)
            } else {
                const storedUser = store.users.getUserByAccessToken(rawAccessToken)
                if (!storedUser || storedUser.disabledAt !== null) {
                    return c.json({ error: 'Invalid access token' }, 401)
                }
                if (storedUser.platform !== 'local') {
                    return c.json({ error: 'Invalid access token' }, 401)
                }
                userId = storedUser.id
                username = storedUser.username ?? undefined
                displayName = storedUser.displayName
                platform = storedUser.platform
                role = storedUser.role
                userAccessToken = storedUser.accessToken
                namespace = storedUser.namespace
            }
        } else if ('username' in parsed.data) {
            namespace = parsed.data.namespace?.trim() || DEFAULT_NAMESPACE
            const storedUser = store.users.getLocalUserByUsername(namespace, parsed.data.username)
            if (!storedUser || storedUser.disabledAt !== null) {
                return c.json({ error: 'Invalid username or password' }, 401)
            }
            const passwordOk = await verifyPassword(parsed.data.password, storedUser.passwordHash)
            if (!passwordOk) {
                return c.json({ error: 'Invalid username or password' }, 401)
            }
            userId = storedUser.id
            username = storedUser.username ?? undefined
            displayName = storedUser.displayName
            platform = storedUser.platform
            role = storedUser.role
            userAccessToken = storedUser.accessToken
        } else {
            const configuration = getConfiguration()
            if (!configuration.telegramEnabled || !configuration.telegramBotToken) {
                return c.json({ error: 'Telegram authentication is disabled. Configure TELEGRAM_BOT_TOKEN.' }, 503)
            }

            // Telegram initData authentication
            const result = validateTelegramInitData(parsed.data.initData, configuration.telegramBotToken)
            if (!result.ok) {
                return c.json({ error: result.error }, 401)
            }

            const telegramUserId = String(result.user.id)
            const storedUser = store.users.getUser('telegram', telegramUserId)
            if (!storedUser) {
                return c.json({ error: 'not_bound' }, 401)
            }
            if (storedUser.disabledAt !== null) {
                return c.json({ error: 'Invalid access token' }, 401)
            }

            userId = storedUser.id
            username = result.user.username ?? storedUser.username ?? undefined
            displayName = storedUser.displayName
            firstName = result.user.first_name
            lastName = result.user.last_name
            platform = storedUser.platform
            role = storedUser.role
            namespace = storedUser.namespace
        }

        const token = await new SignJWT({ uid: userId, ns: namespace })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('4h')
            .sign(jwtSecret)

        return c.json({
            token,
            user: {
                id: userId,
                username,
                displayName,
                firstName,
                lastName,
                platform,
                role,
                accessToken: userAccessToken
            }
        })
    })

    return app
}
