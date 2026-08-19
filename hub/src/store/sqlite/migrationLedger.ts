import type { Database } from 'bun:sqlite'
import {
    createSchemaMigrationsTable,
    setSqliteUserVersion
} from './schema'

export function runSchemaMigrationStep(
    db: Database,
    fromVersion: number,
    toVersion: number,
    backupPath: string | null,
    step: () => void
): void {
    const startedAt = Date.now()
    try {
        step()
        setSqliteUserVersion(db, toVersion)
        recordSchemaMigration(db, fromVersion, toVersion, startedAt, backupPath)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const backupHint = backupPath ? ` Backup created at: ${backupPath}.` : ''
        throw new Error(`SQLite schema migration v${fromVersion}->v${toVersion} failed: ${message}.${backupHint}`)
    }
}

export function recordSchemaMigration(
    db: Database,
    fromVersion: number,
    toVersion: number,
    startedAt: number,
    backupPath: string | null
): void {
    createSchemaMigrationsTable(db)
    const finishedAt = Date.now()
    db.prepare(`
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
