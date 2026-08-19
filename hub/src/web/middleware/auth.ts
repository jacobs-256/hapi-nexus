import type { MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { jwtVerify } from 'jose'
import { getOrCreateOwnerId } from '../../config/ownerId'
import type { Store } from '../../store'

export type WebAppEnv = {
    Variables: {
        userId: number
        namespace: string
        authPlatform?: string
    }
}

const jwtPayloadSchema = z.object({
    uid: z.number(),
    ns: z.string(),
    plt: z.string().optional()
})

export function createAuthMiddleware(jwtSecret: Uint8Array, store?: Store): MiddlewareHandler<WebAppEnv> {
    return async (c, next) => {
        const path = c.req.path
        if (path === '/api/auth' || path === '/api/bind') {
            await next()
            return
        }

        const authorization = c.req.header('authorization')
        const tokenFromHeader = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
        const tokenFromQuery = path === '/api/events' ? c.req.query().token : undefined
        const token = tokenFromHeader ?? tokenFromQuery

        if (!token) {
            return c.json({ error: 'Missing authorization token' }, 401)
        }

        try {
            const verified = await jwtVerify(token, jwtSecret, { algorithms: ['HS256'] })
            const parsed = jwtPayloadSchema.safeParse(verified.payload)
            if (!parsed.success) {
                return c.json({ error: 'Invalid token payload' }, 401)
            }

            let authPlatform = parsed.data.plt
            if (store) {
                const ownerId = await getOrCreateOwnerId()
                const isLegacyOwnerToken = parsed.data.plt === undefined && parsed.data.uid === ownerId
                const isOwnerToken = (parsed.data.plt === 'owner' && parsed.data.uid === ownerId) || isLegacyOwnerToken
                if (parsed.data.plt === 'owner' && !isOwnerToken) {
                    return c.json({ error: 'Invalid token payload' }, 401)
                }
                authPlatform = parsed.data.plt ?? (isLegacyOwnerToken ? 'owner' : 'local')
                if (!isOwnerToken) {
                    const user = await store.users.getUserById(parsed.data.uid, parsed.data.ns)
                    if (!user || user.disabledAt !== null) {
                        return c.json({ error: 'Account disabled' }, 401)
                    }
                }
            }

            c.set('userId', parsed.data.uid)
            c.set('namespace', parsed.data.ns)
            c.set('authPlatform', authPlatform ?? 'local')
            await next()
            return
        } catch {
            return c.json({ error: 'Invalid token' }, 401)
        }
    }
}
