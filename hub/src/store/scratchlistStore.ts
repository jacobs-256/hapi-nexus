import type { Database } from 'bun:sqlite'

import type { StoredScratchlistEntry } from './types'
import {
    countScratchlistEntries,
    createScratchlistEntry,
    deleteScratchlistEntry,
    getScratchlistEntry,
    listScratchlistEntries,
    sumScratchlistAttachmentBytesForSession,
    transferScratchlistEntries,
    updateScratchlistEntry,
    type CreateScratchlistResult
} from './scratchlist'

export class ScratchlistStore {
    private readonly db: Database

    constructor(db: Database, private readonly onChange?: () => void) {
        this.db = db
    }

    list(sessionId: string): StoredScratchlistEntry[] {
        return listScratchlistEntries(this.db, sessionId)
    }

    count(sessionId: string): number {
        return countScratchlistEntries(this.db, sessionId)
    }

    get(sessionId: string, entryId: string): StoredScratchlistEntry | null {
        return getScratchlistEntry(this.db, sessionId, entryId)
    }

    create(
        sessionId: string,
        text: string,
        options?: {
            entryId?: string
            createdAt?: number
            attachments?: import('@hapi/protocol').ScratchlistAttachmentMetadata[]
        }
    ): CreateScratchlistResult {
        const result = createScratchlistEntry(this.db, sessionId, text, options)
        if (result.outcome === 'created') this.onChange?.()
        return result
    }

    update(
        sessionId: string,
        entryId: string,
        patch: {
            text?: string
            attachments?: import('@hapi/protocol').ScratchlistAttachmentMetadata[]
        }
    ): StoredScratchlistEntry | null {
        const result = updateScratchlistEntry(this.db, sessionId, entryId, patch)
        if (result) this.onChange?.()
        return result
    }

    sumAttachmentBytes(sessionId: string): number {
        return sumScratchlistAttachmentBytesForSession(this.db, sessionId)
    }

    delete(sessionId: string, entryId: string): boolean {
        const result = deleteScratchlistEntry(this.db, sessionId, entryId)
        if (result) this.onChange?.()
        return result
    }

    /**
     * Re-point rows during a session merge. See
     * `transferScratchlistEntries` for the contract; the wrapper just
     * forwards through. Must be called BEFORE `deleteSession` so
     * `ON DELETE CASCADE` on `session_scratchlist.session_id` doesn't
     * race the migration. Required by tiann/hapi#920.
     */
    transfer(fromSessionId: string, toSessionId: string): { moved: number; collided: number } {
        const result = transferScratchlistEntries(this.db, fromSessionId, toSessionId)
        if (result.moved > 0 || result.collided > 0) this.onChange?.()
        return result
    }
}
