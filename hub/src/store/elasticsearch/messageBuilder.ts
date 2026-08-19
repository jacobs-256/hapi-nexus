import { randomUUID } from 'node:crypto'
import type { StoredMessage } from '../types'

export type CopyMessageInput = Pick<StoredMessage, 'content' | 'createdAt' | 'localId' | 'invokedAt' | 'scheduledAt'>

export function createOutboundMessage(
    sessionId: string,
    content: unknown,
    seq: number,
    localId?: string,
    scheduledAt?: number | null,
    now: number = Date.now()
): StoredMessage {
    return {
        id: randomUUID(),
        sessionId,
        content,
        createdAt: now,
        seq,
        localId: localId ?? null,
        invokedAt: localId ? null : now,
        scheduledAt: scheduledAt ?? null
    }
}

export function prepareCopiedMessage(
    sessionId: string,
    message: CopyMessageInput,
    seq: number,
    hasLocalId: (localId: string) => boolean
): StoredMessage {
    let localId = message.localId
    if (localId && hasLocalId(localId)) {
        localId = mergedLocalId(localId)
    }
    if (message.scheduledAt != null && !localId && message.invokedAt === null) {
        localId = mergedScheduledLocalId()
    }
    return buildCopiedMessage(sessionId, message, seq, localId)
}

export function prepareCopiedMessages(
    sessionId: string,
    messages: CopyMessageInput[],
    startingSeq: number,
    existingLocalIds: Set<string>
): StoredMessage[] {
    let seq = startingSeq
    return messages.map((message) => {
        let localId = message.localId
        if (localId && existingLocalIds.has(localId)) {
            localId = mergedLocalId(localId)
        }
        if (localId) existingLocalIds.add(localId)
        if (message.scheduledAt != null && !localId && message.invokedAt === null) {
            localId = mergedScheduledLocalId()
            existingLocalIds.add(localId)
        }
        seq += 1
        return buildCopiedMessage(sessionId, message, seq, localId)
    })
}

function buildCopiedMessage(
    sessionId: string,
    message: CopyMessageInput,
    seq: number,
    localId: string | null
): StoredMessage {
    const createdAt = Number.isFinite(message.createdAt) ? message.createdAt : Date.now()
    const invokedAt = localId ? message.invokedAt : (message.invokedAt ?? createdAt)
    return {
        id: randomUUID(),
        sessionId,
        content: message.content,
        createdAt,
        seq,
        localId: localId ?? null,
        invokedAt: invokedAt ?? null,
        scheduledAt: message.scheduledAt ?? null
    }
}

function mergedLocalId(localId: string): string {
    return `${localId}:merged:${randomUUID().slice(0, 8)}`
}

function mergedScheduledLocalId(): string {
    return `merged-scheduled:${randomUUID()}`
}
