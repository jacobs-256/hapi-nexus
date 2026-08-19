import { ensureMysqlCoreSchema } from '../mysql'
import type { ExternalStorageSync } from './storageSync'
import type { StorageConfig } from '../storageConfig'

export async function initializeExternalStorageRuntime(
    storageConfig: StorageConfig,
    externalSync: ExternalStorageSync | null,
    log: Pick<Console, 'log'> = console
): Promise<void> {
    if (storageConfig.core.backend === 'mysql') {
        await ensureMysqlCoreSchema(storageConfig.core.mysql)
    }
    if (!externalSync?.active) return

    const imported = await externalSync.importExternalIntoSqlite()
    const count = Object.values(imported).reduce((sum, value) => sum + value, 0)
    if (count > 0) {
        log.log(`[Storage] Imported ${count} row(s) from external storage into local mirrors.`)
    }
}
