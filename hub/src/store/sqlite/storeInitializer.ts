import type { Database } from 'bun:sqlite'
import { backupSqliteDatabaseForMigration } from './lifecycle'
import {
    assertConversationTablesPresent,
    assertRequiredTablesPresent,
    buildSqliteSchemaMismatchError,
    createConversationSchema,
    createCoreSchema,
    getSqliteUserVersion,
    hasAnyUserTables,
    setSqliteUserVersion
} from './schema'
import { recordSchemaMigration, runSchemaMigrationStep } from './migrationLedger'
import { buildStepMigrations, migrateLegacySchemaIfNeeded } from '../migrations'

export function initializeCoreSqliteSchema(db: Database, dbPath: string, schemaVersion: number): void {
    const currentVersion = getSqliteUserVersion(db)

    if (currentVersion === 0) {
        if (hasAnyUserTables(db)) {
            const backupPath = backupSqliteDatabaseForMigration(db, dbPath, currentVersion, schemaVersion)
            migrateLegacySchemaIfNeeded(db)
            // Run the full step ladder BEFORE createSchema so legacy tables
            // pick up every later-version column (e.g. invoked_at) via ALTER
            // TABLE. Without this, createSchema below would try to build
            // idx_messages_session_position over a column that does not
            // exist yet, and CREATE TABLE IF NOT EXISTS would not add the
            // missing column to the existing table.
            const legacySteps = buildStepMigrations(db, true)
            for (let v = 1; v < schemaVersion; v++) {
                legacySteps[v]?.()
            }
            // Backfill any *missing* tables (sessions, machines, ...) that
            // a partially-built legacy DB may not have yet.
            createCoreSchema(db)
            setSqliteUserVersion(db, schemaVersion)
            recordSchemaMigration(db, 0, schemaVersion, Date.now(), backupPath)
            return
        }

        createCoreSchema(db)
        setSqliteUserVersion(db, schemaVersion)
        recordSchemaMigration(db, 0, schemaVersion, Date.now(), null)
        return
    }

    const stepMigrations = buildStepMigrations(db, false)
    if (currentVersion < schemaVersion && stepMigrations[currentVersion]) {
        const backupPath = backupSqliteDatabaseForMigration(db, dbPath, currentVersion, schemaVersion)
        for (let v = currentVersion; v < schemaVersion; v++) {
            const step = stepMigrations[v]
            if (!step) throw buildSqliteSchemaMismatchError(dbPath, currentVersion, schemaVersion)
            runSchemaMigrationStep(db, v, v + 1, backupPath, step)
        }
        return
    }

    if (currentVersion !== schemaVersion) {
        throw buildSqliteSchemaMismatchError(dbPath, currentVersion, schemaVersion)
    }

    assertRequiredTablesPresent(db)
}

export function initializeConversationSqliteSchema(db: Database, dbPath: string, schemaVersion: number): void {
    let currentVersion = getSqliteUserVersion(db)
    if (currentVersion === 0) {
        createConversationSchema(db)
        setSqliteUserVersion(db, schemaVersion)
        return
    }
    if (currentVersion >= 18 && currentVersion < schemaVersion) {
        // V19/V20 only add core tables; conversation storage shape is unchanged,
        // but split SQLite conversation mirrors still need their user_version bumped
        // so normal startup can continue.
        setSqliteUserVersion(db, schemaVersion)
        currentVersion = schemaVersion
    }
    if (currentVersion !== schemaVersion) {
        throw buildSqliteSchemaMismatchError(dbPath, currentVersion, schemaVersion)
    }
    createConversationSchema(db)
    assertConversationTablesPresent(db)
}
