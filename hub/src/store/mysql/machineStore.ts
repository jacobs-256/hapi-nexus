import type { StorageConfig } from '@hapi/protocol/storage'
import type { MachineStorePort } from '../ports/coreStores'
import type { StoredMachine, VersionedUpdateResult } from '../types'
import type { DeleteMachineResult } from '../machines'
import { mergeMachineMetadata } from '../machines'
import { safeJsonParse } from '../json'
import { createMysqlClient } from '../external/storageSync'

type MysqlTarget = Extract<StorageConfig['core'], { backend: 'mysql' }>['mysql']
type Row = { id: string; namespace: string; owner_user_id: number | string | null; team_id: string | null; created_at: number | string; updated_at: number | string; metadata: string | null; metadata_version: number | string; runner_state: string | null; runner_state_version: number | string; active: number | string; active_at: number | string | null; seq: number | string }
const num = (v: number | string | null | undefined): number | null => v == null ? null : Number(v)
const json = (v: unknown) => v == null ? null : JSON.stringify(v)
function toStored(row: Row): StoredMachine { return { id: row.id, namespace: row.namespace, ownerUserId: num(row.owner_user_id), teamId: row.team_id, createdAt: num(row.created_at) ?? 0, updatedAt: num(row.updated_at) ?? 0, metadata: safeJsonParse(row.metadata), metadataVersion: num(row.metadata_version) ?? 0, runnerState: safeJsonParse(row.runner_state), runnerStateVersion: num(row.runner_state_version) ?? 0, active: Number(row.active) === 1, activeAt: num(row.active_at), seq: num(row.seq) ?? 0 } }

export class MysqlMachineStore implements MachineStorePort {
    constructor(private readonly target: MysqlTarget, private readonly onSessionsDeleted?: (sessionIds: string[]) => void | Promise<void>, private readonly onChange?: () => void) {}
    private async withSql<T>(fn: (sql: Bun.SQL) => Promise<T>): Promise<T> { const sql = createMysqlClient(this.target); try { await sql.connect(); return await fn(sql) } finally { await sql.close({ timeout: 1 }).catch(() => undefined) } }
    private async getById(sql: Bun.SQL, id: string): Promise<StoredMachine | null> { const rows = await sql.unsafe<Row[]>('SELECT * FROM machines WHERE id = ? LIMIT 1', [id]); return rows[0] ? toStored(rows[0]) : null }

    async getOrCreateMachine(id: string, metadata: unknown, runnerState: unknown, namespace: string, options?: { ownerUserId?: number | null; teamId?: string | null }): Promise<StoredMachine> {
        return await this.withSql(async (sql) => {
            const existing = await this.getById(sql, id)
            if (existing) {
                if (existing.namespace !== namespace) throw new Error('Machine namespace mismatch')
                let changed = false
                if ((existing.ownerUserId === null && options?.ownerUserId) || (existing.teamId === null && options?.teamId)) {
                    await sql.unsafe('UPDATE machines SET owner_user_id = COALESCE(owner_user_id, ?), team_id = COALESCE(team_id, ?) WHERE id = ?', [options?.ownerUserId ?? null, options?.teamId ?? null, id])
                    changed = true
                }
                const merged = mergeMachineMetadata(existing.metadata, metadata)
                if (merged !== undefined) {
                    await sql.unsafe('UPDATE machines SET metadata = ?, metadata_version = metadata_version + 1, updated_at = ?, seq = seq + 1 WHERE id = ?', [JSON.stringify(merged), Date.now(), id])
                    changed = true
                }
                if (changed) this.onChange?.()
                return await this.getById(sql, id) ?? existing
            }
            const now = Date.now()
            await sql.unsafe(`INSERT INTO machines (id, namespace, owner_user_id, team_id, created_at, updated_at, metadata, metadata_version, runner_state, runner_state_version, active, active_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1, 0, NULL, 0)`, [id, namespace, options?.ownerUserId ?? null, options?.teamId ?? null, now, now, JSON.stringify(metadata), json(runnerState)])
            this.onChange?.()
            const row = await this.getById(sql, id); if (!row) throw new Error('Failed to create machine'); return row
        })
    }

    async updateMachineMetadata(id: string, metadata: unknown, expectedVersion: number, namespace: string): Promise<VersionedUpdateResult<unknown | null>> { return await this.updateVersioned(id, namespace, 'metadata', 'metadata_version', metadata, expectedVersion) }
    async updateMachineRunnerState(id: string, runnerState: unknown, expectedVersion: number, namespace: string): Promise<VersionedUpdateResult<unknown | null>> { return await this.updateVersioned(id, namespace, 'runner_state', 'runner_state_version', runnerState ?? null, expectedVersion, 'active = 1, active_at = ?') }

