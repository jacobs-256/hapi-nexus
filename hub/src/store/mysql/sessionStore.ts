import type { StorageConfig } from '@hapi/protocol/storage'
import type { SessionStorePort } from '../ports/coreStores'
import type { StoredSession, VersionedUpdateResult } from '../types'
import { safeJsonParse } from '../json'
import { mergeSessionMetadata, SessionIdentityConflictError } from '../sessions'
import { createMysqlClient } from '../external/storageSync'

type MysqlTarget = Extract<StorageConfig['core'], { backend: 'mysql' }>['mysql']

type Row = {
    id: string; tag: string | null; namespace: string; project_id: string | null; created_by_user_id: number | string | null; machine_id: string | null
    created_at: number | string; updated_at: number | string; metadata: string | null; metadata_version: number | string
    agent_state: string | null; agent_state_version: number | string; model: string | null; model_reasoning_effort: string | null; effort: string | null; service_tier: string | null
    todos: string | null; todos_updated_at: number | string | null; team_state: string | null; team_state_updated_at: number | string | null
    active: number | string; active_at: number | string | null; seq: number | string
}

const num = (v: number | string | null | undefined): number | null => v == null ? null : Number(v)
const json = (v: unknown) => v == null ? null : JSON.stringify(v)

function toStored(row: Row): StoredSession {
    return {
        id: row.id,
        tag: row.tag,
        namespace: row.namespace,
        projectId: row.project_id,
        createdByUserId: num(row.created_by_user_id),
        machineId: row.machine_id,
        createdAt: num(row.created_at) ?? 0,
        updatedAt: num(row.updated_at) ?? 0,
        metadata: safeJsonParse(row.metadata),
        metadataVersion: num(row.metadata_version) ?? 0,
        agentState: safeJsonParse(row.agent_state),
        agentStateVersion: num(row.agent_state_version) ?? 0,
        model: row.model,
        modelReasoningEffort: row.model_reasoning_effort,
        effort: row.effort,
        serviceTier: row.service_tier,
        todos: safeJsonParse(row.todos),
        todosUpdatedAt: num(row.todos_updated_at),
        teamState: safeJsonParse(row.team_state),
        teamStateUpdatedAt: num(row.team_state_updated_at),
        active: Number(row.active) === 1,
        activeAt: num(row.active_at),
        seq: num(row.seq) ?? 0
    }
}

export class MysqlSessionStore implements SessionStorePort {
    constructor(
        private readonly target: MysqlTarget,
        private readonly onSessionDeleted?: (sessionId: string) => void | Promise<void>,
        private readonly onChange?: () => void
    ) {}

    private async withSql<T>(fn: (sql: Bun.SQL) => Promise<T>): Promise<T> {
        const sql = createMysqlClient(this.target)
        try { await sql.connect(); return await fn(sql) }
        finally { await sql.close({ timeout: 1 }).catch(() => undefined) }
    }

    private async getById(sql: Bun.SQL, id: string): Promise<StoredSession | null> {
        const rows = await sql.unsafe<Row[]>('SELECT * FROM sessions WHERE id = ? LIMIT 1', [id])
        return rows[0] ? toStored(rows[0]) : null
    }

