import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { Store } from './index'
import type { StorageConfig } from '@hapi/protocol/storage'

const directories: string[] = []

afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function tableExists(dbPath: string, table: string): boolean {
    const db = new Database(dbPath, { readonly: true })
    try {
        const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { name?: string } | undefined
        return Boolean(row?.name)
    } finally {
        db.close()
    }
}

describe('split SQLite storage', () => {
    it('keeps core tables and conversation tables in separate SQLite files', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-store-split-'))
        directories.push(directory)
        const corePath = join(directory, 'core.db')
        const conversationPath = join(directory, 'conversation.db')
        const config: StorageConfig = {
            core: { backend: 'sqlite', sqlite: { path: corePath } },
            conversation: { backend: 'sqlite', sqlite: { path: conversationPath } }
        }
        const store = new Store(join(directory, 'legacy.db'), config)
        try {
            const session = store.sessions.getOrCreateSession('split', { path: '/tmp' }, null, 'default')
            store.messages.addMessage(session.id, { role: 'agent', content: 'hello' })

            expect(store.sessions.getSession(session.id)?.id).toBe(session.id)
            expect(store.messages.getMessages(session.id)).toHaveLength(1)
        } finally {
            store.close()
        }

        expect(tableExists(corePath, 'sessions')).toBe(true)
        expect(tableExists(corePath, 'messages')).toBe(false)
        expect(tableExists(conversationPath, 'messages')).toBe(true)
        expect(tableExists(conversationPath, 'sessions')).toBe(false)
    })
})
