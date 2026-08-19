import type { Database } from 'bun:sqlite'
import { isMemorySqlitePath } from './lifecycle'

export const REQUIRED_TABLES = [
    'schema_migrations',
    'app_settings',
    'codex_import_jobs',
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

export function createCoreSchema(db: Database): void {
        db.exec(`
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

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS codex_import_jobs (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                user_id INTEGER,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_codex_import_jobs_namespace_created
                ON codex_import_jobs(namespace, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_codex_import_jobs_user
                ON codex_import_jobs(namespace, user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_codex_import_jobs_status
                ON codex_import_jobs(status);

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
        createSchemaMigrationsTable(db)
    }

export function createConversationSchema(db: Database): void {
        db.exec(`
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

export function createAppSettingsTable(db: Database): void {
        db.exec(`
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
        `)
    }

export function createCodexImportJobsTable(db: Database): void {
        db.exec(`
            CREATE TABLE IF NOT EXISTS codex_import_jobs (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                user_id INTEGER,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_codex_import_jobs_namespace_created
                ON codex_import_jobs(namespace, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_codex_import_jobs_user
                ON codex_import_jobs(namespace, user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_codex_import_jobs_status
                ON codex_import_jobs(status);
        `)
    }

export function createSchemaMigrationsTable(db: Database): void {
        db.exec(`
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

export function sqliteColumnNames(db: Database, table: string): Set<string> {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return new Set(rows.map((row) => row.name))
}

export function getSqliteUserVersion(db: Database): number {
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
    return row?.user_version ?? 0
}

export function setSqliteUserVersion(db: Database, version: number): void {
    db.exec(`PRAGMA user_version = ${version}`)
}

export function hasAnyUserTables(db: Database): boolean {
    const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1"
    ).get() as { name?: string } | undefined
    return Boolean(row?.name)
}

export function assertRequiredTablesPresent(db: Database): void {
    const placeholders = REQUIRED_TABLES.map(() => '?').join(', ')
    const rows = db.prepare(
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

export function assertConversationTablesPresent(db: Database): void {
    const rows = db.prepare(
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

export function buildSqliteSchemaMismatchError(dbPath: string, currentVersion: number, expectedVersion: number): Error {
    const location = isMemorySqlitePath(dbPath)
        ? 'in-memory database'
        : dbPath
    return new Error(
        `SQLite schema version mismatch for ${location}. ` +
        `Expected ${expectedVersion}, found ${currentVersion}. ` +
        'This build does not run compatibility migrations. ' +
        'Back up and rebuild the database, or run an offline migration to the expected schema version.'
    )
}
