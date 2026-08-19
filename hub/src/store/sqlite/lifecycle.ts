import { Database } from 'bun:sqlite'
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

export function isMemorySqlitePath(dbPath: string): boolean {
    return dbPath === ':memory:' || dbPath.startsWith('file::memory:')
}

export function ensureSqlitePath(dbPath: string): void {
    if (isMemorySqlitePath(dbPath)) return
    const dir = dirname(dbPath)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    try {
        chmodSync(dir, 0o700)
    } catch {
    }

    if (!existsSync(dbPath)) {
        try {
            const fd = openSync(dbPath, 'a', 0o600)
            closeSync(fd)
        } catch {
        }
    }
}

export function chmodSqliteFiles(dbPath: string): void {
    if (isMemorySqlitePath(dbPath)) return
    for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        chmodPrivate(path)
    }
}

export function openSqliteDatabase(dbPath: string): Database {
    const db = new Database(dbPath, { create: true, readwrite: true, strict: true })
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    return db
}

export function backupSqliteDatabaseForMigration(db: Database, dbPath: string, fromVersion: number, toVersion: number): string | null {
    if (isMemorySqlitePath(dbPath)) return null
    if (!existsSync(dbPath)) return null

    const backupDir = join(dirname(dbPath), 'backups')
    mkdirSync(backupDir, { recursive: true, mode: 0o700 })
    try {
        chmodSync(backupDir, 0o700)
    } catch {
    }

    db.exec('PRAGMA wal_checkpoint(FULL)')
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
    const prefix = `${basename(dbPath)}.v${fromVersion}-to-v${toVersion}.${stamp}`
    const backupPath = join(backupDir, `${prefix}.bak`)
    copyFileSync(dbPath, backupPath)
    chmodPrivate(backupPath)

    for (const suffix of ['-wal', '-shm']) {
        const source = `${dbPath}${suffix}`
        if (!existsSync(source)) continue
        const sidecar = join(backupDir, `${prefix}${suffix}.bak`)
        copyFileSync(source, sidecar)
        chmodPrivate(sidecar)
    }

    return backupPath
}

function chmodPrivate(path: string): void {
    try {
        chmodSync(path, 0o600)
    } catch {
    }
}
