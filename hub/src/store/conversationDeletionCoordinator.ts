import type { ConversationStore } from './ports/conversationStore'

export async function deleteConversationMessagesForSession(
    messages: ConversationStore,
    sessionId: string,
    onDeleted: () => void
): Promise<void> {
    if (messages.deleteMessagesForSessionAsync) {
        await messages.deleteMessagesForSessionAsync(sessionId)
    } else {
        messages.deleteMessagesForSession(sessionId)
    }
    onDeleted()
}

export async function deleteConversationMessagesForSessions(
    messages: ConversationStore,
    sessionIds: string[],
    onDeleted: () => void
): Promise<void> {
    if (sessionIds.length === 0) return
    if (messages.deleteMessagesForSessionsAsync) {
        await messages.deleteMessagesForSessionsAsync(sessionIds)
    } else {
        messages.deleteMessagesForSessions(sessionIds)
    }
    onDeleted()
}
