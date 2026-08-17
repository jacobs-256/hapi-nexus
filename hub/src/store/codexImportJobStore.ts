import type { Database } from 'bun:sqlite'

export type StoredCodexImportJobRecord = {
    id: string
    namespace: string
    userId: number | null
    status: string
    createdAt: number
    updatedAt: number
    payload: unknown
}

type CodexImportJobLike = {
    id: string
    namespace: string
    userId?: number
    status: string
    createdAt: number
}

type CodexImportJobRow = {
    id: string
    namespace: string
    user_id: number | null
    status: string
    created_at: number
    updated_at: number
    payload: string
}

function parsePayload(value: string): unknown | null {
    try {
        return JSON.parse(value) as unknown
    } catch {
        return null
    }
}

function mapRow(row: CodexImportJobRow): StoredCodexImportJobRecord | null {
    const payload = parsePayload(row.payload)
    if (!payload) return null
    return {
        id: row.id,
        namespace: row.namespace,
        userId: row.user_id,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        payload
    }
}

export class CodexImportJobStore {
    constructor(
        private readonly db: Database,
        private readonly onChange?: () => void
    ) {}

    listAll(): StoredCodexImportJobRecord[] {
        const rows = this.db.prepare(`
            SELECT id, namespace, user_id, status, created_at, updated_at, payload
            FROM codex_import_jobs
            ORDER BY created_at DESC
        `).all() as CodexImportJobRow[]
        return rows.map(mapRow).filter((row): row is StoredCodexImportJobRecord => row !== null)
    }

    save(job: CodexImportJobLike, payload: unknown, updatedAt: number = Date.now()): void {
        this.db.prepare(`
            INSERT INTO codex_import_jobs (id, namespace, user_id, status, created_at, updated_at, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                namespace = excluded.namespace,
                user_id = excluded.user_id,
                status = excluded.status,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                payload = excluded.payload
        `).run(
            job.id,
            job.namespace,
            job.userId ?? null,
            job.status,
            job.createdAt,
            updatedAt,
            JSON.stringify(payload)
        )
        this.onChange?.()
    }

    delete(id: string): boolean {
        const result = this.db.prepare('DELETE FROM codex_import_jobs WHERE id = ?').run(id)
        const deleted = result.changes > 0
        if (deleted) this.onChange?.()
        return deleted
    }

    prune(maxRows: number): void {
        const rows = this.db.prepare(`
            SELECT id
            FROM codex_import_jobs
            WHERE status NOT IN ('queued', 'running')
            ORDER BY created_at DESC
            LIMIT -1 OFFSET ?
        `).all(maxRows) as Array<{ id: string }>
        if (rows.length === 0) return
        const tx = this.db.transaction(() => {
            const stmt = this.db.prepare('DELETE FROM codex_import_jobs WHERE id = ?')
            for (const row of rows) stmt.run(row.id)
        })
        tx()
        this.onChange?.()
    }
}
