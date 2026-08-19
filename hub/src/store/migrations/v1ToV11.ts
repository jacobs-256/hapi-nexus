import type { Database } from 'bun:sqlite'
import { sqliteColumnNames } from '../sqlite/schema'

export function migrateFromV1ToV2(db: Database, legacy: boolean = false): void {
    const columns = sqliteColumnNames(db, 'machines')
    if (columns.size === 0) {
        // In the legacy branch the table may not exist yet — createSchema
        // will build the up-to-date one. When invoked from the regular
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
        db.exec('BEGIN')
        db.exec('ALTER TABLE machines RENAME COLUMN daemon_state TO runner_state')
        db.exec('ALTER TABLE machines RENAME COLUMN daemon_state_version TO runner_state_version')
        db.exec('COMMIT')
        return
    } catch (error) {
        db.exec('ROLLBACK')
    }

    try {
        db.exec('BEGIN')
        db.exec(`
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
        db.exec(`
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
        db.exec('DROP TABLE machines')
        db.exec('ALTER TABLE machines_new RENAME TO machines')
        db.exec('CREATE INDEX IF NOT EXISTS idx_machines_namespace ON machines(namespace)')
        db.exec('COMMIT')
    } catch (error) {
        db.exec('ROLLBACK')
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`SQLite schema migration v1->v2 failed: ${message}`)
    }
}

export function migrateFromV2ToV3(): void {
    return
}

export function migrateFromV3ToV4(db: Database): void {
    const columns = sqliteColumnNames(db, 'sessions')
    // When the legacy branch invokes the full step ladder, an upstream-only
    // DB may not have the sessions table yet — createSchema runs after the
    // ladder. Skip ALTERs in that case; createSchema will build the table
    // with the up-to-date columns.
    if (columns.size === 0) return
    if (!columns.has('team_state')) {
        db.exec('ALTER TABLE sessions ADD COLUMN team_state TEXT')
    }
    if (!columns.has('team_state_updated_at')) {
        db.exec('ALTER TABLE sessions ADD COLUMN team_state_updated_at INTEGER')
    }
}

export function migrateFromV4ToV5(db: Database): void {
    const columns = sqliteColumnNames(db, 'sessions')
    if (columns.size === 0) return
    if (!columns.has('model')) {
        db.exec('ALTER TABLE sessions ADD COLUMN model TEXT')
    }
}

export function migrateFromV5ToV6(db: Database): void {
    const columns = sqliteColumnNames(db, 'sessions')
    if (columns.size === 0) return
    if (!columns.has('effort')) {
        db.exec('ALTER TABLE sessions ADD COLUMN effort TEXT')
    }
}

export function migrateFromV6ToV7(db: Database): void {
    const columns = sqliteColumnNames(db, 'sessions')
    if (columns.size === 0) return
    if (!columns.has('model_reasoning_effort')) {
        db.exec('ALTER TABLE sessions ADD COLUMN model_reasoning_effort TEXT')
    }
}

export function migrateFromV7ToV8(db: Database): void {
    const columns = sqliteColumnNames(db, 'messages')
    if (columns.size === 0) {
        // No messages table yet — createSchema will build the up-to-date one.
        return
    }
    if (!columns.has('invoked_at')) {
        db.exec('ALTER TABLE messages ADD COLUMN invoked_at INTEGER')
    }
    // Idempotent (WHERE invoked_at IS NULL); safe to re-run if a previous attempt
    // crashed between ALTER and UPDATE before user_version was bumped.
    db.exec('UPDATE messages SET invoked_at = created_at WHERE invoked_at IS NULL')
    // Position index for byPosition pagination — idempotent via IF NOT EXISTS.
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_messages_session_position
            ON messages(session_id, COALESCE(invoked_at, created_at) DESC, seq DESC)
    `)
}
export function migrateFromV8ToV9(db: Database): void {
    const columns = sqliteColumnNames(db, 'messages')
    if (columns.size === 0) {
        // No messages table yet — createSchema will build the up-to-date one.
        return
    }
    if (!columns.has('scheduled_at')) {
        db.exec('ALTER TABLE messages ADD COLUMN scheduled_at INTEGER')
    }
    // Partial index for efficient mature scheduled message lookup.
    // Idempotent via IF NOT EXISTS.
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_messages_scheduled_pending
            ON messages(scheduled_at)
            WHERE scheduled_at IS NOT NULL AND invoked_at IS NULL
    `)
}

export function migrateFromV9ToV10(db: Database): void {
    const columns = sqliteColumnNames(db, 'sessions')
    if (columns.size === 0) return
    if (!columns.has('service_tier')) {
        db.exec('ALTER TABLE sessions ADD COLUMN service_tier TEXT')
    }
}

export function migrateFromV10ToV11(db: Database): void {
    db.exec(`
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
