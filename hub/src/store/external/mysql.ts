import type { Database } from 'bun:sqlite'
import type { StorageConfig } from '@hapi/protocol/storage'
import type { TableName } from './tables'
import {
    insertSqliteRows,
    sqliteColumns,
    sqliteRowCount,
    sqliteRowsBatch
} from './sqlite'
import { positiveIntegerEnv } from './env'

type MysqlTarget = Extract<StorageConfig['core'], { backend: 'mysql' }>['mysql']

const MYSQL_SQLITE_BATCH_SIZE = positiveIntegerEnv('HAPI_MYSQL_SQLITE_BATCH_SIZE', 1000)
const MYSQL_INSERT_BATCH_SIZE = positiveIntegerEnv('HAPI_MYSQL_INSERT_BATCH_SIZE', 250)

function quoteMysqlIdentifier(value: string): string {
    return `\`${value.replace(/`/g, '``')}\``
}

function mysqlType(sqliteType: string): string {
    const normalized = sqliteType.toUpperCase()
    if (normalized.includes('INT')) return 'BIGINT'
    if (normalized.includes('REAL') || normalized.includes('FLOA') || normalized.includes('DOUB')) return 'DOUBLE'
    if (normalized.includes('BLOB')) return 'LONGBLOB'
    return 'LONGTEXT'
}

export function createMysqlClient(target: MysqlTarget): Bun.SQL {
    if (target.url) {
        return new Bun.SQL(target.url)
    }
    return new Bun.SQL({
        adapter: 'mysql',
        ...(target.host ? { hostname: target.host } : {}),
        ...(target.port ? { port: target.port } : {}),
        ...(target.user ? { username: target.user } : {}),
        ...(target.password ? { password: target.password } : {}),
        ...(target.database ? { database: target.database } : {}),
        ...(target.socketPath ? { path: target.socketPath } : {})
    })
}

export async function mysqlTableExists(sql: Bun.SQL, table: string): Promise<boolean> {
    const rows = await sql.unsafe<Array<Record<string, unknown>>>(
        'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
        [table]
    )
    return Number(rows[0]?.n ?? 0) > 0
}

export async function ensureMysqlTable(sql: Bun.SQL, sqliteDb: Database, table: TableName): Promise<void> {
    const columns = sqliteColumns(sqliteDb, table)
    if (columns.length === 0) return
    const defs = columns.map((column) => {
        const nullable = column.notnull ? ' NOT NULL' : ''
        return `${quoteMysqlIdentifier(column.name)} ${mysqlType(column.type)}${nullable}`
    })
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${quoteMysqlIdentifier(table)} (${defs.join(', ')})`)
}

export async function replaceMysqlTable(sql: Bun.SQL, sqliteDb: Database, table: TableName): Promise<number> {
    await ensureMysqlTable(sql, sqliteDb, table)
    await sql.unsafe(`DELETE FROM ${quoteMysqlIdentifier(table)}`)
    const total = sqliteRowCount(sqliteDb, table)
    if (total === 0) return 0
    let copied = 0
    for (let offset = 0; offset < total; offset += MYSQL_SQLITE_BATCH_SIZE) {
        const rows = sqliteRowsBatch(sqliteDb, table, MYSQL_SQLITE_BATCH_SIZE, offset)
        if (rows.length === 0) break
        const columns = Object.keys(rows[0])
        const columnList = columns.map(quoteMysqlIdentifier).join(', ')
        const rowPlaceholder = `(${columns.map(() => '?').join(', ')})`
        for (let rowOffset = 0; rowOffset < rows.length; rowOffset += MYSQL_INSERT_BATCH_SIZE) {
            const chunk = rows.slice(rowOffset, rowOffset + MYSQL_INSERT_BATCH_SIZE)
            const placeholders = chunk.map(() => rowPlaceholder).join(', ')
            await sql.unsafe(
                `INSERT INTO ${quoteMysqlIdentifier(table)} (${columnList}) VALUES ${placeholders}`,
                chunk.flatMap((row) => columns.map((column) => row[column] ?? null))
            )
            copied += chunk.length
        }
    }
    return copied
}

export async function importMysqlTable(sql: Bun.SQL, sqliteDb: Database, table: TableName): Promise<number> {
    if (!await mysqlTableExists(sql, table)) return 0
    const rows = await sql.unsafe<Array<Record<string, unknown>>>(`SELECT * FROM ${quoteMysqlIdentifier(table)}`)
    if (rows.length === 0) return 0
    insertSqliteRows(sqliteDb, table, rows)
    return rows.length
}
