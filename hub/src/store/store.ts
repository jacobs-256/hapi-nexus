import type { Database } from 'bun:sqlite'
import type { StorageConfig } from './storageConfig'
import type { ExternalStorageSync, ExternalStorageExportOptions, ExternalStorageSyncGroupStatus } from './external'

import type { MachineStore } from './machineStore'
import type { ConversationStore } from './ports/conversationStore'
import type { CoreStores } from './ports/coreStores'
import type { PushStore } from './pushStore'
import type { FcmStore } from './fcmStore'
import type { ScratchlistStore } from './scratchlistStore'
import type { AppSettingsStore } from './appSettingsStore'
import type { CodexImportJobStore } from './codexImportJobStore'
import type { SessionStore } from './sessionStore'
import type { UserStore } from './userStore'
import type { ProjectStore } from './projectStore'
import { deleteConversationMessagesForSession, deleteConversationMessagesForSessions } from './conversationDeletionCoordinator'
import { closeStoreRuntime } from './storeCloser'
import { initializeExternalStorageRuntime } from './external'
import { exportExternalSnapshotFromRuntime } from './external'
import { recordMessagesConsumedActivity } from './messageConsumptionRecorder'
import { buildStoreRuntime } from './storeRuntimeBuilder'
import { externalStorageSyncStatus, sqliteMirrorStorageConfig, sqliteSchemaVersion } from './storeIntrospection'

export const SCHEMA_VERSION: number = 20
export class Store {
    private db!: Database
    private conversationDb!: Database
    private readonly _dbPath: string
    private readonly _conversationDbPath: string
    private readonly _storageConfig: StorageConfig
    private readonly externalSync: ExternalStorageSync | null
    private closed: boolean = false

    readonly coreStores: CoreStores
    readonly sessions: SessionStore
    readonly machines: MachineStore
    readonly messages: ConversationStore
    readonly users: UserStore
    readonly projects: ProjectStore
    readonly appSettings: AppSettingsStore
    readonly codexImportJobs: CodexImportJobStore
    readonly push: PushStore
    readonly fcm: FcmStore
    readonly scratchlist: ScratchlistStore

    /**
     * Filesystem path of the underlying SQLite database, or ':memory:' for
     * in-memory stores. Used by the legacy → ACP migrator (#824) to take a
     * backup before a bulk run; treat as read-only.
     */
    get dbPath(): string {
        return this._dbPath
    }

    get conversationDbPath(): string {
        return this._conversationDbPath
    }

    get storageConfig(): StorageConfig {
        return this._storageConfig
    }

    get sqliteMirrorStorageConfig(): StorageConfig {
        return sqliteMirrorStorageConfig(this._dbPath, this._conversationDbPath)
    }

    getExternalStorageSyncStatus(): Partial<Record<'core' | 'conversation', ExternalStorageSyncGroupStatus>> {
        return externalStorageSyncStatus(this.externalSync)
    }

    get schemaVersion(): number {
        return sqliteSchemaVersion(this.db)
    }

    get expectedSchemaVersion(): number {
        return SCHEMA_VERSION
    }

    constructor(dbPath: string, storageConfig?: StorageConfig) {
        const runtime = buildStoreRuntime(dbPath, storageConfig, SCHEMA_VERSION, {
            scheduleCoreSync: () => this.scheduleCoreSync(),
            scheduleConversationSync: () => this.scheduleConversationSync(),
            deleteMessagesForSession: (sessionId) => this.deleteMessagesForSessionFromCallback(sessionId),
            deleteMessagesForSessions: (sessionIds) => this.deleteMessagesForSessionsFromCallback(sessionIds),
            warn: console.warn
        })

        this._storageConfig = runtime.storageConfig
        this._dbPath = runtime.dbPath
        this._conversationDbPath = runtime.conversationDbPath
        this.db = runtime.coreDb
        this.conversationDb = runtime.conversationDb
        this.externalSync = runtime.externalSync
        this.messages = runtime.messages
        this.coreStores = runtime.coreStores
        this.sessions = runtime.coreStores.sessions as SessionStore
        this.machines = runtime.coreStores.machines as MachineStore
        this.users = runtime.coreStores.users as UserStore
        this.projects = runtime.coreStores.projects as ProjectStore
        this.appSettings = runtime.coreStores.appSettings as AppSettingsStore
        this.codexImportJobs = runtime.coreStores.codexImportJobs as CodexImportJobStore
        this.push = runtime.coreStores.push as PushStore
        this.fcm = runtime.coreStores.fcm as FcmStore
        this.scratchlist = runtime.coreStores.scratchlist as ScratchlistStore
    }

    private async deleteMessagesForSessionFromCallback(sessionId: string): Promise<void> {
        await deleteConversationMessagesForSession(this.messages, sessionId, () => this.scheduleConversationSync())
    }

    private async deleteMessagesForSessionsFromCallback(sessionIds: string[]): Promise<void> {
        await deleteConversationMessagesForSessions(this.messages, sessionIds, () => this.scheduleConversationSync())
    }

    /**
     * Atomically records a CLI prompt-consumption acknowledgement and returns
     * the persisted session activity timestamp. A duplicate or sibling-stamped
     * acknowledgement leaves the session untouched while returning its existing
     * timestamp for replay-safe in-memory cache synchronization.
     */
    recordMessagesConsumed(
        sessionId: string,
        localIds: string[],
        invokedAt: number,
        namespace: string
    ): number | Promise<number> {
        return recordMessagesConsumedActivity({
            storageConfig: this._storageConfig,
            coreDb: this.db,
            conversationDb: this.conversationDb,
            messages: this.messages,
            sessions: this.sessions,
            sessionId,
            localIds,
            invokedAt,
            namespace
        })
    }

    async initializeExternalStorage(): Promise<void> {
        await initializeExternalStorageRuntime(this._storageConfig, this.externalSync)
    }

    async exportExternalSnapshot(config: StorageConfig = this._storageConfig, options: ExternalStorageExportOptions = {}): Promise<Record<string, number>> {
        return await exportExternalSnapshotFromRuntime({
            targetConfig: config,
            activeConfig: this._storageConfig,
            coreDb: this.db,
            conversationDb: this.conversationDb,
            dbPath: this._dbPath,
            conversationDbPath: this._conversationDbPath,
            exportOptions: options
        })
    }

    private scheduleCoreSync(): void {
        this.externalSync?.schedule('core')
    }

    private scheduleConversationSync(): void {
        this.externalSync?.schedule('conversation')
    }

    close(): void {
        if (this.closed) return
        closeStoreRuntime(this.db, this.conversationDb, this.externalSync)
        this.closed = true
    }
}
