export { backupSqliteDatabaseForMigration, chmodSqliteFiles, ensureSqlitePath, isMemorySqlitePath, openSqliteDatabase } from './lifecycle'
export { recordSchemaMigration, runSchemaMigrationStep } from './migrationLedger'
export { buildStepMigrations, migrateLegacySchemaIfNeeded } from './migrations'
export { openStoreSqliteRuntime, resolveStoreStorageConfig } from './runtime'
export type { StoreSqliteRuntime } from './runtime'
export {
    REQUIRED_TABLES,
    assertConversationTablesPresent,
    assertRequiredTablesPresent,
    buildSqliteSchemaMismatchError,
    createAppSettingsTable,
    createCodexImportJobsTable,
    createConversationSchema,
    createCoreSchema,
    createSchemaMigrationsTable,
    getSqliteUserVersion,
    hasAnyUserTables,
    setSqliteUserVersion,
    sqliteColumnNames
} from './schema'
export { initializeConversationSqliteSchema, initializeCoreSqliteSchema } from './storeInitializer'
