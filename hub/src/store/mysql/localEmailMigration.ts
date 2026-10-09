/** Upgrade legacy login identifiers once, atomically with the migration ledger. */
export async function migrateMysqlLocalEmails(sql: Bun.SQL): Promise<void> {
    // Email addresses (254) and namespace-prefixed IDs exceed the old limits.
    const columns = await sql.unsafe<Array<{ column_name: string; max_length: number }>>(`
        SELECT column_name AS column_name, character_maximum_length AS max_length
        FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'users'
          AND column_name IN ('username', 'username_normalized', 'platform_user_id')
    `)
    const requiredLengths: Record<string, number> = {
        username: 254,
        username_normalized: 254,
        platform_user_id: 512
    }
    for (const column of columns) {
        const length = requiredLengths[column.column_name]
        if (Number(column.max_length) < length) {
            const nullable = column.column_name === 'platform_user_id' ? 'NOT NULL' : 'NULL'
            await sql.unsafe(`ALTER TABLE users MODIFY COLUMN ${column.column_name} VARCHAR(${length}) ${nullable}`)
        }
    }

    const lockName = 'hapi:native-local-email-migration:v21'
    const lockRows = await sql.unsafe<Array<{ acquired: number }>>(
        'SELECT GET_LOCK(?, 30) AS acquired',
        [lockName]
    )
    if (Number(lockRows[0]?.acquired ?? 0) !== 1) {
        throw new Error('Timed out waiting for the MySQL local email migration lock')
    }
    try {
        await sql.begin(async (tx) => {
            const applied = await tx.unsafe<Array<{ id: number }>>(
                'SELECT id FROM schema_migrations WHERE to_version >= 21 LIMIT 1 FOR UPDATE'
            )
            if (applied.length > 0) return
            const startedAt = Date.now()
            // Use the indexed, normalized length; Unicode case folding can expand it.
            await tx.unsafe(`
                UPDATE users SET
                    platform_user_id = CONCAT(namespace, ':', LOWER(TRIM(COALESCE(username_normalized, username))), '@hapi.local'),
                    username_normalized = CONCAT(LOWER(TRIM(COALESCE(username_normalized, username))), '@hapi.local'),
                    username = CONCAT(username, '@hapi.local')
                WHERE platform = 'local' AND username IS NOT NULL
                ORDER BY CHAR_LENGTH(username_normalized) DESC
            `)
            await tx.unsafe(`
                INSERT INTO schema_migrations (from_version, to_version, applied_at, duration_ms, backup_path)
                VALUES (20, 21, ?, ?, NULL)
            `, [Date.now(), Date.now() - startedAt])
        })
    } finally {
        await sql.unsafe('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => undefined)
    }
}
