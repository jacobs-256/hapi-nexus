import { Database } from 'bun:sqlite'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import type { StorageConfig } from '@hapi/protocol/storage'
import { Store } from './index'

function isMemory(path: string): boolean {
    return path === ':memory:' || path.startsWith('file::memory:')
}

function ensureFile(path: string): void {
    if (isMemory(path)) return
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    if (!existsSync(path)) {
        const fd = openSync(path, 'a', 0o600)
        closeSync(fd)
    }
}

function chmodPrivate(path: string): void {
    if (isMemory(path)) return
    for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
        try { chmodSync(candidate, 0o600) } catch {}
    }
}

function openDb(path: string): Database {
    ensureFile(path)
    const db = new Database(path, { create: true, readwrite: true, strict: true })
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    return db
}

function tableExists(db: Database, table: string): boolean {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { name?: string } | undefined
    return Boolean(row?.name)
}

function sameSqlitePath(a: string, b: string): boolean {
    if (a === b) return true
    if (isMemory(a) || isMemory(b)) return false
    try {
        return realpathSync(a) === realpathSync(b)
    } catch {
        return false
    }
}

function copyTable(source: Database, target: Database, table: string): number {
    if (!tableExists(source, table)) return 0
    const rows = source.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>
    if (rows.length === 0) return 0
    const columns = Object.keys(rows[0])
    const columnList = columns.map((column) => `\"${column}\"`).join(', ')
    const placeholders = columns.map((column) => `@${column}`).join(', ')
    const stmt = target.prepare(`INSERT INTO ${table} (${columnList}) VALUES (${placeholders})`)
    const tx = target.transaction(() => {
        for (const row of rows) stmt.run(row as never)
    })
    tx()
    return rows.length
}

export type SqliteStorageMigrationResult = {
    migrated: boolean
    message: string
    copied: Record<string, number>
}

const CORE_TABLES = [
    'sessions',
    'machines',
    'users',
    'teams',
    'team_members',
    'projects',
    'project_members',
    'project_workspaces',
    'project_invites',
    'audit_log',
    'push_subscriptions',
    'fcm_devices',
    'session_scratchlist',
    'schema_migrations'
]

const CONVERSATION_TABLES = ['messages', 'message_epochs']

export function migrateSqliteStorage(source: StorageConfig, target: StorageConfig): SqliteStorageMigrationResult {
    if (source.core.backend !== 'sqlite' || source.conversation.backend !== 'sqlite') {
        return {
            migrated: false,
            message: 'Source migration currently supports SQLite only.',
            copied: {}
        }
    }
    if (target.core.backend !== 'sqlite' || target.conversation.backend !== 'sqlite') {
        return {
            migrated: false,
            message: 'Target migration currently supports SQLite only. Save config, then run external MySQL/Elasticsearch migration tooling.',
            copied: {}
        }
    }

    const sourceCore = source.core.sqlite.path
    const sourceConversation = source.conversation.sqlite.path
    const targetCore = target.core.sqlite.path
    const targetConversation = target.conversation.sqlite.path
    if (sameSqlitePath(sourceCore, targetCore) && sameSqlitePath(sourceConversation, targetConversation)) {
        return { migrated: false, message: 'Storage paths unchanged; no migration needed.', copied: {} }
    }

    const copied: Record<string, number> = {}
    const initializer = new Store(targetCore, target)
    initializer.close()

    const sourceCoreDb = openDb(sourceCore)
    const sourceConversationDb = sameSqlitePath(sourceConversation, sourceCore) ? sourceCoreDb : openDb(sourceConversation)
    const targetCoreDb = openDb(targetCore)
    const targetConversationDb = sameSqlitePath(targetConversation, targetCore) ? targetCoreDb : openDb(targetConversation)
    try {
        if (!sameSqlitePath(sourceCore, targetCore)) {
            targetCoreDb.exec('PRAGMA foreign_keys = OFF')
            for (const table of [...CORE_TABLES].reverse()) {
                targetCoreDb.prepare(`DELETE FROM ${table}`).run()
            }
            const sourceCoreVersion = (sourceCoreDb.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version ?? 0
            targetCoreDb.exec(`PRAGMA user_version = ${sourceCoreVersion}`)
            for (const table of CORE_TABLES) copied[table] = copyTable(sourceCoreDb, targetCoreDb, table)
            targetCoreDb.exec('PRAGMA foreign_keys = ON')
        }

        if (!sameSqlitePath(sourceConversation, targetConversation)) {
            for (const table of [...CONVERSATION_TABLES].reverse()) {
                targetConversationDb.prepare(`DELETE FROM ${table}`).run()
            }
            const sourceConversationVersion = (sourceConversationDb.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version ?? 0
            targetConversationDb.exec(`PRAGMA user_version = ${sourceConversationVersion}`)
            for (const table of CONVERSATION_TABLES) copied[table] = copyTable(sourceConversationDb, targetConversationDb, table)
        }
    } finally {
        if (targetConversationDb !== targetCoreDb) targetConversationDb.close()
        targetCoreDb.close()
        if (sourceConversationDb !== sourceCoreDb) sourceConversationDb.close()
        sourceCoreDb.close()
        chmodPrivate(targetCore)
        chmodPrivate(targetConversation)
    }

    return { migrated: true, message: 'Copied SQLite tables into configured storage files.', copied }
}