    private async updateVersioned(id: string, namespace: string, field: 'metadata' | 'runner_state', versionField: 'metadata_version' | 'runner_state_version', value: unknown, expectedVersion: number, extraSet = ''): Promise<VersionedUpdateResult<unknown | null>> {
        const now = Date.now()
        return await this.withSql(async (sql) => {
            const rows = await sql.unsafe<Row[]>('SELECT * FROM machines WHERE id = ? AND namespace = ? LIMIT 1', [id, namespace])
            if (!rows[0]) return { result: 'error' }
            const current = toStored(rows[0]); const version = versionField === 'metadata_version' ? current.metadataVersion : current.runnerStateVersion; const currentValue = field === 'metadata' ? current.metadata : current.runnerState
            if (version !== expectedVersion) return { result: 'version-mismatch', version, value: currentValue }
            await sql.unsafe(`UPDATE machines SET ${field} = ?, ${versionField} = ${versionField} + 1, updated_at = ?, seq = seq + 1${extraSet ? `, ${extraSet}` : ''} WHERE id = ? AND namespace = ? AND ${versionField} = ?`, extraSet ? [json(value), now, now, id, namespace, version] : [json(value), now, id, namespace, version])
            this.onChange?.()
            const after = await this.getById(sql, id)
            return after ? { result: 'success', version: versionField === 'metadata_version' ? after.metadataVersion : after.runnerStateVersion, value: field === 'metadata' ? after.metadata : after.runnerState } : { result: 'error' }
        })
    }

    async getMachine(id: string): Promise<StoredMachine | null> { return await this.withSql((sql) => this.getById(sql, id)) }
    async getMachineByNamespace(id: string, namespace: string): Promise<StoredMachine | null> { return await this.withSql(async (sql) => { const row = await this.getById(sql, id); return row?.namespace === namespace ? row : null }) }
    async getMachines(): Promise<StoredMachine[]> { return await this.withSql(async (sql) => (await sql.unsafe<Row[]>('SELECT * FROM machines ORDER BY updated_at DESC')).map(toStored)) }
    async getMachinesByNamespace(namespace: string): Promise<StoredMachine[]> { return await this.withSql(async (sql) => (await sql.unsafe<Row[]>('SELECT * FROM machines WHERE namespace = ? ORDER BY updated_at DESC', [namespace])).map(toStored)) }

    async deleteMachineByNamespace(id: string, namespace: string): Promise<DeleteMachineResult> {
        return await this.withSql(async (sql) => await sql.begin(async (tx) => {
            const existingRows = await tx.unsafe<Row[]>('SELECT * FROM machines WHERE id = ? AND namespace = ? LIMIT 1', [id, namespace])
            if (!existingRows[0]) return { machineDeleted: false, deletedSessionIds: [], deletedProjectCount: 0, deletedProjectWorkspaceCount: 0 }
            const projectRows = await tx.unsafe<Array<{ id: string }>>(`SELECT DISTINCT p.id FROM projects p INNER JOIN project_workspaces pw ON pw.project_id = p.id WHERE p.namespace = ? AND pw.machine_id = ? AND NOT EXISTS (SELECT 1 FROM project_workspaces other WHERE other.project_id = p.id AND other.machine_id <> ?)`, [namespace, id, id])
            const projectIds = projectRows.map((row) => row.id)
            const workspaceCount = await tx.unsafe<Array<{ count: number | string }>>('SELECT COUNT(*) AS count FROM project_workspaces pw INNER JOIN projects p ON p.id = pw.project_id WHERE p.namespace = ? AND pw.machine_id = ?', [namespace, id])
            const sessionRows = await tx.unsafe<Array<{ id: string }>>(`SELECT id FROM sessions WHERE namespace = ? AND (machine_id = ? OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.machineId')) = ?)`, [namespace, id, id])
            const deletedSessionIds = sessionRows.map((row) => row.id)
            if (deletedSessionIds.length > 0) await tx.unsafe(`DELETE FROM sessions WHERE namespace = ? AND id IN (${deletedSessionIds.map(() => '?').join(',')})`, [namespace, ...deletedSessionIds])
            if (projectIds.length > 0) await tx.unsafe(`DELETE FROM projects WHERE namespace = ? AND id IN (${projectIds.map(() => '?').join(',')})`, [namespace, ...projectIds])
            await tx.unsafe('DELETE FROM machines WHERE id = ? AND namespace = ?', [id, namespace])
            await this.onSessionsDeleted?.(deletedSessionIds); this.onChange?.()
            return { machineDeleted: true, deletedSessionIds, deletedProjectCount: projectIds.length, deletedProjectWorkspaceCount: num(workspaceCount[0]?.count) ?? 0 }
        }))
    }
}
