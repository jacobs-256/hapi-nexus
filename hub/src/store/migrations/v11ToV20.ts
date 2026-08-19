import type { Database } from 'bun:sqlite'
import {
    createAppSettingsTable,
    createCodexImportJobsTable,
    createSchemaMigrationsTable,
    sqliteColumnNames
} from '../sqlite/schema'

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
export function migrateFromV11ToV12(db: Database): void {
    db.exec(`
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

export function migrateFromV12ToV13(db: Database): void {
    // Two development branches previously used schema v12 for different
    // tables. Reconcile both shapes before advancing the version.
    migrateFromV11ToV12(db)
    db.exec(`
        CREATE TABLE IF NOT EXISTS message_epochs (
            session_id TEXT PRIMARY KEY,
            epoch INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )
    `)
}

export function migrateFromV13ToV14(db: Database): void {
    // Repair v13 databases produced before the divergent v12 migrations
    // were reconciled. Both underlying migrations are idempotent.
    migrateFromV12ToV13(db)
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
export function migrateFromV14ToV15(db: Database): void {
    const columns = db.prepare('PRAGMA table_info(session_scratchlist)').all() as Array<{ name: string }>
    if (!columns.some((col) => col.name === 'attachments')) {
        db.exec(`ALTER TABLE session_scratchlist ADD COLUMN attachments TEXT DEFAULT NULL`)
    }
}

/**
 * Multi-user project sharing foundation. Adds project/team ACL tables and
 * nullable ownership columns on existing rows. Backfill needs the runtime
 * owner id, so it is performed lazily by auth/CLI startup instead of inside
 * this synchronous migration.
 */
export function migrateFromV15ToV16(db: Database): void {
    const sessionColumns = sqliteColumnNames(db, 'sessions')
    if (sessionColumns.size > 0) {
        if (!sessionColumns.has('project_id')) {
            db.exec('ALTER TABLE sessions ADD COLUMN project_id TEXT')
        }
        if (!sessionColumns.has('created_by_user_id')) {
            db.exec('ALTER TABLE sessions ADD COLUMN created_by_user_id INTEGER')
        }
        db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)')
    }

    const machineColumns = sqliteColumnNames(db, 'machines')
    if (machineColumns.size > 0) {
        if (!machineColumns.has('owner_user_id')) {
            db.exec('ALTER TABLE machines ADD COLUMN owner_user_id INTEGER')
        }
        if (!machineColumns.has('team_id')) {
            db.exec('ALTER TABLE machines ADD COLUMN team_id TEXT')
        }
        db.exec('CREATE INDEX IF NOT EXISTS idx_machines_team ON machines(team_id)')
    }

    db.exec(`
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
export function migrateFromV16ToV17(db: Database): void {
    const columns = sqliteColumnNames(db, 'users')
    if (columns.size === 0) return

    if (!columns.has('username')) {
        db.exec('ALTER TABLE users ADD COLUMN username TEXT')
    }
    if (!columns.has('username_normalized')) {
        db.exec('ALTER TABLE users ADD COLUMN username_normalized TEXT')
    }
    if (!columns.has('display_name')) {
        db.exec('ALTER TABLE users ADD COLUMN display_name TEXT')
    }
    if (!columns.has('password_hash')) {
        db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT')
    }
    if (!columns.has('access_token')) {
        db.exec('ALTER TABLE users ADD COLUMN access_token TEXT')
    }
    if (!columns.has('access_token_hash')) {
        db.exec('ALTER TABLE users ADD COLUMN access_token_hash TEXT')
    }
    if (!columns.has('role')) {
        db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
    }
    if (!columns.has('disabled_at')) {
        db.exec('ALTER TABLE users ADD COLUMN disabled_at INTEGER')
    }
    if (!columns.has('updated_at')) {
        db.exec('ALTER TABLE users ADD COLUMN updated_at INTEGER')
        db.exec('UPDATE users SET updated_at = created_at WHERE updated_at IS NULL')
    }

    db.exec(`
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
export function migrateFromV17ToV18(db: Database): void {
    createSchemaMigrationsTable(db)
}

export function migrateFromV18ToV19(db: Database): void {
    createAppSettingsTable(db)
}

export function migrateFromV19ToV20(db: Database): void {
    createCodexImportJobsTable(db)
}
