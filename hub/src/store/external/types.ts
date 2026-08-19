import type { TableGroup, TableName } from './tables'

export type { TableGroup, TableName }

export type ExternalStorageExportProgress = {
    group: TableGroup
    table: TableName
    copiedRows: number
    totalRows?: number
    offset: number
}

export type ExternalStorageExportOptions = {
    initialOffsets?: Record<string, number>
    onProgress?: (progress: ExternalStorageExportProgress) => void | Promise<void>
}

export type ExternalStorageSyncGroupStatus = {
    running: boolean
    lastStartedAt: number | null
    lastSucceededAt: number | null
    lastFailedAt: number | null
    lastError: string | null
    lastCopiedRows: number | null
}
