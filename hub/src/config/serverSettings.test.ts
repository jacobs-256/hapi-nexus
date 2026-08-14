import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadServerSettings } from './serverSettings'

function makeTempDir(): string {
    return mkdtempSync(join(tmpdir(), 'hapi-server-settings-test-'))
}

describe('loadServerSettings', () => {
    let dir: string | null = null
    const originalEnv = { ...process.env }

    afterEach(() => {
        process.env = { ...originalEnv }
        if (dir) {
            rmSync(dir, { recursive: true, force: true })
            dir = null
        }
    })

    it('rejects old webapp settings fields instead of migrating them', async () => {
        dir = makeTempDir()
        writeFileSync(join(dir, 'settings.json'), JSON.stringify({
            webappHost: '0.0.0.0',
            webappPort: 3007,
            webappUrl: 'http://localhost:3007',
        }))

        await expect(loadServerSettings(dir)).rejects.toThrow('Unsupported old settings field')
    })

    it('applies storage target env vars without persisting unrelated defaults', async () => {
        dir = makeTempDir()
        const legacyDbPath = join(dir, 'hapi.db')
        const conversationPath = join(dir, 'conversation.db')
        process.env.HAPI_CONVERSATION_SQLITE_PATH = conversationPath
        process.env.MYSQL_HOST = '127.0.0.1'
        process.env.MYSQL_DATABASE = 'hapi_test'
        process.env.MYSQL_USER = 'hapi'

        const result = await loadServerSettings(dir, legacyDbPath)

        expect(result.sources.storage).toBe('env')
        expect(result.settings.storage.conversation).toEqual({
            backend: 'sqlite',
            sqlite: { path: conversationPath }
        })
        expect(result.settings.storage.core).toEqual({
            backend: 'mysql',
            mysql: {
                host: '127.0.0.1',
                database: 'hapi_test',
                user: 'hapi'
            }
        })
    })
})
