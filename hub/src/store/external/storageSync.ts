import type { Database } from 'bun:sqlite'
import type { StorageConfig } from '@hapi/protocol/storage'
import {
    CONVERSATION_TABLES,
    CORE_TABLES,
    OPTIONAL_CORE_TABLES
} from './tables'
import type {
    ExternalStorageExportOptions,
    ExternalStorageSyncGroupStatus,
    TableGroup
} from './types'
export type {
    ExternalStorageExportOptions,
    ExternalStorageExportProgress,
    ExternalStorageSyncGroupStatus
} from './types'
import {
    clearSqliteTables
} from './sqlite'
import {
    connectMysqlClient,
    createMysqlClient,
    importMysqlTable,
    mysqlTableExists,
    replaceMysqlTable
} from './mysql'
import {
    elasticIndexExists,
    importElasticTable,
    refreshElasticIndex,
    replaceElasticMessageCounters,
    replaceElasticTable
} from './elasticsearch'
export { createMysqlClient } from './mysql'

export class ExternalStorageSync {
    private coreTimer: ReturnType<typeof setTimeout> | null = null
    private conversationTimer: ReturnType<typeof setTimeout> | null = null
    private coreRunning = false
    private conversationRunning = false
    private readonly groupStatus: Record<TableGroup, ExternalStorageSyncGroupStatus> = {
        core: { running: false, lastStartedAt: null, lastSucceededAt: null, lastFailedAt: null, lastError: null, lastCopiedRows: null },
        conversation: { running: false, lastStartedAt: null, lastSucceededAt: null, lastFailedAt: null, lastError: null, lastCopiedRows: null }
    }

    constructor(
        private readonly config: StorageConfig,
        private readonly coreDb: Database,
        private readonly conversationDb: Database,
        private readonly log: Pick<Console, 'warn' | 'log'> = console,
        private readonly strict: boolean = false,
        private readonly exportOptions: ExternalStorageExportOptions = {}
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

    getStatus(): Partial<Record<TableGroup, ExternalStorageSyncGroupStatus>> {
        return {
            ...(this.hasExternalCore ? { core: { ...this.groupStatus.core, running: this.coreRunning } } : {}),
            ...(this.hasExternalConversation ? { conversation: { ...this.groupStatus.conversation, running: this.conversationRunning } } : {})
        }
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
                await connectMysqlClient(sql, this.config.core.mysql, 'importing MySQL core storage snapshot')
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
        this.groupStatus.core = { ...this.groupStatus.core, running: true, lastStartedAt: Date.now(), lastError: null }
        const copied: Record<string, number> = {}
        const sql = createMysqlClient(this.config.core.mysql)
        try {
            await connectMysqlClient(sql, this.config.core.mysql, 'exporting MySQL core storage snapshot')
            for (const table of CORE_TABLES) {
                copied[table] = await replaceMysqlTable(sql, this.coreDb, table)
            }
            this.groupStatus.core = {
                ...this.groupStatus.core,
                running: false,
                lastSucceededAt: Date.now(),
                lastError: null,
                lastCopiedRows: Object.values(copied).reduce((sum, value) => sum + value, 0)
            }
        } catch (error) {
            this.groupStatus.core = {
                ...this.groupStatus.core,
                running: false,
                lastFailedAt: Date.now(),
                lastError: error instanceof Error ? error.message : String(error)
            }
            if (this.strict) throw error
            this.log.warn('[Storage] MySQL snapshot sync failed:', error instanceof Error ? error.message : error)
        } finally {
            this.coreRunning = false
            this.groupStatus.core.running = false
            await sql.close({ timeout: 1 }).catch(() => undefined)
        }
        return copied
    }

    async exportConversationSnapshot(): Promise<Record<string, number>> {
        if (this.config.conversation.backend !== 'elasticsearch') return {}
        if (this.conversationRunning) return {}
        this.conversationRunning = true
        this.groupStatus.conversation = { ...this.groupStatus.conversation, running: true, lastStartedAt: Date.now(), lastError: null }
        const copied: Record<string, number> = {}
        try {
            copied.messages = await replaceElasticTable(this.config.conversation.elasticsearch, this.conversationDb, 'messages', this.exportOptions)
            copied.message_counters = await replaceElasticMessageCounters(this.config.conversation.elasticsearch, this.conversationDb, this.exportOptions)
            copied.message_epochs = await replaceElasticTable(this.config.conversation.elasticsearch, this.conversationDb, 'message_epochs', this.exportOptions)
            if (Object.values(copied).some((value) => value > 0)) {
                await refreshElasticIndex(this.config.conversation.elasticsearch)
            }
            this.groupStatus.conversation = {
                ...this.groupStatus.conversation,
                running: false,
                lastSucceededAt: Date.now(),
                lastError: null,
                lastCopiedRows: Object.values(copied).reduce((sum, value) => sum + value, 0)
            }
        } catch (error) {
            this.groupStatus.conversation = {
                ...this.groupStatus.conversation,
                running: false,
                lastFailedAt: Date.now(),
                lastError: error instanceof Error ? error.message : String(error)
            }
            if (this.strict) throw error
            this.log.warn('[Storage] Elasticsearch snapshot sync failed:', error instanceof Error ? error.message : error)
        } finally {
            this.conversationRunning = false
            this.groupStatus.conversation.running = false
        }
        return copied
    }

    async exportAll(): Promise<Record<string, number>> {
        const conversation = await this.exportConversationSnapshot()
        const core = await this.exportCoreSnapshot()
        return {
            ...Object.fromEntries(Object.entries(conversation).map(([key, value]) => [`conversation.${key}`, value])),
            ...Object.fromEntries(Object.entries(core).map(([key, value]) => [`core.${key}`, value])),
        }
    }
}

export async function importExternalSnapshotToSqlite(
    config: StorageConfig,
    coreDb: Database,
    conversationDb: Database
): Promise<Record<string, number>> {
    const sync = new ExternalStorageSync(config, coreDb, conversationDb, console, true)
    return await sync.importExternalIntoSqlite()
}

export async function exportSqliteSnapshotToExternal(
    config: StorageConfig,
    coreDb: Database,
    conversationDb: Database,
    options: ExternalStorageExportOptions = {}
): Promise<Record<string, number>> {
    const sync = new ExternalStorageSync(config, coreDb, conversationDb, console, true, options)
    return await sync.exportAll()
}
