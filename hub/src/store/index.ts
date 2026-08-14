import { Database } from 'bun:sqlite'
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { StorageConfig } from './storageConfig'
import { ExternalStorageSync, exportSqliteSnapshotToExternal } from './externalStorage'

import { MachineStore } from './machineStore'
import { MessageStore } from './messageStore'
import { PushStore } from './pushStore'
import { FcmStore } from './fcmStore'
import { ScratchlistStore } from './scratchlistStore'
import { SessionStore } from './sessionStore'
import { UserStore } from './userStore'
import { ProjectStore } from './projectStore'

export type {
    StoredMachine,
    StoredMessage,
    StoredPushSubscription,
    StoredFcmDevice,
    StoredScratchlistEntry,
    StoredSession,
    StoredProject,
    StoredProjectInvite,
    StoredProjectMember,
    StoredProjectWorkspace,
    StoredTeam,
    StoredTeamMember,
    StoredUser,
    VersionedUpdateResult
} from './types'
export type { CancelQueuedMessageResult, LookupQueuedMessageResult } from './messages'
export { MachineStore } from './machineStore'
export { MessageStore } from './messageStore'
export { PushStore } from './pushStore'
export { FcmStore } from './fcmStore'
export { ScratchlistStore } from './scratchlistStore'
export { SessionStore } from './sessionStore'
export { UserStore } from './userStore'
export { ProjectStore } from './projectStore'

export const SCHEMA_VERSION: number = 18
const REQUIRED_TABLES = [
    'schema_migrations',
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
    'session_scratchlist'
] as const

export class Store {
    private db: Database
    private conversationDb: Database
    private readonly _dbPath: string
    private readonly _conversationDbPath: string
    private readonly _storageConfig: StorageConfig
    private readonly externalSync: ExternalStorageSync | null
    private closed: boolean = false

