import type { StorageConfig } from '@hapi/protocol/storage'
import { withMysqlClient } from './client'

type MysqlTarget = Extract<StorageConfig['core'], { backend: 'mysql' }>['mysql']

const MYSQL_CORE_SCHEMA = [
    `CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(191) PRIMARY KEY,
        tag VARCHAR(191),
        namespace VARCHAR(191) NOT NULL DEFAULT 'default',
        project_id VARCHAR(191),
        created_by_user_id BIGINT,
        machine_id VARCHAR(191),
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        metadata LONGTEXT,
        metadata_version BIGINT DEFAULT 1,
        agent_state LONGTEXT,
        agent_state_version BIGINT DEFAULT 1,
        model LONGTEXT,
        model_reasoning_effort LONGTEXT,
        effort LONGTEXT,
        service_tier LONGTEXT,
        todos LONGTEXT,
        todos_updated_at BIGINT,
        team_state LONGTEXT,
        team_state_updated_at BIGINT,
        active TINYINT DEFAULT 0,
        active_at BIGINT,
        seq BIGINT DEFAULT 0,
        INDEX idx_sessions_tag (tag),
        INDEX idx_sessions_tag_namespace (tag, namespace),
        INDEX idx_sessions_project (project_id)
    )`,
    `CREATE TABLE IF NOT EXISTS app_settings (
        \`key\` VARCHAR(191) PRIMARY KEY,
        value LONGTEXT NOT NULL,
        updated_at BIGINT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS codex_import_jobs (
        id VARCHAR(191) PRIMARY KEY,
        namespace VARCHAR(191) NOT NULL DEFAULT 'default',
        user_id BIGINT,
        status VARCHAR(64) NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        payload LONGTEXT NOT NULL,
        INDEX idx_codex_import_jobs_namespace_created (namespace, created_at),
        INDEX idx_codex_import_jobs_user (namespace, user_id, created_at),
        INDEX idx_codex_import_jobs_status (status)
    )`,
    `CREATE TABLE IF NOT EXISTS machines (
        id VARCHAR(191) PRIMARY KEY,
        namespace VARCHAR(191) NOT NULL DEFAULT 'default',
        owner_user_id BIGINT,
        team_id VARCHAR(191),
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        metadata LONGTEXT,
        metadata_version BIGINT DEFAULT 1,
        runner_state LONGTEXT,
        runner_state_version BIGINT DEFAULT 1,
        active TINYINT DEFAULT 0,
        active_at BIGINT,
        seq BIGINT DEFAULT 0,
        INDEX idx_machines_namespace (namespace),
        INDEX idx_machines_team (team_id)
    )`,
    `CREATE TABLE IF NOT EXISTS users (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        platform VARCHAR(64) NOT NULL,
        platform_user_id VARCHAR(191) NOT NULL,
        namespace VARCHAR(191) NOT NULL DEFAULT 'default',
        username VARCHAR(191),
        username_normalized VARCHAR(191),
        display_name LONGTEXT,
        password_hash LONGTEXT,
        access_token LONGTEXT,
        access_token_hash VARCHAR(191),
        role VARCHAR(32) NOT NULL DEFAULT 'user',
        disabled_at BIGINT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT,
        UNIQUE KEY uniq_users_platform_id (platform, platform_user_id),
        UNIQUE KEY uniq_users_access_token_hash (access_token_hash),
        UNIQUE KEY uniq_users_local_username_namespace (namespace, platform, username_normalized),
        INDEX idx_users_platform (platform),
        INDEX idx_users_platform_namespace (platform, namespace)
    )`,
    `CREATE TABLE IF NOT EXISTS teams (
        id VARCHAR(191) PRIMARY KEY,
        namespace VARCHAR(191) NOT NULL DEFAULT 'default',
        name LONGTEXT NOT NULL,
        created_by_user_id BIGINT,
        created_at BIGINT NOT NULL,
        INDEX idx_teams_namespace (namespace)
    )`,
    `CREATE TABLE IF NOT EXISTS team_members (
        team_id VARCHAR(191) NOT NULL,
        user_id BIGINT NOT NULL,
        role VARCHAR(32) NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (team_id, user_id),
        INDEX idx_team_members_user (user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS projects (
        id VARCHAR(191) PRIMARY KEY,
        namespace VARCHAR(191) NOT NULL DEFAULT 'default',
        team_id VARCHAR(191) NOT NULL,
        name LONGTEXT NOT NULL,
        repo_url LONGTEXT,
        created_by_user_id BIGINT,
        created_at BIGINT NOT NULL,
        archived_at BIGINT,
        INDEX idx_projects_namespace (namespace),
        INDEX idx_projects_team (team_id)
    )`,
    `CREATE TABLE IF NOT EXISTS project_members (
        project_id VARCHAR(191) NOT NULL,
        user_id BIGINT NOT NULL,
        role VARCHAR(32) NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (project_id, user_id),
        INDEX idx_project_members_user (user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS project_workspaces (
        id VARCHAR(191) PRIMARY KEY,
        project_id VARCHAR(191) NOT NULL,
        machine_id VARCHAR(191) NOT NULL,
        root_path VARCHAR(384) NOT NULL,
        created_by_user_id BIGINT,
        created_at BIGINT NOT NULL,
        UNIQUE KEY uniq_project_workspace (project_id, machine_id, root_path),
        INDEX idx_project_workspaces_project (project_id),
        INDEX idx_project_workspaces_machine (machine_id)
    )`,
    `CREATE TABLE IF NOT EXISTS project_invites (
        id VARCHAR(191) PRIMARY KEY,
        project_id VARCHAR(191) NOT NULL,
        token_hash VARCHAR(191) NOT NULL UNIQUE,
        role VARCHAR(32) NOT NULL,
        expires_at BIGINT NOT NULL,
        created_by_user_id BIGINT,
        created_at BIGINT NOT NULL,
        accepted_at BIGINT,
        INDEX idx_project_invites_project (project_id),
        INDEX idx_project_invites_token_hash (token_hash)
    )`,
    `CREATE TABLE IF NOT EXISTS audit_log (
        id VARCHAR(191) PRIMARY KEY,
        actor_user_id BIGINT,
        action LONGTEXT NOT NULL,
        resource_type VARCHAR(191) NOT NULL,
        resource_id VARCHAR(191) NOT NULL,
        created_at BIGINT NOT NULL,
        metadata LONGTEXT,
        INDEX idx_audit_log_resource (resource_type, resource_id)
    )`,
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        namespace VARCHAR(191) NOT NULL,
        endpoint VARCHAR(512) NOT NULL,
        p256dh LONGTEXT NOT NULL,
        auth LONGTEXT NOT NULL,
        created_at BIGINT NOT NULL,
        UNIQUE KEY uniq_push_namespace_endpoint (namespace, endpoint),
        INDEX idx_push_subscriptions_namespace (namespace)
    )`,
    `CREATE TABLE IF NOT EXISTS fcm_devices (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        namespace VARCHAR(191) NOT NULL,
        token VARCHAR(768) NOT NULL,
        platform VARCHAR(32) NOT NULL,
        device_id VARCHAR(191) NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE KEY uniq_fcm_namespace_device_platform (namespace, device_id, platform),
        INDEX idx_fcm_devices_namespace (namespace),
        INDEX idx_fcm_devices_token (token)
    )`,
    `CREATE TABLE IF NOT EXISTS session_scratchlist (
        session_id VARCHAR(191) NOT NULL,
        entry_id VARCHAR(191) NOT NULL,
        text LONGTEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        attachments LONGTEXT DEFAULT NULL,
        PRIMARY KEY (session_id, entry_id),
        INDEX idx_session_scratchlist_session_created (session_id, created_at)
    )`,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        from_version BIGINT NOT NULL,
        to_version BIGINT NOT NULL,
        applied_at BIGINT NOT NULL,
        duration_ms BIGINT NOT NULL DEFAULT 0,
        backup_path LONGTEXT
    )`
]


async function mysqlColumnExists(sql: Bun.SQL, table: string, column: string): Promise<boolean> {
    const rows = await sql.unsafe<Array<Record<string, unknown>>>(
        'SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
        [table, column]
    )
    return Number(rows[0]?.n ?? 0) > 0
}

async function ensureMysqlCoreCompatibility(sql: Bun.SQL): Promise<void> {
    // CREATE TABLE IF NOT EXISTS does not repair partial tables left by older versions or failed attempts.
    if (!await mysqlColumnExists(sql, 'schema_migrations', 'duration_ms')) {
        await sql.unsafe('ALTER TABLE schema_migrations ADD COLUMN duration_ms BIGINT NOT NULL DEFAULT 0 AFTER applied_at')
    }
}

export async function ensureMysqlCoreSchema(target: MysqlTarget): Promise<void> {
    await withMysqlClient(target, 'initializing MySQL core storage schema', async (sql) => {
        for (const statement of MYSQL_CORE_SCHEMA) {
            await sql.unsafe(statement)
        }
        await ensureMysqlCoreCompatibility(sql)
    })
}
