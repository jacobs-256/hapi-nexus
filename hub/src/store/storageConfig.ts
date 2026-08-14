import { homedir } from 'node:os'
import { join } from 'node:path'

import type { ConversationStorageBackend, ConversationStorageConfig, CoreStorageBackend, CoreStorageConfig, StorageConfig } from '@hapi/protocol/storage'
export type { StorageConfig } from '@hapi/protocol/storage'

export type PartialStorageConfig = {
    conversation?: Partial<ConversationStorageConfig> | Record<string, unknown>
    core?: Partial<CoreStorageConfig> | Record<string, unknown>
}

const SECRET_REDACTION = '********'

function expandHome(path: string): string {
    return path.replace(/^~(?=$|\/|\\)/, homedir())
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalPort(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error('MySQL port must be a valid TCP port')
    }
    return parsed
}

function getRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
}

export function defaultStorageConfig(dataDir: string, legacyDbPath: string): StorageConfig {
    return {
        conversation: {
            backend: 'sqlite',
            sqlite: { path: legacyDbPath }
        },
        core: {
            backend: 'sqlite',
            sqlite: { path: legacyDbPath }
        }
    }
}

export function splitSqliteStorageConfig(dataDir: string): StorageConfig {
    return {
        conversation: {
            backend: 'sqlite',
            sqlite: { path: join(dataDir, 'hapi-conversations.db') }
        },
        core: {
            backend: 'sqlite',
            sqlite: { path: join(dataDir, 'hapi-core.db') }
        }
    }
}

function normalizeConversationConfig(input: unknown, defaults: StorageConfig): ConversationStorageConfig {
    const record = getRecord(input)
    const backend = optionalString(record.backend) ?? defaults.conversation.backend
    if (backend === 'elasticsearch') {
        const es = getRecord(record.elasticsearch)
        const fallback = defaults.conversation.backend === 'elasticsearch' ? defaults.conversation.elasticsearch : undefined
        const url = optionalString(es.url) ?? fallback?.url ?? ''
        const index = optionalString(es.index) ?? fallback?.index ?? 'hapi-conversations'
        const username = optionalString(es.username) ?? fallback?.username
        const password = optionalString(es.password) ?? fallback?.password
        const apiKey = optionalString(es.apiKey) ?? fallback?.apiKey
        return {
            backend: 'elasticsearch',
            elasticsearch: {
                url,
                index,
                ...(username ? { username } : {}),
                ...(password ? { password } : {}),
                ...(apiKey ? { apiKey } : {})
            }
        }
    }
    if (backend !== 'sqlite') {
        throw new Error(`Unsupported conversation storage backend: ${backend}`)
    }
    const sqlite = getRecord(record.sqlite)
    const fallback = defaults.conversation.backend === 'sqlite' ? defaults.conversation.sqlite.path : join(process.cwd(), 'hapi-conversations.db')
    return {
        backend: 'sqlite',
        sqlite: { path: expandHome(optionalString(sqlite.path) ?? fallback) }
    }
}

function normalizeCoreConfig(input: unknown, defaults: StorageConfig): CoreStorageConfig {
    const record = getRecord(input)
    const backend = optionalString(record.backend) ?? defaults.core.backend
    if (backend === 'mysql') {
        const mysql = getRecord(record.mysql)
        const fallback = defaults.core.backend === 'mysql' ? defaults.core.mysql : undefined
        const url = optionalString(mysql.url) ?? fallback?.url
        const host = optionalString(mysql.host) ?? fallback?.host
        const database = optionalString(mysql.database) ?? fallback?.database
        const user = optionalString(mysql.user) ?? fallback?.user
        const password = optionalString(mysql.password) ?? fallback?.password
        const socketPath = optionalString(mysql.socketPath) ?? fallback?.socketPath
        const port = optionalPort(mysql.port ?? fallback?.port)
        return {
            backend: 'mysql',
            mysql: {
                ...(url ? { url } : {}),
                ...(host ? { host } : {}),
                ...(port ? { port } : {}),
                ...(database ? { database } : {}),
                ...(user ? { user } : {}),
                ...(password ? { password } : {}),
                ...(socketPath ? { socketPath } : {})
            }
        }
    }
    if (backend !== 'sqlite') {
        throw new Error(`Unsupported core storage backend: ${backend}`)
    }
    const sqlite = getRecord(record.sqlite)
    const fallback = defaults.core.backend === 'sqlite' ? defaults.core.sqlite.path : join(process.cwd(), 'hapi-core.db')
    return {
        backend: 'sqlite',
        sqlite: { path: expandHome(optionalString(sqlite.path) ?? fallback) }
    }
}

