import type { Database } from 'bun:sqlite'

export type SqliteColumn = {
    name: string
    type: string
    notnull: number
    dflt_value: unknown
    pk: number
}

export function sqliteColumns(db: Database, table: string): SqliteColumn[] {
    return db.prepare(`PRAGMA table_info(${table})`).all() as SqliteColumn[]
}

export function sqliteTableExists(db: Database, table: string): boolean {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { name?: string } | undefined
    return Boolean(row?.name)
}

export function sqliteRowCount(db: Database, table: string): number {
    if (!sqliteTableExists(db, table)) return 0
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: number } | undefined
    return row?.count ?? 0
}

export function sqliteRowsBatch(db: Database, table: string, limit: number, offset: number): Array<Record<string, unknown>> {
    if (!sqliteTableExists(db, table)) return []
    return db.prepare(`SELECT * FROM ${table} LIMIT ? OFFSET ?`).all(limit, offset) as Array<Record<string, unknown>>
}

export function sqliteRowsBatchNewestFirst(db: Database, table: string, limit: number, offset: number): Array<Record<string, unknown>> {
    if (!sqliteTableExists(db, table)) return []
    if (table === 'messages') {
        // Background migration does not need UI-level time ordering. rowid DESC uses
        // SQLite table order and avoids expensive full-table sorting for 100k+ messages.
        return db.prepare('SELECT * FROM messages ORDER BY rowid DESC LIMIT ? OFFSET ?').all(limit, offset) as Array<Record<string, unknown>>
    }
    return db.prepare(`SELECT * FROM ${table} LIMIT ? OFFSET ?`).all(limit, offset) as Array<Record<string, unknown>>
}

export function clearSqliteTables(db: Database, tables: readonly string[]): void {
    db.exec('PRAGMA foreign_keys = OFF')
    for (const table of [...tables].reverse()) {
        db.prepare(`DELETE FROM ${table}`).run()
    }
    db.exec('PRAGMA foreign_keys = ON')
}

export function insertSqliteRows(db: Database, table: string, rows: Array<Record<string, unknown>>): void {
    if (rows.length === 0) return
    const columns = Object.keys(rows[0])
    const quotedColumns = columns.map((column) => `"${column.replace(/"/g, '""')}"`).join(', ')
    const placeholders = columns.map((column) => `@${column}`).join(', ')
    const stmt = db.prepare(`INSERT INTO ${table} (${quotedColumns}) VALUES (${placeholders})`)
    const tx = db.transaction(() => {
        for (const row of rows) stmt.run(row as never)
    })
    tx()
}
