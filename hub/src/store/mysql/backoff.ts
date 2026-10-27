const TRANSIENT_CODES = new Set([
    'ER_CON_COUNT_ERROR', 'ER_TOO_MANY_USER_CONNECTIONS', 'ER_USER_LIMIT_REACHED',
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH',
    'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_SEQUENCE_TIMEOUT'
])

// Shared by all callers of one pool. Only one recovery probe may run at a time.
export class MysqlBackoff {
    private failures = 0
    private retryAt = 0
    private probing = false
    private blocked = false

    constructor(private readonly now = Date.now, private readonly random = Math.random) {}

    enter(): number {
        if (this.retryAt && (this.now() < this.retryAt || this.probing)) {
            const retryAfterMs = Math.max(0, this.retryAt - this.now())
            throw Object.assign(new Error(`MySQL reconnect paused after a database failure; retry in ${Math.ceil(retryAfterMs / 1000)}s${this.probing ? ' (recovery probe in progress)' : ''}`), {
                code: 'MYSQL_RECONNECT_BACKOFF',
                retryAfterMs
            })
        }
        if (this.retryAt) this.probing = true
        return this.failures
    }

    success(generation: number): void {
        if (generation !== this.failures) return
        this.failures = 0
        this.retryAt = 0
        this.probing = false
        this.blocked = false
    }

    failure(error: unknown): void {
        const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
        const blocked = code === 'ER_HOST_IS_BLOCKED'
        if (!blocked && !TRANSIENT_CODES.has(code)) {
            // A non-retryable probe error must not leave the probe gate locked.
            this.probing = false
            return
        }
        if (this.retryAt > this.now() && (!blocked || this.blocked)) return
        this.probing = false
        this.failures++
        this.blocked = blocked
        const base = blocked ? 60_000 : 1_000
        const cap = blocked ? 300_000 : 30_000
        const delay = Math.min(cap, base * 2 ** Math.min(this.failures - 1, 10))
        this.retryAt = this.now() + Math.round(delay * (0.8 + this.random() * 0.2))
    }
}
