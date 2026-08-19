import type { StorageConfig } from '@hapi/protocol/storage'
import type { StoredCodexImportJobRecord } from '../codexImportJobStore'
import type {
    AppSettingsStorePort,
    CodexImportJobInput,
    CodexImportJobStorePort,
    FcmStorePort,
    PushStorePort,
    ScratchlistStorePort
} from '../ports/coreStores'
import type { StoredFcmDevice, StoredPushSubscription, StoredScratchlistEntry } from '../types'
import { withMysqlClient } from './client'

type MysqlTarget = Extract<StorageConfig['core'], { backend: 'mysql' }>['mysql']

function num(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
    if (!value) return fallback
    try {
        return JSON.parse(value) as T
    } catch {
        return fallback
    }
}

class MysqlStoreBase {
    constructor(protected readonly target: MysqlTarget, protected readonly onChange?: () => void) {}

    protected async withSql<T>(fn: (sql: Bun.SQL) => Promise<T>): Promise<T> {
        return await withMysqlClient(this.target, 'using MySQL core store', fn)
    }
}

export class MysqlAppSettingsStore extends MysqlStoreBase implements AppSettingsStorePort {
    async getJson<T>(key: string, fallback: T): Promise<T> {
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<Array<{ value?: string }>>('SELECT value FROM app_settings WHERE `key` = ? LIMIT 1', [key])
            return parseJson(rows[0]?.value, fallback)
        })
    }

    async setJson(key: string, value: unknown, updatedAt: number = Date.now()): Promise<void> {
        await this.withSql(async (sql) => {
            await sql.unsafe(`
                INSERT INTO app_settings (\`key\`, value, updated_at)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)
            `, [key, JSON.stringify(value), updatedAt])
            this.onChange?.()
        })
    }
}

export class MysqlCodexImportJobStore extends MysqlStoreBase implements CodexImportJobStorePort {
    async listAll(): Promise<StoredCodexImportJobRecord[]> {
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<Array<{
                id: string
                namespace: string
                user_id: number | string | null
                status: string
                created_at: number | string
                updated_at: number | string
                payload: string
            }>>(`
                SELECT id, namespace, user_id, status, created_at, updated_at, payload
                FROM codex_import_jobs
                ORDER BY created_at DESC
            `)
            return rows.flatMap((row) => {
                const payload = parseJson<unknown | null>(row.payload, null)
                if (!payload) return []
                return [{
                    id: row.id,
                    namespace: row.namespace,
                    userId: num(row.user_id),
                    status: row.status,
                    createdAt: num(row.created_at) ?? 0,
                    updatedAt: num(row.updated_at) ?? 0,
                    payload
                }]
            })
        })
    }

    async save(job: CodexImportJobInput, payload: unknown, updatedAt: number = Date.now()): Promise<void> {
        await this.withSql(async (sql) => {
            await sql.unsafe(`
                INSERT INTO codex_import_jobs (id, namespace, user_id, status, created_at, updated_at, payload)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    namespace = VALUES(namespace),
                    user_id = VALUES(user_id),
                    status = VALUES(status),
                    created_at = VALUES(created_at),
                    updated_at = VALUES(updated_at),
                    payload = VALUES(payload)
            `, [job.id, job.namespace, job.userId ?? null, job.status, job.createdAt, updatedAt, JSON.stringify(payload)])
            this.onChange?.()
        })
    }

    async delete(id: string): Promise<boolean> {
        return await this.withSql(async (sql) => {
            const existing = await sql.unsafe<Array<{ id: string }>>('SELECT id FROM codex_import_jobs WHERE id = ? LIMIT 1', [id])
            if (!existing[0]) return false
            await sql.unsafe('DELETE FROM codex_import_jobs WHERE id = ?', [id])
            this.onChange?.()
            return true
        })
    }

    async prune(maxRows: number): Promise<void> {
        await this.withSql(async (sql) => {
            const rows = await sql.unsafe<Array<{ id: string }>>(`
                SELECT id
                FROM codex_import_jobs
                WHERE status NOT IN ('queued', 'running')
                ORDER BY created_at DESC
                LIMIT 18446744073709551615 OFFSET ?
            `, [maxRows])
            if (rows.length === 0) return
            for (const row of rows) {
                await sql.unsafe('DELETE FROM codex_import_jobs WHERE id = ?', [row.id])
            }
            this.onChange?.()
        })
    }
}

