import type { Database } from 'bun:sqlite'
import { sqliteColumnNames } from '../sqlite/schema'
import { migrateFromV1ToV2 } from './v1ToV11'

export function migrateLegacySchemaIfNeeded(db: Database): void {
    const columns = sqliteColumnNames(db, 'machines')
    if (columns.size === 0) {
        return
    }

    const hasDaemon = columns.has('daemon_state') || columns.has('daemon_state_version')
    const hasRunner = columns.has('runner_state') || columns.has('runner_state_version')

    if (hasDaemon && hasRunner) {
        throw new Error('SQLite schema has both daemon_state and runner_state columns in machines; manual cleanup required.')
    }

    if (hasDaemon && !hasRunner) {
        migrateFromV1ToV2(db)
    }
}