export function normalizeStorageConfig(input: unknown, dataDir: string, legacyDbPath: string): StorageConfig {
    const base = defaultStorageConfig(dataDir, legacyDbPath)
    const record = getRecord(input)
    const defaults = {
        conversation: normalizeConversationConfig(record.conversation, base),
        core: normalizeCoreConfig(record.core, base)
    }
    return defaults
}

export function applyStorageEnvOverrides(config: StorageConfig, env: NodeJS.ProcessEnv = process.env): StorageConfig {
    let next = config
    const hasElasticsearchEnv = Boolean(
        optionalString(env.ELASTICSEARCH_URL)
        || optionalString(env.ELASTICSEARCH_INDEX)
        || optionalString(env.ELASTICSEARCH_USERNAME)
        || optionalString(env.ELASTICSEARCH_PASSWORD)
        || optionalString(env.ELASTICSEARCH_API_KEY)
    )
    const hasElasticsearchTargetEnv = Boolean(
        optionalString(env.ELASTICSEARCH_URL)
        || (config.conversation.backend === 'elasticsearch' && hasElasticsearchEnv)
    )
    const conversationBackend = (
        optionalString(env.HAPI_CONVERSATION_STORE)
        ?? (optionalString(env.HAPI_CONVERSATION_SQLITE_PATH) ? 'sqlite' : undefined)
        ?? (hasElasticsearchTargetEnv ? 'elasticsearch' : undefined)
    ) as ConversationStorageBackend | undefined
    if (conversationBackend) {
        if (conversationBackend === 'sqlite') {
            next = {
                ...next,
                conversation: {
                    backend: 'sqlite',
                    sqlite: { path: expandHome(optionalString(env.HAPI_CONVERSATION_SQLITE_PATH) ?? (config.conversation.backend === 'sqlite' ? config.conversation.sqlite.path : join(process.cwd(), 'hapi-conversations.db'))) }
                }
            }
        } else if (conversationBackend === 'elasticsearch') {
            next = {
                ...next,
                conversation: {
                    backend: 'elasticsearch',
                    elasticsearch: {
                        url: optionalString(env.ELASTICSEARCH_URL) ?? (config.conversation.backend === 'elasticsearch' ? config.conversation.elasticsearch.url : ''),
                        index: optionalString(env.ELASTICSEARCH_INDEX) ?? (config.conversation.backend === 'elasticsearch' ? config.conversation.elasticsearch.index : 'hapi-conversations'),
                        ...(optionalString(env.ELASTICSEARCH_USERNAME) ? { username: optionalString(env.ELASTICSEARCH_USERNAME) } : {}),
                        ...(optionalString(env.ELASTICSEARCH_PASSWORD) ? { password: optionalString(env.ELASTICSEARCH_PASSWORD) } : {}),
                        ...(optionalString(env.ELASTICSEARCH_API_KEY) ? { apiKey: optionalString(env.ELASTICSEARCH_API_KEY) } : {})
                    }
                }
            }
        } else {
            throw new Error(`Unsupported HAPI_CONVERSATION_STORE: ${conversationBackend}`)
        }
    }

    const hasMysqlEnv = Boolean(
        optionalString(env.MYSQL_URL)
        || optionalString(env.MYSQL_HOST)
        || optionalString(env.MYSQL_PORT)
        || optionalString(env.MYSQL_DATABASE)
        || optionalString(env.MYSQL_USER)
        || optionalString(env.MYSQL_PASSWORD)
        || optionalString(env.MYSQL_SOCKET_PATH)
    )
    const hasMysqlTargetEnv = Boolean(
        optionalString(env.MYSQL_URL)
        || optionalString(env.MYSQL_DATABASE)
        || optionalString(env.MYSQL_SOCKET_PATH)
        || (config.core.backend === 'mysql' && hasMysqlEnv)
    )
    const coreBackend = (
        optionalString(env.HAPI_CORE_STORE)
        ?? (optionalString(env.HAPI_CORE_SQLITE_PATH) ? 'sqlite' : undefined)
        ?? (hasMysqlTargetEnv ? 'mysql' : undefined)
    ) as CoreStorageBackend | undefined
    if (coreBackend) {
        if (coreBackend === 'sqlite') {
            next = {
                ...next,
                core: {
                    backend: 'sqlite',
                    sqlite: { path: expandHome(optionalString(env.HAPI_CORE_SQLITE_PATH) ?? (config.core.backend === 'sqlite' ? config.core.sqlite.path : join(process.cwd(), 'hapi-core.db'))) }
                }
            }
        } else if (coreBackend === 'mysql') {
            next = {
                ...next,
                core: {
                    backend: 'mysql',
                    mysql: {
                        ...(optionalString(env.MYSQL_URL) ? { url: optionalString(env.MYSQL_URL) } : {}),
                        ...(optionalString(env.MYSQL_HOST) ? { host: optionalString(env.MYSQL_HOST) } : {}),
                        ...(optionalPort(env.MYSQL_PORT) ? { port: optionalPort(env.MYSQL_PORT) } : {}),
                        ...(optionalString(env.MYSQL_DATABASE) ? { database: optionalString(env.MYSQL_DATABASE) } : {}),
                        ...(optionalString(env.MYSQL_USER) ? { user: optionalString(env.MYSQL_USER) } : {}),
                        ...(optionalString(env.MYSQL_PASSWORD) ? { password: optionalString(env.MYSQL_PASSWORD) } : {}),
                        ...(optionalString(env.MYSQL_SOCKET_PATH) ? { socketPath: optionalString(env.MYSQL_SOCKET_PATH) } : {})
                    }
                }
            }
        } else {
            throw new Error(`Unsupported HAPI_CORE_STORE: ${coreBackend}`)
        }
    }
    return next
}