export class MysqlPushStore extends MysqlStoreBase implements PushStorePort {
    async addPushSubscription(namespace: string, subscription: { endpoint: string; p256dh: string; auth: string }): Promise<void> {
        await this.withSql(async (sql) => {
            await sql.unsafe(`
                INSERT INTO push_subscriptions (namespace, endpoint, p256dh, auth, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE p256dh = VALUES(p256dh), auth = VALUES(auth)
            `, [namespace, subscription.endpoint, subscription.p256dh, subscription.auth, Date.now()])
            this.onChange?.()
        })
    }

    async removePushSubscription(namespace: string, endpoint: string): Promise<void> {
        await this.withSql(async (sql) => {
            await sql.unsafe('DELETE FROM push_subscriptions WHERE namespace = ? AND endpoint = ?', [namespace, endpoint])
            this.onChange?.()
        })
    }

    async getPushSubscriptionsByNamespace(namespace: string): Promise<StoredPushSubscription[]> {
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<Array<{ id: number | string; namespace: string; endpoint: string; p256dh: string; auth: string; created_at: number | string }>>(
                'SELECT * FROM push_subscriptions WHERE namespace = ? ORDER BY created_at ASC',
                [namespace]
            )
            return rows.map((row) => ({
                id: num(row.id) ?? 0,
                namespace: row.namespace,
                endpoint: row.endpoint,
                p256dh: row.p256dh,
                auth: row.auth,
                createdAt: num(row.created_at) ?? 0
            }))
        })
    }
}

export class MysqlFcmStore extends MysqlStoreBase implements FcmStorePort {
    async upsertDevice(namespace: string, device: { token: string; platform: 'phone' | 'wear'; deviceId: string }): Promise<void> {
        await this.withSql(async (sql) => {
            await sql.unsafe(`
                INSERT INTO fcm_devices (namespace, token, platform, device_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE token = VALUES(token), updated_at = VALUES(updated_at)
            `, [namespace, device.token, device.platform, device.deviceId, Date.now(), Date.now()])
            this.onChange?.()
        })
    }

    async removeDeviceByToken(namespace: string, token: string): Promise<void> {
        await this.withSql(async (sql) => {
            await sql.unsafe('DELETE FROM fcm_devices WHERE namespace = ? AND token = ?', [namespace, token])
            this.onChange?.()
        })
    }

    async getDevicesByNamespace(namespace: string): Promise<StoredFcmDevice[]> {
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<Array<{
                id: number | string
                namespace: string
                token: string
                platform: 'phone' | 'wear'
                device_id: string
                created_at: number | string
                updated_at: number | string
            }>>('SELECT * FROM fcm_devices WHERE namespace = ? ORDER BY created_at ASC', [namespace])
            return rows.map((row) => ({
                id: num(row.id) ?? 0,
                namespace: row.namespace,
                token: row.token,
                platform: row.platform,
                deviceId: row.device_id,
                createdAt: num(row.created_at) ?? 0,
                updatedAt: num(row.updated_at) ?? 0
            }))
        })
    }
}

