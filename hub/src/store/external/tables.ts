export const CORE_TABLES = [
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
    'session_scratchlist',
    'app_settings',
    'codex_import_jobs',
    'schema_migrations'
] as const

export const CONVERSATION_TABLES = ['messages', 'message_epochs'] as const
export const ELASTIC_CONVERSATION_TABLES = ['messages', 'message_epochs', 'message_counters'] as const
export type TableGroup = 'core' | 'conversation'
export type TableName = typeof CORE_TABLES[number] | typeof ELASTIC_CONVERSATION_TABLES[number]
export const OPTIONAL_CORE_TABLES: readonly TableName[] = ['app_settings', 'codex_import_jobs']
