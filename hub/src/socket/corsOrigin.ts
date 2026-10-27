function firstHeaderValue(value: string | null): string | null {
    const first = value?.split(',')[0]?.trim()
    return first || null
}

function normalizeOrigin(value: string): string | null {
    try {
        return new URL(value).origin
    } catch {
        return null
    }
}

/**
 * Accept an explicitly configured origin, or the origin of the public request
 * itself. The latter keeps Socket.IO working when a hub is reverse-proxied and
 * its persisted CORS list predates the public hostname.
 */
export function isSocketOriginAllowed(req: Request, origin: string | null, corsOrigins: string[]): boolean {
    if (!origin || corsOrigins.includes('*') || corsOrigins.includes(origin)) {
        return true
    }

    const requestUrl = new URL(req.url)
    const protocol = firstHeaderValue(req.headers.get('x-forwarded-proto')) ?? requestUrl.protocol.slice(0, -1)
    const host = firstHeaderValue(req.headers.get('x-forwarded-host')) ?? firstHeaderValue(req.headers.get('host'))
    if (!host) {
        return false
    }

    const requestOrigin = normalizeOrigin(`${protocol}://${host}`)
    return requestOrigin !== null && normalizeOrigin(origin) === requestOrigin
}
