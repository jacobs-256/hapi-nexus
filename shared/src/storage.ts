export type ConversationStorageBackend = 'sqlite' | 'elasticsearch'
export type CoreStorageBackend = 'sqlite' | 'mysql'

export type SqliteStorageTarget = {
    path: string
}

export type ElasticsearchStorageTarget = {
    url: string
    index: string
    username?: string
    password?: string
    apiKey?: string
}

export type MysqlStorageTarget = {
    url?: string
    host?: string
    port?: number
    database?: string
    user?: string
    password?: string
    socketPath?: string
    tls?: boolean
}

export type ConversationStorageConfig =
    | { backend: 'sqlite'; sqlite: SqliteStorageTarget }
    | { backend: 'elasticsearch'; elasticsearch: ElasticsearchStorageTarget }

export type CoreStorageConfig =
    | { backend: 'sqlite'; sqlite: SqliteStorageTarget }
    | { backend: 'mysql'; mysql: MysqlStorageTarget }

export type StorageConfig = {
    conversation: ConversationStorageConfig
    core: CoreStorageConfig
}

export type StorageMigrationMode = 'none' | 'copy'