export function validateStorageConfig(config: StorageConfig): void {
    if (config.conversation.backend === 'sqlite' && !config.conversation.sqlite.path) {
        throw new Error('Conversation SQLite path is required')
    }
    if (config.conversation.backend === 'elasticsearch' && !config.conversation.elasticsearch.url) {
        throw new Error('Elasticsearch URL is required for conversation storage')
    }
    if (config.core.backend === 'sqlite' && !config.core.sqlite.path) {
        throw new Error('Core SQLite path is required')
    }
    if (config.core.backend === 'mysql') {
        const mysql = config.core.mysql
        if (!mysql.url && !mysql.socketPath && !mysql.host) {
            throw new Error('MySQL URL, host, or socketPath is required for core storage')
        }
        if (!mysql.url && !mysql.database) {
            throw new Error('MySQL database is required when MYSQL_URL is not used')
        }
    }
}

export function redactStorageConfig(config: StorageConfig): StorageConfig {
    return {
        conversation: config.conversation.backend === 'sqlite'
            ? config.conversation
            : {
                backend: 'elasticsearch',
                elasticsearch: {
                    ...config.conversation.elasticsearch,
                    ...(config.conversation.elasticsearch.password ? { password: SECRET_REDACTION } : {}),
                    ...(config.conversation.elasticsearch.apiKey ? { apiKey: SECRET_REDACTION } : {})
                }
            },
        core: config.core.backend === 'sqlite'
            ? config.core
            : {
                backend: 'mysql',
                mysql: {
                    ...config.core.mysql,
                    ...(config.core.mysql.password ? { password: SECRET_REDACTION } : {})
                }
            }
    }
}

export function mergeRedactedStorageConfig(next: StorageConfig, current: StorageConfig): StorageConfig {
    const merged: StorageConfig = structuredClone(next)
    if (
        merged.conversation.backend === 'elasticsearch'
        && current.conversation.backend === 'elasticsearch'
    ) {
        if (merged.conversation.elasticsearch.password === SECRET_REDACTION) {
            merged.conversation.elasticsearch.password = current.conversation.elasticsearch.password
        }
        if (merged.conversation.elasticsearch.apiKey === SECRET_REDACTION) {
            merged.conversation.elasticsearch.apiKey = current.conversation.elasticsearch.apiKey
        }
    }
    if (merged.core.backend === 'mysql' && current.core.backend === 'mysql') {
        if (merged.core.mysql.password === SECRET_REDACTION) {
            merged.core.mysql.password = current.core.mysql.password
        }
    }
    return merged
}

export function storageConfigEquals(a: StorageConfig, b: StorageConfig): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
}
