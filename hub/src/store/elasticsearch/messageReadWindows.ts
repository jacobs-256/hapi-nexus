import type { StoredMessage } from '../types'
import type { MessagePosition } from '../messages'
import { comparePosition, position } from './codec'

export type SeqRange = { gt?: number; lte?: number }
export type LoadMessagesBySeqRange = (range: SeqRange) => Promise<StoredMessage[]>

function initialWindow(safeLimit: number): number {
    return Math.max(safeLimit * 4, 100)
}

export async function readLatestMessagesWindow(
    maxSeq: number,
    safeLimit: number,
    load: LoadMessagesBySeqRange
): Promise<StoredMessage[]> {
    if (maxSeq <= 0) return []
    let window = initialWindow(safeLimit)
    while (true) {
        const lowerBound = Math.max(0, maxSeq - window)
        const rows = (await load({ gt: lowerBound, lte: maxSeq }))
            .sort((a, b) => a.seq - b.seq)
        if (rows.length >= safeLimit || lowerBound === 0) return rows.slice(-safeLimit)
        window *= 2
    }
}

export async function readFirstMessagesWindow(
    maxSeq: number,
    safeLimit: number,
    load: LoadMessagesBySeqRange
): Promise<StoredMessage[]> {
    if (maxSeq <= 0) return []
    let upperBound = Math.min(maxSeq, initialWindow(safeLimit))
    while (true) {
        const rows = (await load({ gt: 0, lte: upperBound }))
            .sort((a, b) => a.seq - b.seq)
        if (rows.length >= safeLimit || upperBound >= maxSeq) return rows.slice(0, safeLimit)
        upperBound = Math.min(maxSeq, upperBound * 2)
    }
}

export async function readDeliverableMessagesAfterWindow(
    afterSeq: number,
    maxSeq: number,
    now: number,
    safeLimit: number,
    load: LoadMessagesBySeqRange
): Promise<StoredMessage[]> {
    if (maxSeq <= afterSeq) return []
    let upperBound = Math.min(maxSeq, afterSeq + initialWindow(safeLimit))
    while (true) {
        const rows = (await load({ gt: afterSeq, lte: upperBound }))
            .filter((message) => message.seq > afterSeq && (message.scheduledAt === null || message.scheduledAt <= now))
            .sort((a, b) => a.seq - b.seq)
        if (rows.length >= safeLimit || upperBound >= maxSeq) return rows.slice(0, safeLimit)
        upperBound = Math.min(maxSeq, afterSeq + ((upperBound - afterSeq) * 2))
    }
}

export async function readMessagesBeforePositionWindow(
    maxSeq: number,
    safeLimit: number,
    before: MessagePosition | undefined,
    load: LoadMessagesBySeqRange
): Promise<StoredMessage[]> {
    if (maxSeq <= 0) return []
    let upperSeq = before ? Math.min(maxSeq, before.seq) : maxSeq
    if (upperSeq <= 0) return []
    let window = initialWindow(safeLimit)
    while (true) {
        const lowerSeq = Math.max(0, upperSeq - window)
        const rows = (await load({ gt: lowerSeq, lte: upperSeq }))
            .filter((message) => !before || comparePosition(position(message), before) < 0)
            .sort((a, b) => -comparePosition(position(a), position(b)))
        if (rows.length >= safeLimit || lowerSeq === 0) return rows.slice(0, safeLimit).reverse()
        upperSeq = lowerSeq
        window *= 2
    }
}

export async function readMessagesAfterPositionWindow(
    maxSeq: number,
    safeLimit: number,
    after: MessagePosition,
    until: MessagePosition | undefined,
    load: LoadMessagesBySeqRange
): Promise<StoredMessage[]> {
    const finalUpperSeq = until ? Math.min(maxSeq, until.seq) : maxSeq
    if (finalUpperSeq <= after.seq) return []
    let upperSeq = Math.min(finalUpperSeq, after.seq + initialWindow(safeLimit))
    while (true) {
        const rows = (await load({ gt: after.seq, lte: upperSeq }))
            .filter((message) => {
                const p = position(message)
                return comparePosition(p, after) > 0 && (!until || comparePosition(p, until) <= 0)
            })
            .sort((a, b) => comparePosition(position(a), position(b)))
        if (rows.length >= safeLimit || upperSeq >= finalUpperSeq) return rows.slice(0, safeLimit)
        upperSeq = Math.min(finalUpperSeq, after.seq + ((upperSeq - after.seq) * 2))
    }
}
