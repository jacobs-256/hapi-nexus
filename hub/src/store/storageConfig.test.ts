import { describe, expect, it } from 'bun:test'
import type { StorageConfig } from '@hapi/protocol/storage'
import { applyStorageEnvOverrides, normalizeStorageConfig, validateStorageConfig } from './storageConfig'

function mysqlStorageConfig(mysql: Extract<StorageConfig['core'], { backend: 'mysql' }>['mysql']): StorageConfig {
    return {
        conversation: { backend: 'sqlite', sqlite: { path: ':memory:' } },
        core: { backend: 'mysql', mysql }
    }
}

describe('storage config validation', () => {
    it('rejects non-MySQL URL schemes for MySQL core storage', () => {
        expect(() => validateStorageConfig(mysqlStorageConfig({ url: 'https://db.example:3306/hapi' })))
            .toThrow('mysql:// or mysql2://')
    })

    it('rejects URL values in MYSQL_HOST-style config', () => {
        expect(() => validateStorageConfig(mysqlStorageConfig({ host: 'mysql://db.example', database: 'hapi' })))
            .toThrow('MYSQL_HOST must be a bare hostname')
    })

    it('normalizes fullwidth colons in MySQL URLs', () => {
        const config = normalizeStorageConfig({
            core: {
                backend: 'mysql',
                mysql: { url: 'mysql://hapi:secret@db.example：3306/hapi' }
            }
        }, '/tmp/hapi', '/tmp/hapi/hapi.db')

        expect(config.core.backend).toBe('mysql')
        if (config.core.backend !== 'mysql') return
        expect(config.core.mysql.url).toBe('mysql://hapi:secret@db.example:3306/hapi')
    })

    it('normalizes MySQL TLS from settings and environment overrides', () => {
        const fromSettings = normalizeStorageConfig({
            core: {
                backend: 'mysql',
                mysql: { host: 'db.example', database: 'hapi', tls: true }
            }
        }, '/tmp/hapi', '/tmp/hapi/hapi.db')
        expect(fromSettings.core.backend).toBe('mysql')
        if (fromSettings.core.backend !== 'mysql') return
        expect(fromSettings.core.mysql.tls).toBe(true)

        const fromEnv = applyStorageEnvOverrides(mysqlStorageConfig({
            host: 'db.example',
            database: 'hapi'
        }), {
            MYSQL_TLS: 'true'
        } as NodeJS.ProcessEnv)
        validateStorageConfig(fromEnv)
        expect(fromEnv.core.backend).toBe('mysql')
        if (fromEnv.core.backend !== 'mysql') return
        expect(fromEnv.core.mysql.host).toBe('db.example')
        expect(fromEnv.core.mysql.database).toBe('hapi')
        expect(fromEnv.core.mysql.tls).toBe(true)
    })
})
