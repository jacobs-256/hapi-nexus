export function sessionFilter(sessionId: string): Record<string, unknown> {
    return {
        bool: {
            should: [
                { term: { 'row.session_id': sessionId } },
                { term: { 'row.session_id.keyword': sessionId } },
                { term: { session_id: sessionId } },
                { term: { 'session_id.keyword': sessionId } }
            ],
            minimum_should_match: 1
        }
    }
}

export function localIdsFilter(localIds: string[]): Record<string, unknown> {
    const values = [...new Set(localIds)].filter(Boolean)
    return {
        bool: {
            should: [
                { terms: { 'row.local_id': values } },
                { terms: { 'row.local_id.keyword': values } },
                { terms: { local_id: values } },
                { terms: { 'local_id.keyword': values } }
            ],
            minimum_should_match: 1
        }
    }
}

export function messageIdentityFilter(messageId: string): Record<string, unknown> {
    return {
        bool: {
            should: [
                { term: { 'row.id': messageId } },
                { term: { 'row.id.keyword': messageId } },
                { term: { id: messageId } },
                { term: { 'id.keyword': messageId } },
                { term: { 'row.local_id': messageId } },
                { term: { 'row.local_id.keyword': messageId } },
                { term: { local_id: messageId } },
                { term: { 'local_id.keyword': messageId } }
            ],
            minimum_should_match: 1
        }
    }
}

export function seqRangeFilter(options: { gt?: number; lte?: number }): Record<string, unknown> {
    const range: Record<string, number> = {}
    if (options.gt !== undefined) range.gt = options.gt
    if (options.lte !== undefined) range.lte = options.lte
    return {
        bool: {
            should: [
                { range: { 'row.seq': range } },
                { range: { seq: range } }
            ],
            minimum_should_match: 1
        }
    }
}

export function seqBoundedSessionQuery(sessionId: string, range: { gt?: number; lte?: number }): Record<string, unknown> {
    return {
        bool: {
            filter: [
                { term: { table: 'messages' } },
                sessionFilter(sessionId),
                seqRangeFilter(range)
            ]
        }
    }
}


export function messageEpochQuery(sessionId: string): Record<string, unknown> {
    return {
        bool: {
            filter: [
                { term: { table: 'message_epochs' } },
                sessionFilter(sessionId)
            ]
        }
    }
}

export function matureScheduledMessagesQuery(beforeTime: number): Record<string, unknown> {
    return {
        bool: {
            filter: [
                { term: { table: 'messages' } },
                {
                    bool: {
                        should: [
                            { range: { 'row.scheduled_at': { lte: beforeTime } } },
                            { range: { scheduled_at: { lte: beforeTime } } }
                        ],
                        minimum_should_match: 1
                    }
                }
            ]
        }
    }
}
