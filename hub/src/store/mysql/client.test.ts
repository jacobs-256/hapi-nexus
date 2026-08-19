import { describe, expect, it } from 'bun:test'
import {
    connectMysqlClient,
    formatMysqlTargetForLogs,
    isMysqlUnsupportedProtocolError,
    wrapMysqlConnectionError,
    type MysqlTarget
} from './client'

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
