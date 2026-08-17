import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { StorageConfig } from '@hapi/protocol/storage'
import { SCHEMA_VERSION, Store } from './index'

describe('Store V19→V20 migration: Codex import job table', () => {
    it('adds codex_import_jobs and preserves existing rows', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v19-to-v20-'))
        const dbPath = join(dir, 'hapi.db')
        let store: Store | undefined
        try {
            store = new Store(dbPath)
            const db: Database = (store as unknown as { db: Database }).db
            db.exec(`
                INSERT INTO sessions (id, tag, namespace, created_at, updated_at)
                VALUES ('session-1', 'project', 'default', 100, 100);
                DROP TABLE codex_import_jobs;
                PRAGMA user_version = 19;
            `)
            store.close()
            store = undefined

            store = new Store(dbPath)
            const upgradedDb: Database = (store as unknown as { db: Database }).db

            expect(store.schemaVersion).toBe(SCHEMA_VERSION)
            expect(tableExists(upgradedDb, 'codex_import_jobs')).toBe(true)
            expect(upgradedDb.prepare('SELECT id FROM sessions').all()).toEqual([{ id: 'session-1' }])
            store.codexImportJobs.save({ id: 'job-1', namespace: 'default', status: 'succeeded', createdAt: 123 }, {
                id: 'job-1',
                namespace: 'default',
                status: 'succeeded',
                createdAt: 123,
                totalItems: 0,
                items: [],
                logs: []
            }, 456)
            expect(store.codexImportJobs.listAll()[0]).toMatchObject({
                id: 'job-1',
                namespace: 'default',
                status: 'succeeded',
                createdAt: 123,
                updatedAt: 456
            })
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('bumps split conversation mirrors because V20 has no conversation shape change', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v19-to-v20-split-'))
        const corePath = join(dir, 'core.db')
        const conversationPath = join(dir, 'conversation.db')
        const config: StorageConfig = {
            core: { backend: 'sqlite', sqlite: { path: corePath } },
            conversation: { backend: 'sqlite', sqlite: { path: conversationPath } }
        }
        let store: Store | undefined
        try {
            store = new Store(join(dir, 'legacy.db'), config)
            store.close()
            store = undefined

            const coreDb = new Database(corePath, { create: true, readwrite: true, strict: true })
            const conversationDb = new Database(conversationPath, { create: true, readwrite: true, strict: true })
            coreDb.exec('DROP TABLE codex_import_jobs; PRAGMA user_version = 19;')
            conversationDb.exec('PRAGMA user_version = 19;')
            coreDb.close()
            conversationDb.close()

            store = new Store(join(dir, 'legacy.db'), config)

            expect(store.schemaVersion).toBe(SCHEMA_VERSION)
            const reopenedConversationDb = new Database(conversationPath, { readonly: true })
            try {
                const row = reopenedConversationDb.prepare('PRAGMA user_version').get() as { user_version: number }
                expect(row.user_version).toBe(SCHEMA_VERSION)
            } finally {
                reopenedConversationDb.close()
            }
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })
})

function tableExists(db: Database, name: string): boolean {
    const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(name) as { name: string } | null
    return row !== null
}