export class MysqlScratchlistStore extends MysqlStoreBase implements ScratchlistStorePort {
    async list(sessionId: string): Promise<StoredScratchlistEntry[]> {
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<Array<{ session_id: string; entry_id: string; text: string; created_at: number | string; updated_at: number | string; attachments: string | null }>>(
                'SELECT * FROM session_scratchlist WHERE session_id = ? ORDER BY created_at DESC',
                [sessionId]
            )
            return rows.map((row) => ({
                sessionId: row.session_id,
                entryId: row.entry_id,
                text: row.text,
                createdAt: num(row.created_at) ?? 0,
                updatedAt: num(row.updated_at) ?? 0,
                attachments: parseJson(row.attachments, [])
            }))
        })
    }

    async count(sessionId: string): Promise<number> {
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<Array<{ n: number | string }>>('SELECT COUNT(*) AS n FROM session_scratchlist WHERE session_id = ?', [sessionId])
            return num(rows[0]?.n) ?? 0
        })
    }

    async get(sessionId: string, entryId: string): Promise<StoredScratchlistEntry | null> {
        const rows = await this.list(sessionId)
        return rows.find((entry) => entry.entryId === entryId) ?? null
    }

    async create(sessionId: string, text: string, options?: { entryId?: string; createdAt?: number; attachments?: import('@hapi/protocol').ScratchlistAttachmentMetadata[] }) {
        const entryId = options?.entryId ?? crypto.randomUUID()
        const createdAt = options?.createdAt ?? Date.now()
        const attachments = options?.attachments ?? []
        return await this.withSql(async (sql) => {
            const existing = await sql.unsafe<Array<{ entry_id: string }>>('SELECT entry_id FROM session_scratchlist WHERE session_id = ? AND entry_id = ? LIMIT 1', [sessionId, entryId])
            if (existing[0]) {
                const entry = await this.get(sessionId, entryId)
                return { outcome: 'duplicate' as const, entry: entry! }
            }
            const session = await sql.unsafe<Array<{ id: string }>>('SELECT id FROM sessions WHERE id = ? LIMIT 1', [sessionId])
            if (!session[0]) return { outcome: 'session-not-found' as const }
            await sql.unsafe(`
                INSERT INTO session_scratchlist (session_id, entry_id, text, created_at, updated_at, attachments)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [sessionId, entryId, text, createdAt, createdAt, JSON.stringify(attachments)])
            this.onChange?.()
            return { outcome: 'created' as const, entry: { sessionId, entryId, text, createdAt, updatedAt: createdAt, attachments } }
        })
    }

    async update(sessionId: string, entryId: string, patch: { text?: string; attachments?: import('@hapi/protocol').ScratchlistAttachmentMetadata[] }): Promise<StoredScratchlistEntry | null> {
        const existing = await this.get(sessionId, entryId)
        if (!existing) return null
        const updated = {
            ...existing,
            text: patch.text ?? existing.text,
            attachments: patch.attachments ?? existing.attachments,
            updatedAt: Date.now()
        }
        await this.withSql(async (sql) => {
            await sql.unsafe('UPDATE session_scratchlist SET text = ?, attachments = ?, updated_at = ? WHERE session_id = ? AND entry_id = ?', [updated.text, JSON.stringify(updated.attachments), updated.updatedAt, sessionId, entryId])
            this.onChange?.()
        })
        return updated
    }

    async sumAttachmentBytes(sessionId: string): Promise<number> {
        const entries = await this.list(sessionId)
        return entries.reduce((sum, entry) => sum + entry.attachments.reduce((entrySum, attachment) => entrySum + attachment.size, 0), 0)
    }

    async delete(sessionId: string, entryId: string): Promise<boolean> {
        const existing = await this.get(sessionId, entryId)
        if (!existing) return false
        await this.withSql(async (sql) => {
            await sql.unsafe('DELETE FROM session_scratchlist WHERE session_id = ? AND entry_id = ?', [sessionId, entryId])
            this.onChange?.()
        })
        return true
    }

    async transfer(fromSessionId: string, toSessionId: string): Promise<{ moved: number; collided: number }> {
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<Array<{ entry_id: string }>>('SELECT entry_id FROM session_scratchlist WHERE session_id = ?', [fromSessionId])
            let moved = 0
            let collided = 0
            for (const row of rows) {
                const exists = await sql.unsafe<Array<{ entry_id: string }>>('SELECT entry_id FROM session_scratchlist WHERE session_id = ? AND entry_id = ? LIMIT 1', [toSessionId, row.entry_id])
                if (exists[0]) {
                    await sql.unsafe('DELETE FROM session_scratchlist WHERE session_id = ? AND entry_id = ?', [fromSessionId, row.entry_id])
                    collided += 1
                    continue
                }
                await sql.unsafe('UPDATE session_scratchlist SET session_id = ? WHERE session_id = ? AND entry_id = ?', [toSessionId, fromSessionId, row.entry_id])
                moved += 1
            }
            if (moved > 0 || collided > 0) this.onChange?.()
            return { moved, collided }
        })
    }
}
