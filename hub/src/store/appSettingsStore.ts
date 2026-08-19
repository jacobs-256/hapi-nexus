import type { Database } from 'bun:sqlite'
import type { AppSettingsStorePort } from './ports/coreStores'

export class AppSettingsStore implements AppSettingsStorePort {
    constructor(
        private readonly db: Database,
        private readonly onChange?: () => void
    ) {}

    getJson<T>(key: string, fallback: T): T {
        const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value?: string } | undefined
        if (!row?.value) return fallback
        try {
            return JSON.parse(row.value) as T
        } catch {
            return fallback
        }
    }

    setJson(key: string, value: unknown, updatedAt: number = Date.now()): void {
        this.db.prepare(`
            INSERT INTO app_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
        `).run(key, JSON.stringify(value), updatedAt)
        this.onChange?.()
    }
}
