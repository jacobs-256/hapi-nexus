import type { StorageConfig } from '@hapi/protocol/storage'
import {
    createConnection,
    type Connection,
    type ConnectionOptions,
    type QueryValues,
    type QueryResult
} from 'mysql2/promise'

export type MysqlTarget = Extract<StorageConfig['core'], { backend: 'mysql' }>['mysql']

const SECRET_REDACTION = '********'
const MYSQL_UNSUPPORTED_PROTOCOL_VERSION = 'ERR_MYSQL_UNSUPPORTED_PROTOCOL_VERSION'

interface MysqlClientLike {
    connect(): Promise<void>
    unsafe<T = QueryResult>(query: string, values?: QueryValues): Promise<T>
    begin<T>(fn: (tx: Bun.SQL) => Promise<T>): Promise<T>
    close(options?: { timeout?: number }): Promise<void>
}

function mysqlErrorCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : undefined
}

function decodeUrlPart(value: string): string | undefined {
    if (!value) return undefined
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

function urlFlagEnabled(value: string | null): boolean {
    if (value === null) return false
    return ['1', 'true', 'yes', 'on', 'required', 'require'].includes(value.trim().toLowerCase())
}

function urlRequestsTls(url: URL): boolean {
    const sslMode = url.searchParams.get('ssl-mode') ?? url.searchParams.get('sslmode')
    if (sslMode && !['0', 'false', 'disabled', 'disable', 'off'].includes(sslMode.trim().toLowerCase())) {
        return true
    }
    return urlFlagEnabled(url.searchParams.get('ssl')) || urlFlagEnabled(url.searchParams.get('tls'))
}

function mysqlOptionsFromTarget(target: MysqlTarget): ConnectionOptions {
    const options: ConnectionOptions = {
        supportBigNumbers: true,
        bigNumberStrings: false
    }
    if (target.url) {
        const url = new URL(target.url)
        options.host = url.hostname
        options.port = url.port ? Number(url.port) : 3306
        options.user = decodeUrlPart(url.username)
        options.password = decodeUrlPart(url.password)
        options.database = decodeUrlPart(url.pathname.replace(/^\//, ''))
        if (target.tls === true || urlRequestsTls(url)) {
            options.ssl = {}
        }
        return options
    }

    if (target.host) options.host = target.host
    if (target.port) options.port = target.port
    if (target.user) options.user = target.user
    if (target.password) options.password = target.password
    if (target.database) options.database = target.database
    if (target.socketPath) options.socketPath = target.socketPath
    if (target.tls === true) options.ssl = {}
    return options
}

class Mysql2Client implements MysqlClientLike {
    private connection: Connection | null = null

    constructor(private readonly target: MysqlTarget) {}

    async connect(): Promise<void> {
        if (this.connection) {
            await this.connection.ping()
            return
        }
        this.connection = await createConnection(mysqlOptionsFromTarget(this.target))
    }

    async unsafe<T = QueryResult>(query: string, values?: QueryValues): Promise<T> {
        await this.connect()
        const connection = this.connection
        if (!connection) throw new Error('MySQL connection is not initialized')
        const [rows] = await connection.query(query, values)
        return rows as T
    }

    async begin<T>(fn: (tx: Bun.SQL) => Promise<T>): Promise<T> {
        await this.connect()
        const connection = this.connection
        if (!connection) throw new Error('MySQL connection is not initialized')
        await connection.beginTransaction()
        try {
            const result = await fn(this as unknown as Bun.SQL)
            await connection.commit()
            return result
        } catch (error) {
            await connection.rollback().catch(() => undefined)
            throw error
        }
    }

    async close(): Promise<void> {
        const connection = this.connection
        this.connection = null
        await connection?.end()
    }
}

export function createMysqlClient(target: MysqlTarget): Bun.SQL {
    return new Mysql2Client(target) as unknown as Bun.SQL
}

export function formatMysqlTargetForLogs(target: MysqlTarget): string {
    if (target.url) {
        try {
            const url = new URL(target.url)
            if (url.password) url.password = SECRET_REDACTION
            const tls = target.tls === true ? ' tls=true' : ''
            return `${url.toString()}${tls}`
        } catch {
            return 'MYSQL_URL=<invalid>'
        }
    }
    const endpoint = target.socketPath
        ? `socket:${target.socketPath}`
        : `${target.host ?? 'localhost'}:${target.port ?? 3306}`
    const database = target.database ?? '<database unset>'
    const user = target.user ? ` user=${target.user}` : ''
    const tls = target.tls === true ? ' tls=true' : ''
    return `${endpoint}/${database}${user}${tls}`
}

export function isMysqlUnsupportedProtocolError(error: unknown): boolean {
    return mysqlErrorCode(error) === MYSQL_UNSUPPORTED_PROTOCOL_VERSION
}

export function wrapMysqlConnectionError(error: unknown, target: MysqlTarget, context: string): Error {
    const code = mysqlErrorCode(error)
    const message = error instanceof Error ? error.message : String(error)
    const details = [
        `MySQL connection failed while ${context} (${formatMysqlTargetForLogs(target)}).`
    ]
    if (code) details.push(`Driver code: ${code}.`)
    if (isMysqlUnsupportedProtocolError(error)) {
        details.push(
            'The endpoint did not speak the MySQL classic protocol. Check MYSQL_URL/MYSQL_HOST/MYSQL_PORT; use a MySQL or MariaDB classic-protocol listener such as port 3306, not HTTP(S) or MySQL X Protocol port 33060. If this endpoint requires TLS, set MYSQL_TLS=true or add ?ssl=true to MYSQL_URL.'
        )
    } else if (message) {
        details.push(`Driver message: ${message}.`)
    }
    return new Error(details.join(' '), error instanceof Error ? { cause: error } : undefined)
}

export async function connectMysqlClient(sql: Bun.SQL, target: MysqlTarget, context: string): Promise<void> {
    try {
        await sql.connect()
    } catch (error) {
        throw wrapMysqlConnectionError(error, target, context)
    }
}

export async function withMysqlClient<T>(
    target: MysqlTarget,
    context: string,
    fn: (sql: Bun.SQL) => Promise<T>
): Promise<T> {
    const sql = createMysqlClient(target)
    try {
        await connectMysqlClient(sql, target, context)
        return await fn(sql)
    } finally {
        await sql.close({ timeout: 1 }).catch(() => undefined)
    }
}
