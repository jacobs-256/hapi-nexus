import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SCHEMA_VERSION, Store } from '../../index'

describe('Store V17→V18 migration: schema migration ledger', () => {
    it('fresh DB has current schema version and a migration ledger', () => {
        const store = new Store(':memory:')
        const db: Database = (store as unknown as { db: Database }).db

        expect(store.schemaVersion).toBe(SCHEMA_VERSION)
        expect(store.expectedSchemaVersion).toBe(SCHEMA_VERSION)
        expect(tableExists(db, 'schema_migrations')).toBe(true)

        const rows = db.prepare('SELECT from_version, to_version, backup_path FROM schema_migrations').all() as Array<{
            from_version: number
            to_version: number
            backup_path: string | null
        }>
        expect(rows).toEqual([{ from_version: 0, to_version: SCHEMA_VERSION, backup_path: null }])

        store.close()
    })

    it('V17 DB creates a backup and records the upgrade path', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v17-to-v18-'))
        const dbPath = join(dir, 'hapi.db')
        let store: Store | undefined
        try {
            const db = new Database(dbPath, { create: true, readwrite: true, strict: true })
            db.exec('PRAGMA journal_mode = WAL')
            db.exec('PRAGMA foreign_keys = ON')
            createV17Schema(db)
            db.exec(`
                INSERT INTO sessions (id, tag, namespace, created_at, updated_at)
                VALUES ('session-1', 'project', 'default', 100, 100);
                PRAGMA user_version = 17;
            `)
            db.close()

            store = new Store(dbPath)

            expect(store.schemaVersion).toBe(SCHEMA_VERSION)
            const upgradedDb: Database = (store as unknown as { db: Database }).db
            expect(tableExists(upgradedDb, 'schema_migrations')).toBe(true)

            const rows = upgradedDb.prepare(`
                SELECT from_version, to_version, backup_path
                FROM schema_migrations
                ORDER BY id
            `).all() as Array<{
                from_version: number
                to_version: number
                backup_path: string | null
            }>
            expect(rows).toHaveLength(3)
            expect(rows[0].from_version).toBe(17)
            expect(rows[0].to_version).toBe(18)
            expect(typeof rows[0].backup_path).toBe('string')
            expect(existsSync(rows[0].backup_path as string)).toBe(true)
            expect(rows[1].from_version).toBe(18)
            expect(rows[1].to_version).toBe(19)
            expect(rows[1].backup_path).toBe(rows[0].backup_path)
            expect(rows[2].from_version).toBe(19)
            expect(rows[2].to_version).toBe(SCHEMA_VERSION)
            expect(rows[2].backup_path).toBe(rows[0].backup_path)
            expect(readdirSync(join(dir, 'backups')).some((name) => name.includes(`v17-to-v${SCHEMA_VERSION}`))).toBe(true)

            const sessions = upgradedDb.prepare('SELECT id FROM sessions').all() as Array<{ id: string }>
            expect(sessions).toEqual([{ id: 'session-1' }])
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })
})

function tableExists(db: Database, name: string): boolean {
    const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(name) as { name: string } | null
    return row !== null
}

function createV17Schema(db: Database): void {
    db.exec(`
        CREATE TABLE sessions (
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

        CREATE TABLE machines (
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

        CREATE TABLE messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            seq INTEGER NOT NULL,
            local_id TEXT,
            invoked_at INTEGER,
            scheduled_at INTEGER,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_local_id ON messages(session_id, local_id) WHERE local_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_messages_session_position
            ON messages(session_id, COALESCE(invoked_at, created_at) DESC, seq DESC);
        CREATE INDEX IF NOT EXISTS idx_messages_scheduled_pending
            ON messages(scheduled_at)
            WHERE scheduled_at IS NOT NULL AND invoked_at IS NULL;

        CREATE TABLE message_epochs (
            session_id TEXT PRIMARY KEY,
            epoch INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE users (
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

        CREATE TABLE teams (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL DEFAULT 'default',
            name TEXT NOT NULL,
            created_by_user_id INTEGER,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_teams_namespace ON teams(namespace);

        CREATE TABLE team_members (
            team_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (team_id, user_id),
            FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

        CREATE TABLE projects (
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

        CREATE TABLE project_members (
            project_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (project_id, user_id),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

        CREATE TABLE project_workspaces (
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

        CREATE TABLE project_invites (
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

        CREATE TABLE audit_log (
            id TEXT PRIMARY KEY,
            actor_user_id INTEGER,
            action TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            resource_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);

        CREATE TABLE push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            namespace TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(namespace, endpoint)
        );
        CREATE INDEX IF NOT EXISTS idx_push_subscriptions_namespace ON push_subscriptions(namespace);

        CREATE TABLE fcm_devices (
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

        CREATE TABLE session_scratchlist (
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
}
