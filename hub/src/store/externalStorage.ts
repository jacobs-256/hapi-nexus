import type { Database } from 'bun:sqlite'
import type { StorageConfig } from '@hapi/protocol/storage'

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
    'app_settings',
    'codex_import_jobs',
    'schema_migrations'
] as const

const CONVERSATION_TABLES = ['messages', 'message_epochs'] as const
const OPTIONAL_CORE_TABLES: readonly TableName[] = ['app_settings', 'codex_import_jobs']

type TableGroup = 'core' | 'conversation'
type TableName = typeof CORE_TABLES[number] | typeof CONVERSATION_TABLES[number]

type SqliteColumn = {
    name: string
    type: string
    notnull: number
    dflt_value: unknown
    pk: number
}

type MysqlTarget = Extract<StorageConfig['core'], { backend: 'mysql' }>['mysql']
type ElasticsearchTarget = Extract<StorageConfig['conversation'], { backend: 'elasticsearch' }>['elasticsearch']

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

function sqliteColumns(db: Database, table: string): SqliteColumn[] {
    return db.prepare(`PRAGMA table_info(${table})`).all() as SqliteColumn[]
}

function sqliteRows(db: Database, table: string): Array<Record<string, unknown>> {
    return db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>
}

function clearSqliteTables(db: Database, tables: readonly string[]): void {
    db.exec('PRAGMA foreign_keys = OFF')
    for (const table of [...tables].reverse()) {
        db.prepare(`DELETE FROM ${table}`).run()
    }
    db.exec('PRAGMA foreign_keys = ON')
}