    readonly sessions: SessionStore
    readonly machines: MachineStore
    readonly messages: MessageStore
    readonly users: UserStore
    readonly projects: ProjectStore
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
        return {
            conversation: { backend: 'sqlite', sqlite: { path: this._conversationDbPath } },
            core: { backend: 'sqlite', sqlite: { path: this._dbPath } }
        }
    }

    get schemaVersion(): number {
        return this.getUserVersion()
    }

    get expectedSchemaVersion(): number {
        return SCHEMA_VERSION
    }

    constructor(dbPath: string, storageConfig?: StorageConfig) {
        const resolvedStorageConfig = storageConfig ?? {
            conversation: { backend: 'sqlite' as const, sqlite: { path: dbPath } },
            core: { backend: 'sqlite' as const, sqlite: { path: dbPath } }
        }
        this._storageConfig = resolvedStorageConfig
        const mirrorBasePath = dbPath
        dbPath = resolvedStorageConfig.core.backend === 'sqlite'
            ? resolvedStorageConfig.core.sqlite.path
            : `${dbPath}.core-mirror.db`
        const conversationDbPath = resolvedStorageConfig.conversation.backend === 'sqlite'
            ? resolvedStorageConfig.conversation.sqlite.path
            : `${mirrorBasePath}.conversation-mirror.db`
        this._dbPath = dbPath
        this._conversationDbPath = conversationDbPath
        this.ensureSqlitePath(dbPath)
        this.ensureSqlitePath(conversationDbPath)

        this.db = this.openSqliteDatabase(dbPath)
        this.conversationDb = conversationDbPath === dbPath ? this.db : this.openSqliteDatabase(conversationDbPath)
        this.initSchema()
        this.initConversationSchema()
        this.externalSync = new ExternalStorageSync(resolvedStorageConfig, this.db, this.conversationDb)

        this.chmodSqliteFiles(dbPath)
        this.chmodSqliteFiles(conversationDbPath)

        this.sessions = new SessionStore(this.db, (sessionId) => {
            this.messages.deleteMessagesForSession(sessionId)
            this.scheduleConversationSync()
            this.scheduleCoreSync()
        }, () => this.scheduleCoreSync())
        this.machines = new MachineStore(this.db, (sessionIds) => {
            this.messages.deleteMessagesForSessions(sessionIds)
            this.scheduleConversationSync()
            this.scheduleCoreSync()
        }, () => this.scheduleCoreSync())
        this.messages = new MessageStore(this.conversationDb, () => this.scheduleConversationSync())
        this.users = new UserStore(this.db, () => this.scheduleCoreSync())
        this.projects = new ProjectStore(this.db, () => this.scheduleCoreSync())
        this.push = new PushStore(this.db, () => this.scheduleCoreSync())
        this.fcm = new FcmStore(this.db, () => this.scheduleCoreSync())
        this.scratchlist = new ScratchlistStore(this.db, () => this.scheduleCoreSync())
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
    ): number {
        if (this.conversationDb === this.db) {
            return this.db.transaction(() => {
                const changes = this.messages.markMessagesInvoked(sessionId, localIds, invokedAt)
                if (changes > 0) {
                    this.sessions.touchSessionUpdatedAt(sessionId, invokedAt, namespace)
                }

                const session = this.sessions.getSessionByNamespace(sessionId, namespace)
                if (!session) {
                    throw new Error('session not found after messages-consumed transition')
                }
                if (changes > 0 && session.updatedAt < invokedAt) {
                    throw new Error('session activity was not persisted after messages-consumed transition')
                }

                return session.updatedAt
            })()
        }

        const existing = this.sessions.getSessionByNamespace(sessionId, namespace)
        if (!existing) {
            throw new Error('session not found before messages-consumed transition')
        }

        const changes = this.messages.markMessagesInvoked(sessionId, localIds, invokedAt)
        if (changes > 0) {
            this.sessions.touchSessionUpdatedAt(sessionId, invokedAt, namespace)
        }

        const session = this.sessions.getSessionByNamespace(sessionId, namespace)
        if (!session) {
            throw new Error('session not found after messages-consumed transition')
        }
        if (changes > 0 && session.updatedAt < invokedAt) {
            throw new Error('session activity was not persisted after messages-consumed transition')
        }

        return session.updatedAt
    }

    async initializeExternalStorage(): Promise<void> {
        if (!this.externalSync?.active) return
        const imported = await this.externalSync.importExternalIntoSqlite()
        const count = Object.values(imported).reduce((sum, value) => sum + value, 0)
        if (count > 0) {
            console.log(`[Storage] Imported ${count} row(s) from external storage into local mirrors.`)
        }
    }

    async exportExternalSnapshot(config: StorageConfig = this._storageConfig): Promise<Record<string, number>> {
        if (config === this._storageConfig) {
            return await this.externalSync?.exportAll() ?? {}
        }
        return await exportSqliteSnapshotToExternal(config, this.db, this.conversationDb)
    }

    private scheduleCoreSync(): void {
        this.externalSync?.schedule('core')
    }

    private scheduleConversationSync(): void {
        this.externalSync?.schedule('conversation')
    }

    close(): void {
        if (this.closed) return
        this.externalSync?.stop()
        if (this.conversationDb !== this.db) {
            this.conversationDb.close()
        }
        this.db.close()
        this.closed = true

        // Bun's SQLite close uses sqlite3_close_v2 by default, so prepared
        // statements that are already unreachable may keep the underlying file
        // handle alive until the next GC cycle. Windows refuses to remove a
        // directory while those SQLite WAL/SHM handles are still pending.
        if (process.platform === 'win32') {
            Bun.gc(true)
        }
    }

    private isMemorySqlitePath(dbPath: string): boolean {
        return dbPath === ':memory:' || dbPath.startsWith('file::memory:')
    }

    private ensureSqlitePath(dbPath: string): void {
        if (this.isMemorySqlitePath(dbPath)) return
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

    private chmodSqliteFiles(dbPath: string): void {
        if (this.isMemorySqlitePath(dbPath)) return
        for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
            try {
                chmodSync(path, 0o600)
            } catch {
            }
        }
    }

    private openSqliteDatabase(dbPath: string): Database {
        const db = new Database(dbPath, { create: true, readwrite: true, strict: true })
        db.exec('PRAGMA journal_mode = WAL')
        db.exec('PRAGMA synchronous = NORMAL')
        db.exec('PRAGMA foreign_keys = ON')
        db.exec('PRAGMA busy_timeout = 5000')
        return db
    }

    private initConversationSchema(): void {
        const currentVersion = this.getUserVersion(this.conversationDb)
        if (currentVersion === 0) {
            this.createConversationSchema()
            this.setUserVersion(SCHEMA_VERSION, this.conversationDb)
            return
        }
        if (currentVersion !== SCHEMA_VERSION) {
            throw this.buildSchemaMismatchError(currentVersion, this._conversationDbPath)
        }
        this.createConversationSchema()
        this.assertConversationTablesPresent()
    }

    private createConversationSchema(): void {
        this.conversationDb.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                seq INTEGER NOT NULL,
                local_id TEXT,
                invoked_at INTEGER,
                scheduled_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_local_id ON messages(session_id, local_id) WHERE local_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_messages_session_position
                ON messages(session_id, COALESCE(invoked_at, created_at) DESC, seq DESC);
            CREATE INDEX IF NOT EXISTS idx_messages_scheduled_pending
                ON messages(scheduled_at)
                WHERE scheduled_at IS NOT NULL AND invoked_at IS NULL;

            CREATE TABLE IF NOT EXISTS message_epochs (
                session_id TEXT PRIMARY KEY,
                epoch INTEGER NOT NULL DEFAULT 0
            );
        `)
    }

    private initSchema(): void {
        const currentVersion = this.getUserVersion()
        // V1/V2/V3 entries cover legacy DBs that pre-date our migration ladder.
        // Each step is idempotent (column/table-existence guards inside) so we can
        // safely run the full chain in the legacy branch where the DB shape is unknown.
        const buildStepMigrations = (legacy: boolean): Record<number, () => void> => ({
            1: () => this.migrateFromV1ToV2(legacy),
            2: () => this.migrateFromV2ToV3(),
            3: () => this.migrateFromV3ToV4(),
            4: () => this.migrateFromV4ToV5(),
            5: () => this.migrateFromV5ToV6(),
            6: () => this.migrateFromV6ToV7(),
            7: () => this.migrateFromV7ToV8(),
            8: () => this.migrateFromV8ToV9(),
            9: () => this.migrateFromV9ToV10(),
            10: () => this.migrateFromV10ToV11(),
            11: () => this.migrateFromV11ToV12(),
            12: () => this.migrateFromV12ToV13(),
            13: () => this.migrateFromV13ToV14(),
            14: () => this.migrateFromV14ToV15(),
            15: () => this.migrateFromV15ToV16(),
            16: () => this.migrateFromV16ToV17(),
            17: () => this.migrateFromV17ToV18(),
        })

        if (currentVersion === 0) {
            if (this.hasAnyUserTables()) {
                const backupPath = this.backupDatabaseForMigration(currentVersion, SCHEMA_VERSION)
                this.migrateLegacySchemaIfNeeded()
                // Run the full step ladder BEFORE createSchema so legacy tables
                // pick up every later-version column (e.g. invoked_at) via ALTER
                // TABLE.  Without this, createSchema below would try to build
                // idx_messages_session_position over a column that does not
                // exist yet, and CREATE TABLE IF NOT EXISTS would not add the
                // missing column to the existing table.
                const legacySteps = buildStepMigrations(true)
                for (let v = 1; v < SCHEMA_VERSION; v++) {
                    legacySteps[v]?.()
                }
                // Backfill any *missing* tables (sessions, machines, ...) that
                // a partially-built legacy DB may not have yet.
                this.createSchema()
                this.setUserVersion(SCHEMA_VERSION)
                this.recordSchemaMigration(0, SCHEMA_VERSION, Date.now(), backupPath)
                return
            }

            this.createSchema()
            this.setUserVersion(SCHEMA_VERSION)
            this.recordSchemaMigration(0, SCHEMA_VERSION, Date.now(), null)
            return
        }

        const stepMigrations = buildStepMigrations(false)
        if (currentVersion < SCHEMA_VERSION && stepMigrations[currentVersion]) {
            const backupPath = this.backupDatabaseForMigration(currentVersion, SCHEMA_VERSION)
            for (let v = currentVersion; v < SCHEMA_VERSION; v++) {
                const step = stepMigrations[v]
                if (!step) throw this.buildSchemaMismatchError(currentVersion)
                this.runSchemaMigrationStep(v, v + 1, backupPath, step)
            }
            return
        }

        if (currentVersion !== SCHEMA_VERSION) {
            throw this.buildSchemaMismatchError(currentVersion)
        }

        this.assertRequiredTablesPresent()
    }

    private createSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                tag TEXT,
                namespace TEXT NOT NULL DEFAULT 'default',
                project_id TEXT,
                created_by_user_id INTEGER,
                machine_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT,
                metadata_version INTEGER DEFAULT 1,
                agent_state TEXT,
                agent_state_version INTEGER DEFAULT 1,
                model TEXT,
                model_reasoning_effort TEXT,
                effort TEXT,
                service_tier TEXT,
                todos TEXT,
                todos_updated_at INTEGER,
                team_state TEXT,
                team_state_updated_at INTEGER,
                active INTEGER DEFAULT 0,
                active_at INTEGER,
                seq INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_tag ON sessions(tag);
            CREATE INDEX IF NOT EXISTS idx_sessions_tag_namespace ON sessions(tag, namespace);
            CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);

            CREATE TABLE IF NOT EXISTS machines (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                owner_user_id INTEGER,
                team_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT,
                metadata_version INTEGER DEFAULT 1,
                runner_state TEXT,
                runner_state_version INTEGER DEFAULT 1,
                active INTEGER DEFAULT 0,
                active_at INTEGER,
                seq INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_machines_namespace ON machines(namespace);
            CREATE INDEX IF NOT EXISTS idx_machines_team ON machines(team_id);


            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                platform_user_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                username TEXT,
                username_normalized TEXT,
                display_name TEXT,
                password_hash TEXT,
                access_token TEXT,
                access_token_hash TEXT,
                role TEXT NOT NULL DEFAULT 'user',
                disabled_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER,
                UNIQUE(platform, platform_user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_users_platform ON users(platform);
            CREATE INDEX IF NOT EXISTS idx_users_platform_namespace ON users(platform, namespace);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_local_username_namespace
                ON users(namespace, username_normalized)
                WHERE platform = 'local' AND username_normalized IS NOT NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_access_token_hash
                ON users(access_token_hash)
                WHERE access_token_hash IS NOT NULL;

            CREATE TABLE IF NOT EXISTS teams (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                name TEXT NOT NULL,
                created_by_user_id INTEGER,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_teams_namespace ON teams(namespace);

            CREATE TABLE IF NOT EXISTS team_members (
                team_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (team_id, user_id),
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                team_id TEXT NOT NULL,
                name TEXT NOT NULL,
                repo_url TEXT,
                created_by_user_id INTEGER,
                created_at INTEGER NOT NULL,
                archived_at INTEGER,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_projects_namespace ON projects(namespace);
            CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);

            CREATE TABLE IF NOT EXISTS project_members (
                project_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (project_id, user_id),
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

            CREATE TABLE IF NOT EXISTS project_workspaces (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                machine_id TEXT NOT NULL,
                root_path TEXT NOT NULL,
                created_by_user_id INTEGER,
                created_at INTEGER NOT NULL,
                UNIQUE(project_id, machine_id, root_path),
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_project_workspaces_project ON project_workspaces(project_id);
            CREATE INDEX IF NOT EXISTS idx_project_workspaces_machine ON project_workspaces(machine_id);

            CREATE TABLE IF NOT EXISTS project_invites (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                role TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_by_user_id INTEGER,
                created_at INTEGER NOT NULL,
                accepted_at INTEGER,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_project_invites_project ON project_invites(project_id);
            CREATE INDEX IF NOT EXISTS idx_project_invites_token_hash ON project_invites(token_hash);

            CREATE TABLE IF NOT EXISTS audit_log (
                id TEXT PRIMARY KEY,
                actor_user_id INTEGER,
                action TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                resource_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                metadata TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);

            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                namespace TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(namespace, endpoint)
            );
            CREATE INDEX IF NOT EXISTS idx_push_subscriptions_namespace ON push_subscriptions(namespace);

            CREATE TABLE IF NOT EXISTS fcm_devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                namespace TEXT NOT NULL,
                token TEXT NOT NULL,
                platform TEXT NOT NULL,
                device_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(namespace, device_id, platform)
            );
            CREATE INDEX IF NOT EXISTS idx_fcm_devices_namespace ON fcm_devices(namespace);
            CREATE INDEX IF NOT EXISTS idx_fcm_devices_token ON fcm_devices(token);

            CREATE TABLE IF NOT EXISTS session_scratchlist (
                session_id TEXT NOT NULL,
                entry_id TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                attachments TEXT DEFAULT NULL,
                PRIMARY KEY (session_id, entry_id),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_session_scratchlist_session_created
                ON session_scratchlist(session_id, created_at DESC);
        `)
        this.createSchemaMigrationsTable()
    }

    private migrateLegacySchemaIfNeeded(): void {
        const columns = this.getMachineColumnNames()
        if (columns.size === 0) {
            return
        }

        const hasDaemon = columns.has('daemon_state') || columns.has('daemon_state_version')
        const hasRunner = columns.has('runner_state') || columns.has('runner_state_version')

        if (hasDaemon && hasRunner) {
            throw new Error('SQLite schema has both daemon_state and runner_state columns in machines; manual cleanup required.')
        }

        if (hasDaemon && !hasRunner) {
            this.migrateFromV1ToV2()
        }
    }

    private migrateFromV1ToV2(legacy: boolean = false): void {
        const columns = this.getMachineColumnNames()
        if (columns.size === 0) {
            // In the legacy branch the table may not exist yet — createSchema
            // will build the up-to-date one.  When invoked from the regular
            // upgrade path (user_version >= 1), missing the machines table is
            // still an error.
            if (legacy) return
            throw new Error('SQLite schema missing machines table for v1 to v2 migration.')
        }

        const hasDaemon = columns.has('daemon_state') && columns.has('daemon_state_version')
        const hasRunner = columns.has('runner_state') && columns.has('runner_state_version')

        if (hasRunner && !hasDaemon) {
            return
        }

        if (!hasDaemon) {
            if (legacy) return
            throw new Error('SQLite schema missing daemon_state columns for v1 to v2 migration.')
        }

        try {
            this.db.exec('BEGIN')
            this.db.exec('ALTER TABLE machines RENAME COLUMN daemon_state TO runner_state')
            this.db.exec('ALTER TABLE machines RENAME COLUMN daemon_state_version TO runner_state_version')
            this.db.exec('COMMIT')
            return
        } catch (error) {
            this.db.exec('ROLLBACK')
        }

        try {
            this.db.exec('BEGIN')
            this.db.exec(`
                CREATE TABLE machines_new (
                    id TEXT PRIMARY KEY,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    metadata TEXT,
                    metadata_version INTEGER DEFAULT 1,
                    runner_state TEXT,
                    runner_state_version INTEGER DEFAULT 1,
                    active INTEGER DEFAULT 0,
                    active_at INTEGER,
                    seq INTEGER DEFAULT 0
                );
            `)
            this.db.exec(`
                INSERT INTO machines_new (
                    id, namespace, created_at, updated_at,
                    metadata, metadata_version,
                    runner_state, runner_state_version,
                    active, active_at, seq
                )
                SELECT id, namespace, created_at, updated_at,
                       metadata, metadata_version,
                       daemon_state, daemon_state_version,
                       active, active_at, seq
                FROM machines;
            `)
            this.db.exec('DROP TABLE machines')
            this.db.exec('ALTER TABLE machines_new RENAME TO machines')
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_machines_namespace ON machines(namespace)')
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite schema migration v1->v2 failed: ${message}`)
        }
    }

    private migrateFromV2ToV3(): void {
        return
    }

    private migrateFromV3ToV4(): void {
        const columns = this.getSessionColumnNames()
        // When the legacy branch invokes the full step ladder, an upstream-only
        // DB may not have the sessions table yet — createSchema runs after the
        // ladder.  Skip ALTERs in that case; createSchema will build the table
        // with the up-to-date columns.
        if (columns.size === 0) return
        if (!columns.has('team_state')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN team_state TEXT')
        }
        if (!columns.has('team_state_updated_at')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN team_state_updated_at INTEGER')
        }
    }

    private migrateFromV4ToV5(): void {
        const columns = this.getSessionColumnNames()
        if (columns.size === 0) return
        if (!columns.has('model')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN model TEXT')
        }
    }

    private migrateFromV5ToV6(): void {
        const columns = this.getSessionColumnNames()
        if (columns.size === 0) return
        if (!columns.has('effort')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN effort TEXT')
        }
    }

    private migrateFromV6ToV7(): void {
        const columns = this.getSessionColumnNames()
        if (columns.size === 0) return
        if (!columns.has('model_reasoning_effort')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN model_reasoning_effort TEXT')
        }
    }

    private migrateFromV7ToV8(): void {
        const columns = this.getMessageColumnNames()
        if (columns.size === 0) {
            // No messages table yet — createSchema will build the up-to-date one.
            return
        }
        if (!columns.has('invoked_at')) {
            this.db.exec('ALTER TABLE messages ADD COLUMN invoked_at INTEGER')
        }
        // Idempotent (WHERE invoked_at IS NULL); safe to re-run if a previous attempt
        // crashed between ALTER and UPDATE before user_version was bumped.
        this.db.exec('UPDATE messages SET invoked_at = created_at WHERE invoked_at IS NULL')
        // Position index for byPosition pagination — idempotent via IF NOT EXISTS.
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_messages_session_position
                ON messages(session_id, COALESCE(invoked_at, created_at) DESC, seq DESC)
        `)
    }

    private migrateFromV8ToV9(): void {
        const columns = this.getMessageColumnNames()
        if (columns.size === 0) {
            // No messages table yet — createSchema will build the up-to-date one.
            return
        }
        if (!columns.has('scheduled_at')) {
            this.db.exec('ALTER TABLE messages ADD COLUMN scheduled_at INTEGER')
        }
        // Partial index for efficient mature scheduled message lookup.
        // Idempotent via IF NOT EXISTS.
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_messages_scheduled_pending
                ON messages(scheduled_at)
                WHERE scheduled_at IS NOT NULL AND invoked_at IS NULL
        `)
    }

    private migrateFromV9ToV10(): void {
        const columns = this.getSessionColumnNames()
        if (columns.size === 0) return
        if (!columns.has('service_tier')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN service_tier TEXT')
        }
    }

    private migrateFromV10ToV11(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS fcm_devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                namespace TEXT NOT NULL,
                token TEXT NOT NULL,
                platform TEXT NOT NULL,
                device_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(namespace, device_id, platform)
            );
            CREATE INDEX IF NOT EXISTS idx_fcm_devices_namespace ON fcm_devices(namespace);
            CREATE INDEX IF NOT EXISTS idx_fcm_devices_token ON fcm_devices(token);
        `)
    }

    /**
     * tiann/hapi#893 (scratchlist v2): introduce the per-session
     * `session_scratchlist` typed table. Upstream main took V10→V11 for
     * `fcm_devices`; scratchlist is V11→V12.
     *
     * Idempotent via `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT
     * EXISTS`. Cascade-delete from `sessions(id)` handles delete-session
     * cleanup. No data backfill: the web client's first-run migration
     * pushes any existing `localStorage` entries up via REST.
     *
     * Rollback: `DROP TABLE session_scratchlist; PRAGMA user_version = 11;`
     */
    private migrateFromV11ToV12(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS session_scratchlist (
                session_id TEXT NOT NULL,
                entry_id TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (session_id, entry_id),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_session_scratchlist_session_created
                ON session_scratchlist(session_id, created_at DESC);
        `)
    }

    private migrateFromV12ToV13(): void {
        // Two development branches previously used schema v12 for different
        // tables. Reconcile both shapes before advancing the version.
        this.migrateFromV11ToV12()
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS message_epochs (
                session_id TEXT PRIMARY KEY,
                epoch INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
        `)
    }

    private migrateFromV13ToV14(): void {
        // Repair v13 databases produced before the divergent v12 migrations
        // were reconciled. Both underlying migrations are idempotent.
        this.migrateFromV12ToV13()
    }

    /**
     * tiann/hapi#921 (scratchlist v2.2): attachment metadata JSON column.
     * Bytes live on hub filesystem under HAPI_HOME/scratchlist-attachments/.
     * Upstream ladder: V11→V12 = session_scratchlist (#896); V12–V14 =
     * message_epochs reconciliation; this step is V14→V15 for attachments.
     *
     * Rollback: `ALTER TABLE session_scratchlist DROP COLUMN attachments` is
     * unsupported on older SQLite; rebuild DB or leave column unused.
     */
    private migrateFromV14ToV15(): void {
        const columns = this.db.prepare('PRAGMA table_info(session_scratchlist)').all() as Array<{ name: string }>
        if (!columns.some((col) => col.name === 'attachments')) {
            this.db.exec(`ALTER TABLE session_scratchlist ADD COLUMN attachments TEXT DEFAULT NULL`)
        }
    }

    /**
     * Multi-user project sharing foundation. Adds project/team ACL tables and
     * nullable ownership columns on existing rows. Backfill needs the runtime
     * owner id, so it is performed lazily by auth/CLI startup instead of inside
     * this synchronous migration.
     */
    private migrateFromV15ToV16(): void {
        const sessionColumns = this.getSessionColumnNames()
        if (sessionColumns.size > 0) {
            if (!sessionColumns.has('project_id')) {
                this.db.exec('ALTER TABLE sessions ADD COLUMN project_id TEXT')
            }
            if (!sessionColumns.has('created_by_user_id')) {
                this.db.exec('ALTER TABLE sessions ADD COLUMN created_by_user_id INTEGER')
            }
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)')
        }

        const machineColumns = this.getMachineColumnNames()
        if (machineColumns.size > 0) {
            if (!machineColumns.has('owner_user_id')) {
                this.db.exec('ALTER TABLE machines ADD COLUMN owner_user_id INTEGER')
            }
            if (!machineColumns.has('team_id')) {
                this.db.exec('ALTER TABLE machines ADD COLUMN team_id TEXT')
            }
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_machines_team ON machines(team_id)')
        }

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS teams (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                name TEXT NOT NULL,
                created_by_user_id INTEGER,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_teams_namespace ON teams(namespace);

            CREATE TABLE IF NOT EXISTS team_members (
                team_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (team_id, user_id),
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                team_id TEXT NOT NULL,
                name TEXT NOT NULL,
                repo_url TEXT,
                created_by_user_id INTEGER,
                created_at INTEGER NOT NULL,
                archived_at INTEGER,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_projects_namespace ON projects(namespace);
            CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);

            CREATE TABLE IF NOT EXISTS project_members (
                project_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (project_id, user_id),
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

            CREATE TABLE IF NOT EXISTS project_workspaces (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                machine_id TEXT NOT NULL,
                root_path TEXT NOT NULL,
                created_by_user_id INTEGER,
                created_at INTEGER NOT NULL,
                UNIQUE(project_id, machine_id, root_path),
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_project_workspaces_project ON project_workspaces(project_id);
            CREATE INDEX IF NOT EXISTS idx_project_workspaces_machine ON project_workspaces(machine_id);

            CREATE TABLE IF NOT EXISTS project_invites (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                role TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_by_user_id INTEGER,
                created_at INTEGER NOT NULL,
                accepted_at INTEGER,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_project_invites_project ON project_invites(project_id);
            CREATE INDEX IF NOT EXISTS idx_project_invites_token_hash ON project_invites(token_hash);

            CREATE TABLE IF NOT EXISTS audit_log (
                id TEXT PRIMARY KEY,
                actor_user_id INTEGER,
                action TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                resource_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                metadata TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);
        `)
    }

    /**
     * Enterprise local accounts. Adds password/token/profile fields to the
     * existing multi-provider users table; Telegram rows keep these nullable.
     */
    private migrateFromV16ToV17(): void {
        const columns = this.getUserColumnNames()
        if (columns.size === 0) return

        if (!columns.has('username')) {
            this.db.exec('ALTER TABLE users ADD COLUMN username TEXT')
        }
        if (!columns.has('username_normalized')) {
            this.db.exec('ALTER TABLE users ADD COLUMN username_normalized TEXT')
        }
        if (!columns.has('display_name')) {
            this.db.exec('ALTER TABLE users ADD COLUMN display_name TEXT')
        }
        if (!columns.has('password_hash')) {
            this.db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT')
        }
        if (!columns.has('access_token')) {
            this.db.exec('ALTER TABLE users ADD COLUMN access_token TEXT')
        }
        if (!columns.has('access_token_hash')) {
            this.db.exec('ALTER TABLE users ADD COLUMN access_token_hash TEXT')
        }
        if (!columns.has('role')) {
            this.db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
        }
        if (!columns.has('disabled_at')) {
            this.db.exec('ALTER TABLE users ADD COLUMN disabled_at INTEGER')
        }
        if (!columns.has('updated_at')) {
            this.db.exec('ALTER TABLE users ADD COLUMN updated_at INTEGER')
            this.db.exec('UPDATE users SET updated_at = created_at WHERE updated_at IS NULL')
        }

        this.db.exec(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_local_username_namespace
                ON users(namespace, username_normalized)
                WHERE platform = 'local' AND username_normalized IS NOT NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_access_token_hash
                ON users(access_token_hash)
                WHERE access_token_hash IS NOT NULL;
        `)
    }

    /**
     * Persistent migration ledger. SQLite already stores the current schema in
     * `PRAGMA user_version`; this table records how a production database got
     * there, including the automatic backup created before an upgrade.
     */
    private migrateFromV17ToV18(): void {
        this.createSchemaMigrationsTable()
    }

    private createSchemaMigrationsTable(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_version INTEGER NOT NULL,
                to_version INTEGER NOT NULL,
                applied_at INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL,
                backup_path TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_schema_migrations_to_version
                ON schema_migrations(to_version);
        `)
    }

    private runSchemaMigrationStep(fromVersion: number, toVersion: number, backupPath: string | null, step: () => void): void {
        const startedAt = Date.now()
        try {
            step()
            this.setUserVersion(toVersion)
            this.recordSchemaMigration(fromVersion, toVersion, startedAt, backupPath)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const backupHint = backupPath ? ` Backup created at: ${backupPath}.` : ''
            throw new Error(`SQLite schema migration v${fromVersion}->v${toVersion} failed: ${message}.${backupHint}`)
        }
    }

    private recordSchemaMigration(fromVersion: number, toVersion: number, startedAt: number, backupPath: string | null): void {
        this.createSchemaMigrationsTable()
        const finishedAt = Date.now()
        this.db.prepare(`
            INSERT INTO schema_migrations (
                from_version,
                to_version,
                applied_at,
                duration_ms,
                backup_path
            )
            VALUES (?, ?, ?, ?, ?)
        `).run(fromVersion, toVersion, finishedAt, Math.max(0, finishedAt - startedAt), backupPath)
    }

    private backupDatabaseForMigration(fromVersion: number, toVersion: number): string | null {
        if (this._dbPath === ':memory:' || this._dbPath.startsWith('file::memory:')) return null
        if (!existsSync(this._dbPath)) return null

        const backupDir = join(dirname(this._dbPath), 'backups')
        mkdirSync(backupDir, { recursive: true, mode: 0o700 })
        try {
            chmodSync(backupDir, 0o700)
        } catch {
        }

        this.db.exec('PRAGMA wal_checkpoint(FULL)')
        const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
        const prefix = `${basename(this._dbPath)}.v${fromVersion}-to-v${toVersion}.${stamp}`
        const backupPath = join(backupDir, `${prefix}.bak`)
        copyFileSync(this._dbPath, backupPath)
        this.chmodPrivate(backupPath)

        for (const suffix of ['-wal', '-shm']) {
            const source = `${this._dbPath}${suffix}`
            if (!existsSync(source)) continue
            const sidecar = join(backupDir, `${prefix}${suffix}.bak`)
            copyFileSync(source, sidecar)
            this.chmodPrivate(sidecar)
        }

        return backupPath
    }

    private chmodPrivate(path: string): void {
        try {
            chmodSync(path, 0o600)
        } catch {
        }
    }

    private getSessionColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getMachineColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(machines)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getMessageColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getUserColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getUserVersion(db: Database = this.db): number {
        const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
        return row?.user_version ?? 0
    }

    private setUserVersion(version: number, db: Database = this.db): void {
        db.exec(`PRAGMA user_version = ${version}`)
    }

    private hasAnyUserTables(): boolean {
        const row = this.db.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1"
        ).get() as { name?: string } | undefined
        return Boolean(row?.name)
    }

    private assertRequiredTablesPresent(): void {
        const placeholders = REQUIRED_TABLES.map(() => '?').join(', ')
        const rows = this.db.prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`
        ).all(...REQUIRED_TABLES) as Array<{ name: string }>
        const existing = new Set(rows.map((row) => row.name))
        const missing = REQUIRED_TABLES.filter((table) => !existing.has(table))

        if (missing.length > 0) {
            throw new Error(
                `SQLite schema is missing required tables (${missing.join(', ')}). ` +
                'Back up and rebuild the database, or run an offline migration to the expected schema version.'
            )
        }
    }

    private assertConversationTablesPresent(): void {
        const rows = this.conversationDb.prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('messages', 'message_epochs')`
        ).all() as Array<{ name: string }>
        const existing = new Set(rows.map((row) => row.name))
        const missing = ['messages', 'message_epochs'].filter((table) => !existing.has(table))
        if (missing.length > 0) {
            throw new Error(
                `SQLite conversation schema is missing required tables (${missing.join(', ')}). ` +
                'Back up and rebuild the conversation database, or run an offline migration.'
            )
        }
    }

    private buildSchemaMismatchError(currentVersion: number, dbPath: string = this._dbPath): Error {
        const location = this.isMemorySqlitePath(dbPath)
            ? 'in-memory database'
            : dbPath
        return new Error(
            `SQLite schema version mismatch for ${location}. ` +
            `Expected ${SCHEMA_VERSION}, found ${currentVersion}. ` +
            'This build does not run compatibility migrations. ' +
            'Back up and rebuild the database, or run an offline migration to the expected schema version.'
        )
    }
}