    async getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string, model?: string, effort?: string, modelReasoningEffort?: string, requestedId?: string, options?: { projectId?: string | null; createdByUserId?: number | null }): Promise<StoredSession> {
        return await this.withSql(async (sql) => {
            const existingRows = await sql.unsafe<Row[]>('SELECT * FROM sessions WHERE tag = ? AND namespace = ? ORDER BY created_at DESC LIMIT 1', [tag, namespace])
            if (existingRows[0]) {
                const existing = toStored(existingRows[0])
                if (requestedId && existing.id !== requestedId) throw new SessionIdentityConflictError('Session tag is already bound to a different id')
                if ((existing.projectId === null && options?.projectId) || (existing.createdByUserId === null && options?.createdByUserId)) {
                    await sql.unsafe('UPDATE sessions SET project_id = COALESCE(project_id, ?), created_by_user_id = COALESCE(created_by_user_id, ?) WHERE id = ? AND namespace = ?', [options?.projectId ?? null, options?.createdByUserId ?? null, existing.id, namespace])
                    this.onChange?.()
                    return await this.getById(sql, existing.id) ?? existing
                }
                return existing
            }
            if (requestedId) {
                const byId = await this.getById(sql, requestedId)
                if (byId) {
                    if (byId.namespace === namespace && byId.tag === tag) return byId
                    throw new SessionIdentityConflictError('Session id is already bound to a different session')
                }
            }
            const now = Date.now(); const id = requestedId ?? crypto.randomUUID()
            await sql.unsafe(`
                INSERT INTO sessions (id, tag, namespace, project_id, created_by_user_id, machine_id, created_at, updated_at, metadata, metadata_version, agent_state, agent_state_version, model, model_reasoning_effort, effort, todos, todos_updated_at, active, active_at, seq)
                VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 1, ?, 1, ?, ?, ?, NULL, NULL, 0, ?, 0)
            `, [id, tag, namespace, options?.projectId ?? null, options?.createdByUserId ?? null, now, now, JSON.stringify(metadata), json(agentState), model ?? null, modelReasoningEffort ?? null, effort ?? null, now])
            this.onChange?.()
            const row = await this.getById(sql, id)
            if (!row) throw new Error('Failed to create session')
            return row
        })
    }

    async assignSessionProject(id: string, namespace: string, projectId: string, createdByUserId: number): Promise<StoredSession | null> {
        return await this.withSql(async (sql) => {
            await sql.unsafe('UPDATE sessions SET project_id = ?, created_by_user_id = COALESCE(created_by_user_id, ?) WHERE id = ? AND namespace = ?', [projectId, createdByUserId, id, namespace])
            this.onChange?.()
            return await this.getById(sql, id)
        })
    }

    async updateSessionMetadata(id: string, metadata: unknown, expectedVersion: number, namespace: string, options?: { touchUpdatedAt?: boolean }): Promise<VersionedUpdateResult<unknown | null>> {
        const now = Date.now(); const touch = options?.touchUpdatedAt !== false
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<Row[]>('SELECT * FROM sessions WHERE id = ? AND namespace = ? LIMIT 1', [id, namespace])
            if (!rows[0]) return { result: 'error' }
            const current = toStored(rows[0])
            const merged = mergeSessionMetadata(current.metadata, metadata)
            if (current.metadataVersion !== expectedVersion) return { result: 'version-mismatch', version: current.metadataVersion, value: current.metadata }
            await sql.unsafe('UPDATE sessions SET metadata = ?, metadata_version = metadata_version + 1, updated_at = CASE WHEN ? = 1 THEN ? ELSE updated_at END, seq = seq + 1 WHERE id = ? AND namespace = ?', [JSON.stringify(merged), touch ? 1 : 0, now, id, namespace])
            this.onChange?.()
            const after = await this.getById(sql, id)
            return after ? { result: 'success', version: after.metadataVersion, value: after.metadata } : { result: 'error' }
        })
    }

    async updateSessionAgentState(id: string, agentState: unknown, expectedVersion: number, namespace: string): Promise<VersionedUpdateResult<unknown | null>> {
        const now = Date.now(); const normalized = agentState ?? null
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<Row[]>('SELECT * FROM sessions WHERE id = ? AND namespace = ? LIMIT 1', [id, namespace])
            if (!rows[0]) return { result: 'error' }
            const current = toStored(rows[0])
            if (current.agentStateVersion !== expectedVersion) return { result: 'version-mismatch', version: current.agentStateVersion, value: current.agentState }
            await sql.unsafe('UPDATE sessions SET agent_state = ?, agent_state_version = agent_state_version + 1, updated_at = ?, seq = seq + 1 WHERE id = ? AND namespace = ?', [json(normalized), now, id, namespace])
            this.onChange?.()
            const after = await this.getById(sql, id)
            return after ? { result: 'success', version: after.agentStateVersion, value: after.agentState } : { result: 'error' }
        })
    }

    async setSessionTodos(id: string, todos: unknown, todosUpdatedAt: number, namespace: string): Promise<boolean> {
        return await this.updateIfExists(id, namespace, 'todos = ?, todos_updated_at = ?, updated_at = GREATEST(updated_at, ?), seq = seq + 1', [json(todos), todosUpdatedAt, todosUpdatedAt], 'AND (todos_updated_at IS NULL OR todos_updated_at < ?)', [todosUpdatedAt])
    }
    async setSessionTeamState(id: string, teamState: unknown, updatedAt: number, namespace: string): Promise<boolean> {
        return await this.updateIfExists(id, namespace, 'team_state = ?, team_state_updated_at = ?, updated_at = GREATEST(updated_at, ?), seq = seq + 1', [json(teamState), updatedAt, updatedAt], 'AND (team_state_updated_at IS NULL OR team_state_updated_at < ?)', [updatedAt])
    }
    async setSessionModel(id: string, model: string | null, namespace: string, options?: { touchUpdatedAt?: boolean }): Promise<boolean> { return await this.setNullableField(id, namespace, 'model', model, options) }
    async setSessionModelReasoningEffort(id: string, modelReasoningEffort: string | null, namespace: string, options?: { touchUpdatedAt?: boolean }): Promise<boolean> { return await this.setNullableField(id, namespace, 'model_reasoning_effort', modelReasoningEffort, options) }
    async setSessionEffort(id: string, effort: string | null, namespace: string, options?: { touchUpdatedAt?: boolean }): Promise<boolean> { return await this.setNullableField(id, namespace, 'effort', effort, options) }
    async setSessionServiceTier(id: string, serviceTier: string | null, namespace: string, options?: { touchUpdatedAt?: boolean }): Promise<boolean> { return await this.setNullableField(id, namespace, 'service_tier', serviceTier, options) }

    private async setNullableField(id: string, namespace: string, field: string, value: string | null, options?: { touchUpdatedAt?: boolean }): Promise<boolean> {
        const now = Date.now(); const touch = options?.touchUpdatedAt === true
        return await this.updateIfExists(id, namespace, `${field} = ?, updated_at = CASE WHEN ? = 1 THEN ? ELSE updated_at END, seq = seq + 1`, [value, touch ? 1 : 0, now], `AND NOT (${field} <=> ?)`, [value])
    }

    async setSessionActive(id: string, active: boolean, activeAt: number, namespace: string): Promise<boolean> {
        return await this.updateIfExists(id, namespace, 'active = ?, active_at = GREATEST(COALESCE(active_at, 0), ?), seq = seq + 1', [active ? 1 : 0, activeAt], 'AND (active != ? OR active_at IS NULL OR active_at < ?)', [active ? 1 : 0, activeAt])
    }

    async touchSessionUpdatedAt(id: string, updatedAt: number, namespace: string): Promise<boolean> {
        return await this.updateIfExists(id, namespace, 'updated_at = ?, seq = seq + 1', [updatedAt], 'AND updated_at < ?', [updatedAt])
    }

    private async updateIfExists(id: string, namespace: string, setSql: string, params: unknown[], extraWhere = '', extraParams: unknown[] = []): Promise<boolean> {
        return await this.withSql(async (sql) => {
            const before = await this.getById(sql, id)
            if (!before || before.namespace !== namespace) return false
            await sql.unsafe(`UPDATE sessions SET ${setSql} WHERE id = ? AND namespace = ? ${extraWhere}`, [...params, id, namespace, ...extraParams])
            const after = await this.getById(sql, id)
            const changed = JSON.stringify(before) !== JSON.stringify(after)
            if (changed) this.onChange?.()
            return changed
        })
    }

    async getSession(id: string): Promise<StoredSession | null> { return await this.withSql((sql) => this.getById(sql, id)) }
    async getSessionByNamespace(id: string, namespace: string): Promise<StoredSession | null> { return await this.withSql(async (sql) => { const row = await this.getById(sql, id); return row?.namespace === namespace ? row : null }) }
    async getSessions(): Promise<StoredSession[]> { return await this.withSql(async (sql) => (await sql.unsafe<Row[]>('SELECT * FROM sessions ORDER BY updated_at DESC')).map(toStored)) }
    async getSessionsByNamespace(namespace: string): Promise<StoredSession[]> { return await this.withSql(async (sql) => (await sql.unsafe<Row[]>('SELECT * FROM sessions WHERE namespace = ? ORDER BY updated_at DESC', [namespace])).map(toStored)) }

    async deleteSession(id: string, namespace: string): Promise<boolean> {
        return await this.withSql(async (sql) => {
            const existing = await this.getById(sql, id)
            if (!existing || existing.namespace !== namespace) return false
            await sql.unsafe('DELETE FROM sessions WHERE id = ? AND namespace = ?', [id, namespace])
            await this.onSessionDeleted?.(id); this.onChange?.(); return true
        })
    }
}
