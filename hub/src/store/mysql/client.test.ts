import { describe, expect, it, spyOn } from 'bun:test'
import * as mysql from 'mysql2/promise'
import {
    acquireMysqlConnection,
    createMysqlClient,
    withMysqlClient,
    connectMysqlClient,
    formatMysqlTargetForLogs,
    isMysqlUnsupportedProtocolError,
    wrapMysqlConnectionError,
    type MysqlTarget
} from './client'

describe('MySQL shared pool', () => {
    it('suppresses new driver calls across clients after a blocked-host failure', async () => {
        let attempts = 0
        const factory = spyOn(mysql, 'createPool').mockReturnValue({
            getConnection: async () => {
                attempts++
                throw Object.assign(new Error('Host blocked'), { code: 'ER_HOST_IS_BLOCKED' })
            }
        } as unknown as mysql.Pool)
        try {
            const target = { host: 'blocked-pool-test.example', database: 'hapi' }
            await expect(withMysqlClient(target, 'test', async () => undefined)).rejects.toThrow('Host blocked')
            const results = await Promise.allSettled(Array.from({ length: 20 }, () =>
                withMysqlClient({ ...target }, 'test', async () => undefined)
            ))
            expect(results.every((result) => result.status === 'rejected')).toBe(true)
            expect(attempts).toBe(1)
        } finally {
            factory.mockRestore()
        }
    })

    it('shares a bounded pool and returns connections instead of closing them', async () => {
        let releases = 0
        const connection = {
            release: () => { releases++ }
        } as unknown as mysql.PoolConnection
        const factory = spyOn(mysql, 'createPool').mockReturnValue({
            getConnection: async () => connection
        } as unknown as mysql.Pool)
        try {
            const target = { host: 'pool-test.example', database: 'hapi', user: 'test' }
            const first = createMysqlClient(target)
            const second = createMysqlClient({ ...target })
            await Promise.all([first.connect(), first.connect(), second.connect()])
            expect(factory).toHaveBeenCalledTimes(1)
            expect(factory.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
                connectionLimit: 8, queueLimit: 100, waitForConnections: true
            }))
            await first.close()
            await second.close()
            expect(releases).toBe(2)
            const other = createMysqlClient({ ...target, database: 'other' })
            await other.connect()
            await other.close()
            expect(factory).toHaveBeenCalledTimes(2)
        } finally {
            factory.mockRestore()
        }
    })

    it('times out queued acquisition and releases a connection delivered afterwards', async () => {
        let deliver: ((connection: mysql.PoolConnection) => void) | undefined
        let releases = 0
        const pending = new Promise<mysql.PoolConnection>((resolve) => { deliver = resolve })
        const acquisition = acquireMysqlConnection({ getConnection: () => pending }, 5)
        await expect(acquisition).rejects.toThrow('Timed out waiting')
        deliver?.({ release: () => { releases++ } } as unknown as mysql.PoolConnection)
        await Promise.resolve()
        expect(releases).toBe(1)
    })

    it('propagates acquisition failures', async () => {
        await expect(acquireMysqlConnection({
            getConnection: async () => { throw new Error('Too many connections') }
        })).rejects.toThrow('Too many connections')
    })
})

describe.skipIf(!process.env.HAPI_TEST_MYSQL_SOCKET_PATH)('MySQL pool integration', () => {
    it('bounds concurrent work to eight connections and rolls back transactions', async () => {
        const target: MysqlTarget = { socketPath: process.env.HAPI_TEST_MYSQL_SOCKET_PATH, user: 'root', database: 'mysql' }
        const rows = await Promise.all(Array.from({ length: 24 }, () =>
            withMysqlClient(target, 'testing pool concurrency', async (sql) =>
                await sql.unsafe<{ id: number }[]>('SELECT CONNECTION_ID() AS id, SLEEP(0.05)'))
        ))
        expect(new Set(rows.map((result) => result[0]?.id)).size).toBeLessThanOrEqual(8)
        await withMysqlClient(target, 'testing transaction rollback', async (sql) => {
            await sql.unsafe('CREATE TEMPORARY TABLE pool_rollback_test (value INT) ENGINE=InnoDB')
            try {
                await expect(sql.begin(async (tx) => {
                    await tx.unsafe('INSERT INTO pool_rollback_test VALUES (1)')
                    throw new Error('rollback test')
                })).rejects.toThrow('rollback test')
                const count = await sql.unsafe<{ count: number }[]>('SELECT COUNT(*) AS count FROM pool_rollback_test')
                expect(Number(count[0]?.count)).toBe(0)
            } finally {
                await sql.unsafe('DROP TEMPORARY TABLE pool_rollback_test')
            }
        })
    })
})

describe('MySQL client diagnostics', () => {
    it('redacts passwords when formatting URL targets', () => {
        const target: MysqlTarget = {
            url: 'mysql://hapi:secret@db.example:3306/hapi?ssl=true',
            tls: true
        }

        const formatted = formatMysqlTargetForLogs(target)

        expect(formatted).toContain('mysql://hapi:')
        expect(formatted).toContain('@db.example:3306/hapi')
        expect(formatted).toContain('tls=true')
        expect(formatted).not.toContain('secret')
    })

    it('wraps unsupported-protocol connection failures with endpoint hints', () => {
        const cause = Object.assign(new Error('Connection closed'), {
            code: 'ERR_MYSQL_UNSUPPORTED_PROTOCOL_VERSION'
        })
        const target: MysqlTarget = {
            host: 'db.example',
            port: 33060,
            database: 'hapi',
            user: 'hapi',
            password: 'secret'
        }

        const error = wrapMysqlConnectionError(cause, target, 'initializing MySQL core storage schema')

        expect(isMysqlUnsupportedProtocolError(cause)).toBe(true)
        expect(error.message).toContain('initializing MySQL core storage schema')
        expect(error.message).toContain('db.example:33060/hapi user=hapi')
        expect(error.message).toContain('Driver code: ERR_MYSQL_UNSUPPORTED_PROTOCOL_VERSION')
        expect(error.message).toContain('MySQL classic protocol')
        expect(error.message).toContain('port 3306')
        expect(error.message).toContain('MYSQL_TLS=true')
        expect(error.message).not.toContain('secret')
        expect(error.cause).toBe(cause)
    })

    it('includes TLS state in non-URL target diagnostics', () => {
        expect(formatMysqlTargetForLogs({
            host: 'db.example',
            port: 3306,
            database: 'hapi',
            user: 'hapi',
            tls: true
        })).toBe('db.example:3306/hapi user=hapi tls=true')
    })

    it('wraps connect errors before callers run queries', async () => {
        const cause = Object.assign(new Error('Connection closed'), {
            code: 'ERR_MYSQL_UNSUPPORTED_PROTOCOL_VERSION'
        })
        const sql = {
            connect: async () => {
                throw cause
            }
        } as unknown as Bun.SQL

        await expect(connectMysqlClient(sql, { host: 'db.example', database: 'hapi' }, 'testing MySQL'))
            .rejects.toThrow('testing MySQL')
    })
})