function insertSqliteRows(db: Database, table: string, rows: Array<Record<string, unknown>>): void {
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

function createMysqlClient(target: MysqlTarget): Bun.SQL {
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

async function mysqlTableExists(sql: Bun.SQL, table: string): Promise<boolean> {
    const rows = await sql.unsafe<Array<Record<string, unknown>>>(
        'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
        [table]
    )
    return Number(rows[0]?.n ?? 0) > 0
}

async function ensureMysqlTable(sql: Bun.SQL, sqliteDb: Database, table: TableName): Promise<void> {
    const columns = sqliteColumns(sqliteDb, table)
    if (columns.length === 0) return
    const defs = columns.map((column) => {
        const nullable = column.notnull ? ' NOT NULL' : ''
        return `${quoteMysqlIdentifier(column.name)} ${mysqlType(column.type)}${nullable}`
    })
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${quoteMysqlIdentifier(table)} (${defs.join(', ')})`)
}

async function replaceMysqlTable(sql: Bun.SQL, sqliteDb: Database, table: TableName): Promise<number> {
    await ensureMysqlTable(sql, sqliteDb, table)
    const rows = sqliteRows(sqliteDb, table)
    await sql.unsafe(`DELETE FROM ${quoteMysqlIdentifier(table)}`)
    if (rows.length === 0) return 0
    const columns = Object.keys(rows[0])
    const columnList = columns.map(quoteMysqlIdentifier).join(', ')
    const placeholders = columns.map(() => '?').join(', ')
    for (const row of rows) {
        await sql.unsafe(
            `INSERT INTO ${quoteMysqlIdentifier(table)} (${columnList}) VALUES (${placeholders})`,
            columns.map((column) => row[column] ?? null)
        )
    }
    return rows.length
}

async function importMysqlTable(sql: Bun.SQL, sqliteDb: Database, table: TableName): Promise<number> {
    if (!await mysqlTableExists(sql, table)) return 0
    const rows = await sql.unsafe<Array<Record<string, unknown>>>(`SELECT * FROM ${quoteMysqlIdentifier(table)}`)
    if (rows.length === 0) return 0
    insertSqliteRows(sqliteDb, table, rows)
    return rows.length
}

function elasticHeaders(target: ElasticsearchTarget): Headers {
    const headers = new Headers({ 'content-type': 'application/json' })
    if (target.apiKey) {
        headers.set('authorization', `ApiKey ${target.apiKey}`)
    } else if (target.username || target.password) {
        headers.set('authorization', `Basic ${btoa(`${target.username ?? ''}:${target.password ?? ''}`)}`)
    }
    return headers
}

function elasticUrl(target: ElasticsearchTarget, path: string): string {
    return `${target.url.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}


async function elasticIndexExists(target: ElasticsearchTarget): Promise<boolean> {
    const response = await fetch(elasticUrl(target, encodeURIComponent(target.index)), {
        method: 'HEAD',
        headers: elasticHeaders(target)
    })
    if (response.status === 404) return false
    if (!response.ok) {
        throw new Error(`Elasticsearch index check failed: ${response.status} ${await response.text()}`)
    }
    return true
}

async function ensureElasticIndex(target: ElasticsearchTarget): Promise<void> {
    const existing = await fetch(elasticUrl(target, encodeURIComponent(target.index)), {
        method: 'HEAD',
        headers: elasticHeaders(target)
    })
    if (existing.ok) return
    if (existing.status === 403) {
        // 中文注释：生产环境通常会预先创建 index/data stream，并给 HAPI 一个低权限写入 key；
        // 低权限 key 可能不能查看元数据或创建索引，此时直接进入后续 delete/bulk 写入，由实际写权限校验。
        return
    }
    if (existing.status !== 404) {
        throw new Error(`Elasticsearch index check failed: ${existing.status} ${await existing.text()}`)
    }

    const response = await fetch(elasticUrl(target, encodeURIComponent(target.index)), {
        method: 'PUT',
        headers: elasticHeaders(target),
        body: JSON.stringify({
            mappings: {
                dynamic: true,
                properties: {
                    '@timestamp': { type: 'date' },
                    table: { type: 'keyword' }
                }
            }
        })
    })
    if (!response.ok && response.status !== 400) {
        throw new Error(`Elasticsearch index setup failed: ${response.status} ${await response.text()}`)
    }
}

function elasticDocumentId(table: TableName, row: Record<string, unknown>): string {
    const id = row.id ?? row.session_id ?? `${Date.now()}-${Math.random()}`
    return `${table}:${String(id)}`
}

function elasticTimestamp(row: Record<string, unknown>, fallbackNow: number): string {
    const value = row.created_at ?? row.updated_at ?? row.applied_at ?? fallbackNow
    const numeric = typeof value === 'number' ? value : Number(value)
    const timestamp = Number.isFinite(numeric) && numeric > 0 ? numeric : fallbackNow
    return new Date(timestamp).toISOString()
}

async function assertElasticOk(response: Response, action: string): Promise<void> {
    if (!response.ok) {
        throw new Error(`Elasticsearch ${action} failed: ${response.status} ${await response.text()}`)
    }
}

async function assertElasticBulkOk(response: Response): Promise<void> {
    await assertElasticOk(response, 'bulk write')
    const payload = await response.json() as {
        errors?: boolean
        items?: Array<Record<string, { status?: number; error?: { type?: string; reason?: string } | string }>>
    }
    if (!payload.errors) return
    const failedItem = payload.items?.find((item) => {
        const result = Object.values(item)[0]
        return result?.error
    })
    const result = failedItem ? Object.values(failedItem)[0] : undefined
    const error = result?.error
    const reason = typeof error === 'string' ? error : (error?.reason ?? error?.type ?? 'unknown bulk item error')
    throw new Error(`Elasticsearch bulk write failed: ${result?.status ?? 'unknown'} ${reason}`)
}

async function replaceElasticTable(target: ElasticsearchTarget, db: Database, table: typeof CONVERSATION_TABLES[number]): Promise<number> {
    await ensureElasticIndex(target)
    const deleteResponse = await fetch(elasticUrl(target, `${encodeURIComponent(target.index)}/_delete_by_query?refresh=true&conflicts=proceed`), {
        method: 'POST',
        headers: elasticHeaders(target),
        body: JSON.stringify({ query: { term: { table } } })
    })
    if (deleteResponse.status !== 404) {
        await assertElasticOk(deleteResponse, 'delete-by-query')
    }
    const rows = sqliteRows(db, table)
    if (rows.length === 0) return 0
    const now = Date.now()
    const ndjson = rows.flatMap((row) => [
        JSON.stringify({ create: { _index: target.index, _id: elasticDocumentId(table, row) } }),
        JSON.stringify({ table, ...row, '@timestamp': elasticTimestamp(row, now) })
    ]).join('\n') + '\n'
    const response = await fetch(elasticUrl(target, '_bulk?refresh=true'), {
        method: 'POST',
        headers: new Headers({ ...Object.fromEntries(elasticHeaders(target)), 'content-type': 'application/x-ndjson' }),
        body: ndjson
    })
    await assertElasticBulkOk(response)
    return rows.length
}

async function importElasticTable(target: ElasticsearchTarget, db: Database, table: typeof CONVERSATION_TABLES[number]): Promise<number> {
    const response = await fetch(elasticUrl(target, `${encodeURIComponent(target.index)}/_search`), {
        method: 'POST',
        headers: elasticHeaders(target),
        body: JSON.stringify({ size: 10000, query: { term: { table } }, sort: ['_doc'] })
    })
    if (response.status === 404) return 0
    if (!response.ok) {
        throw new Error(`Elasticsearch import failed: ${response.status} ${await response.text()}`)
    }
    const payload = await response.json() as { hits?: { hits?: Array<{ _source?: Record<string, unknown> }> } }
    const rows = (payload.hits?.hits ?? []).map((hit) => {
        const { table: _table, '@timestamp': _timestamp, ...row } = hit._source ?? {}
        return row
    })
    if (rows.length === 0) return 0
    insertSqliteRows(db, table, rows)
    return rows.length
}

export class ExternalStorageSync {
    private coreTimer: ReturnType<typeof setTimeout> | null = null
    private conversationTimer: ReturnType<typeof setTimeout> | null = null
    private coreRunning = false
    private conversationRunning = false

    constructor(
        private readonly config: StorageConfig,
        private readonly coreDb: Database,
        private readonly conversationDb: Database,
        private readonly log: Pick<Console, 'warn' | 'log'> = console,
        private readonly strict: boolean = false
    ) {}

    get hasExternalCore(): boolean {
        return this.config.core.backend === 'mysql'
    }

    get hasExternalConversation(): boolean {
        return this.config.conversation.backend === 'elasticsearch'
    }

    get active(): boolean {
        return this.hasExternalCore || this.hasExternalConversation
    }

    stop(): void {
        if (this.coreTimer) {
            clearTimeout(this.coreTimer)
            this.coreTimer = null
        }
        if (this.conversationTimer) {
            clearTimeout(this.conversationTimer)
            this.conversationTimer = null
        }
    }

    async importExternalIntoSqlite(): Promise<Record<string, number>> {
        const imported: Record<string, number> = {}
        if (this.config.core.backend === 'mysql') {
            const sql = createMysqlClient(this.config.core.mysql)
            try {
                await sql.connect()
                const tablePresence = await Promise.all(CORE_TABLES.map(async (table) => [table, await mysqlTableExists(sql, table)] as const))
                const presentTables = tablePresence.filter(([, present]) => present).map(([table]) => table)
                if (presentTables.length === 0) {
                    return imported
                }
                const missingRequired = tablePresence
                    .filter(([table, present]) => !present && !OPTIONAL_CORE_TABLES.includes(table))
                    .map(([table]) => table)
                if (missingRequired.length > 0) {
                    const missing = tablePresence.filter(([, present]) => !present).map(([table]) => table)
                    throw new Error(`MySQL storage has partial HAPI schema; missing tables: ${missing.join(', ')}`)
                }
                clearSqliteTables(this.coreDb, CORE_TABLES)
                for (const table of presentTables) {
                    imported[`core.${table}`] = await importMysqlTable(sql, this.coreDb, table)
                }
            } finally {
                await sql.close({ timeout: 1 }).catch(() => undefined)
            }
        }
        if (this.config.conversation.backend === 'elasticsearch') {
            if (!await elasticIndexExists(this.config.conversation.elasticsearch)) {
                return imported
            }
            clearSqliteTables(this.conversationDb, CONVERSATION_TABLES)
            for (const table of CONVERSATION_TABLES) {
                imported[`conversation.${table}`] = await importElasticTable(this.config.conversation.elasticsearch, this.conversationDb, table)
            }
        }
        return imported
    }

    schedule(group: TableGroup): void {
        if (group === 'core') {
            if (!this.hasExternalCore) return
            if (this.coreTimer) clearTimeout(this.coreTimer)
            this.coreTimer = setTimeout(() => {
                this.coreTimer = null
                void this.exportCoreSnapshot()
            }, 750)
            return
        }
        if (!this.hasExternalConversation) return
        if (this.conversationTimer) clearTimeout(this.conversationTimer)
        this.conversationTimer = setTimeout(() => {
            this.conversationTimer = null
            void this.exportConversationSnapshot()
        }, 750)
    }

    async exportCoreSnapshot(): Promise<Record<string, number>> {
        if (this.config.core.backend !== 'mysql') return {}
        if (this.coreRunning) return {}
        this.coreRunning = true
        const copied: Record<string, number> = {}
        const sql = createMysqlClient(this.config.core.mysql)
        try {
            await sql.connect()
            for (const table of CORE_TABLES) {
                copied[table] = await replaceMysqlTable(sql, this.coreDb, table)
            }
        } catch (error) {
            if (this.strict) throw error
            this.log.warn('[Storage] MySQL snapshot sync failed:', error instanceof Error ? error.message : error)
        } finally {
            this.coreRunning = false
            await sql.close({ timeout: 1 }).catch(() => undefined)
        }
        return copied
    }

    async exportConversationSnapshot(): Promise<Record<string, number>> {
        if (this.config.conversation.backend !== 'elasticsearch') return {}
        if (this.conversationRunning) return {}
        this.conversationRunning = true
        const copied: Record<string, number> = {}
        try {
            for (const table of CONVERSATION_TABLES) {
                copied[table] = await replaceElasticTable(this.config.conversation.elasticsearch, this.conversationDb, table)
            }
        } catch (error) {
            if (this.strict) throw error
            this.log.warn('[Storage] Elasticsearch snapshot sync failed:', error instanceof Error ? error.message : error)
        } finally {
            this.conversationRunning = false
        }
        return copied
    }

    async exportAll(): Promise<Record<string, number>> {
        return {
            ...Object.fromEntries(Object.entries(await this.exportCoreSnapshot()).map(([key, value]) => [`core.${key}`, value])),
            ...Object.fromEntries(Object.entries(await this.exportConversationSnapshot()).map(([key, value]) => [`conversation.${key}`, value])),
        }
    }
}

export async function exportSqliteSnapshotToExternal(
    config: StorageConfig,
    coreDb: Database,
    conversationDb: Database
): Promise<Record<string, number>> {
    const sync = new ExternalStorageSync(config, coreDb, conversationDb, console, true)
    return await sync.exportAll()
}
