import type { Database } from 'bun:sqlite'

/** Keep the historical SQL column names so storage snapshots retain their shape. */
export function migrateFromV20ToV21(db: Database): void {
    const migrate = db.transaction(() => {
        // Sort by the indexed, case-folded value: Unicode lowercasing can change
        // length. This avoids transient conflicts between suffix-shaped names.
        const users = db.prepare(`
            SELECT id, namespace, username, username_normalized FROM users
            WHERE platform = 'local' AND username IS NOT NULL
            ORDER BY length(username_normalized) DESC
        `).all() as Array<{ id: number; namespace: string; username: string; username_normalized: string | null }>
        const update = db.prepare(`
            UPDATE users SET username = ?, username_normalized = ?, platform_user_id = ?
            WHERE id = ?
        `)
        for (const user of users) {
            const email = `${user.username}@hapi.local`
            const normalized = `${(user.username_normalized ?? user.username).trim().toLowerCase()}@hapi.local`
            update.run(email, normalized, `${user.namespace}:${normalized}`, user.id)
        }
    })
    migrate()
}
