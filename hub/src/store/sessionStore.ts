import type { Database } from 'bun:sqlite'

import type { StoredSession, VersionedUpdateResult } from './types'
import {
    assignSessionProject,
    deleteSession,
    getOrCreateSession,
    getSession,
    getSessionByNamespace,
    getSessions,
    getSessionsByNamespace,
    setSessionEffort,
    setSessionModel,
    setSessionModelReasoningEffort,
    setSessionServiceTier,
    setSessionActive,
    setSessionTeamState,
    setSessionTodos,
    touchSessionUpdatedAt,
    updateSessionAgentState,
    updateSessionMetadata
} from './sessions'

export class SessionStore {
    private readonly db: Database

    constructor(
        db: Database,
        private readonly onSessionDeleted?: (sessionId: string) => void,
        private readonly onChange?: () => void
    ) {
        this.db = db
    }

    getOrCreateSession(
        tag: string,
        metadata: unknown,
        agentState: unknown,
        namespace: string,
        model?: string,
        effort?: string,
        modelReasoningEffort?: string,
        requestedId?: string,
        options?: { projectId?: string | null; createdByUserId?: number | null }
    ): StoredSession {
        const result = getOrCreateSession(this.db, tag, metadata, agentState, namespace, model, effort, modelReasoningEffort, requestedId, options)
        this.onChange?.()
        return result
    }

    assignSessionProject(id: string, namespace: string, projectId: string, createdByUserId: number): StoredSession | null {
        const result = assignSessionProject(this.db, id, namespace, projectId, createdByUserId)
        if (result) this.onChange?.()
        return result
    }

    updateSessionMetadata(
        id: string,
        metadata: unknown,
        expectedVersion: number,
        namespace: string,
        options?: { touchUpdatedAt?: boolean }
    ): VersionedUpdateResult<unknown | null> {
        const result = updateSessionMetadata(this.db, id, metadata, expectedVersion, namespace, options)
        if (result.result === 'success') this.onChange?.()
        return result
    }

    updateSessionAgentState(
        id: string,
        agentState: unknown,
        expectedVersion: number,
        namespace: string
    ): VersionedUpdateResult<unknown | null> {
        const result = updateSessionAgentState(this.db, id, agentState, expectedVersion, namespace)
        if (result.result === 'success') this.onChange?.()
        return result
    }

    setSessionTodos(id: string, todos: unknown, todosUpdatedAt: number, namespace: string): boolean {
        const result = setSessionTodos(this.db, id, todos, todosUpdatedAt, namespace)
        if (result) this.onChange?.()
        return result
    }

    setSessionTeamState(id: string, teamState: unknown, updatedAt: number, namespace: string): boolean {
        const result = setSessionTeamState(this.db, id, teamState, updatedAt, namespace)
        if (result) this.onChange?.()
        return result
    }

    setSessionModel(id: string, model: string | null, namespace: string, options?: { touchUpdatedAt?: boolean }): boolean {
        const result = setSessionModel(this.db, id, model, namespace, options)
        if (result) this.onChange?.()
        return result
    }

    setSessionModelReasoningEffort(
        id: string,
        modelReasoningEffort: string | null,
        namespace: string,
        options?: { touchUpdatedAt?: boolean }
    ): boolean {
        const result = setSessionModelReasoningEffort(this.db, id, modelReasoningEffort, namespace, options)
        if (result) this.onChange?.()
        return result
    }

    setSessionEffort(id: string, effort: string | null, namespace: string, options?: { touchUpdatedAt?: boolean }): boolean {
        const result = setSessionEffort(this.db, id, effort, namespace, options)
        if (result) this.onChange?.()
        return result
    }

    setSessionServiceTier(id: string, serviceTier: string | null, namespace: string, options?: { touchUpdatedAt?: boolean }): boolean {
        const result = setSessionServiceTier(this.db, id, serviceTier, namespace, options)
        if (result) this.onChange?.()
        return result
    }

    setSessionActive(id: string, active: boolean, activeAt: number, namespace: string): boolean {
        const result = setSessionActive(this.db, id, active, activeAt, namespace)
        if (result) this.onChange?.()
        return result
    }

    touchSessionUpdatedAt(id: string, updatedAt: number, namespace: string): boolean {
        const result = touchSessionUpdatedAt(this.db, id, updatedAt, namespace)
        if (result) this.onChange?.()
        return result
    }

    getSession(id: string): StoredSession | null {
        return getSession(this.db, id)
    }

    getSessionByNamespace(id: string, namespace: string): StoredSession | null {
        return getSessionByNamespace(this.db, id, namespace)
    }

    getSessions(): StoredSession[] {
        return getSessions(this.db)
    }

    getSessionsByNamespace(namespace: string): StoredSession[] {
        return getSessionsByNamespace(this.db, namespace)
    }

    deleteSession(id: string, namespace: string): boolean {
        const deleted = deleteSession(this.db, id, namespace)
        if (deleted) {
            this.onSessionDeleted?.(id)
            this.onChange?.()
        }
        return deleted
    }
}
