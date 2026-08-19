import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import { createConfiguration } from '../../configuration'
import { createCliRoutes } from './cli'
import { SessionIdentityConflictError } from '../../store/sessions'
import type { Store, StoredProject, StoredUser } from '../../store'

function createApp(engine: Partial<SyncEngine>, store: Store = createRouteStore()) {
    const app = new Hono()
    app.route('/cli', createCliRoutes(() => engine as SyncEngine, {
        store,
        getOwnerUserId: async () => 1
    }))
    return app
}

function authHeaders(token = 'test-token') {
    return {
        authorization: `Bearer ${token}`
    }
}

function defaultProject(): StoredProject {
    return {
        id: 'default-project',
        namespace: 'default',
        teamId: 'default-team',
        name: 'Default Project',
        repoUrl: null,
        createdByUserId: 1,
        createdAt: 1,
        archivedAt: null
    }
}

function personalProject(namespace: string, userId: number): StoredProject {
    return {
        id: `personal-project:${namespace}:${userId}`,
        namespace,
        teamId: `personal-team:${namespace}:${userId}`,
        name: 'Personal Workspace',
        repoUrl: null,
        createdByUserId: userId,
        createdAt: 1,
        archivedAt: null
    }
}

function localUser(input: Partial<StoredUser> & { id: number; accessToken: string; namespace?: string }): StoredUser {
    const namespace = input.namespace ?? 'default'
    return {
        id: input.id,
        platform: 'local',
        platformUserId: `${namespace}:user-${input.id}`,
        namespace,
        username: `user-${input.id}`,
        usernameNormalized: `user-${input.id}`,
        displayName: null,
        passwordHash: 'hash',
        accessToken: input.accessToken,
        accessTokenHash: 'hash',
        role: input.role ?? 'user',
        disabledAt: input.disabledAt ?? null,
        createdAt: 1,
        updatedAt: null
    }
}

function createRouteStore(options?: {
    users?: StoredUser[]
    ensurePersonalProject?: (namespace: string, userId: number) => StoredProject
}): Store {
    const usersByToken = new Map((options?.users ?? []).map((user) => [user.accessToken, user]))
    return {
        users: {
            getUserByAccessToken: (token: string) => usersByToken.get(token.trim()) ?? null
        },
        projects: {
            ensurePersonalProject: options?.ensurePersonalProject ?? personalProject
        }
    } as unknown as Store
}

beforeAll(async () => {
    const config = await createConfiguration()
    config._setCliApiToken('test-token', 'env', false)
})

describe('cli resume routes', () => {
    it('returns local resumable sessions', async () => {
        const app = createApp({
            listLocalResumableSessions: () => [{
                sessionId: 'session-1',
                flavor: 'codex',
                directory: '/tmp/project',
                machineId: 'machine-1',
                active: false,
                thinking: false,
                controlledByUser: false,
                agentSessionId: 'codex-thread-1',
                updatedAt: 123
            }]
        } as never)

        const response = await app.request('/cli/sessions/resumable?machineId=machine-1', {
            headers: authHeaders()
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            sessions: [{
                sessionId: 'session-1',
                flavor: 'codex',
                directory: '/tmp/project',
                machineId: 'machine-1',
                active: false,
                thinking: false,
                controlledByUser: false,
                agentSessionId: 'codex-thread-1',
                updatedAt: 123
            }]
        })
    })

    it('returns a local resume target', async () => {
        const app = createApp({
            resolveLocalResumeTarget: () => ({
                type: 'success',
                target: {
                    sessionId: 'session-1',
                    flavor: 'claude',
                    directory: '/tmp/project',
                    machineId: 'machine-1',
                    active: false,
                    thinking: false,
                    controlledByUser: false,
                    agentSessionId: '11111111-1111-4111-8111-111111111111'
                }
            })
        } as never)

        const response = await app.request('/cli/sessions/session-1/resume-target', {
            headers: authHeaders()
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            target: {
                sessionId: 'session-1',
                flavor: 'claude',
                directory: '/tmp/project',
                machineId: 'machine-1',
                active: false,
                thinking: false,
                controlledByUser: false,
                agentSessionId: '11111111-1111-4111-8111-111111111111'
            }
        })
    })

    it('returns handoff errors with status codes', async () => {
        const app = createApp({
            handoffSessionToLocal: async () => ({
                type: 'error',
                message: 'Session is already controlled by a local terminal',
                code: 'already_local'
            })
        } as never)

        const response = await app.request('/cli/sessions/session-1/handoff-local', {
            method: 'POST',
            headers: authHeaders()
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Session is already controlled by a local terminal',
            code: 'already_local'
        })
    })
})

describe('cli lazy session creation', () => {
    const sessionId = '11111111-1111-4111-8111-111111111111'

    it('creates the machine and requested session identity in one request', async () => {
        const getOrCreateMachine = mock(() => ({ id: 'machine-1' }))
        const getOrCreateSession = mock(() => ({ id: sessionId }))
        const app = createApp({
            ensureNamespaceDefaults: async () => defaultProject(),
            getMachine: () => null,
            getOrCreateMachine,
            getOrCreateSession
        } as never)

        const response = await app.request('/cli/sessions', {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                id: sessionId,
                tag: 'lazy-tag',
                metadata: { path: '/tmp/project' },
                agentState: { controlledByUser: true },
                machine: {
                    id: 'machine-1',
                    metadata: { host: 'localhost' }
                }
            })
        })

        expect(response.status).toBe(200)
        expect(getOrCreateMachine).toHaveBeenCalledWith(
            'machine-1',
            { host: 'localhost' },
            null,
            'default',
            { ownerUserId: 1, teamId: 'default-team' }
        )
        expect(getOrCreateSession).toHaveBeenCalledWith(
            'lazy-tag',
            { path: '/tmp/project' },
            { controlledByUser: true },
            'default',
            undefined,
            undefined,
            undefined,
            sessionId,
            { projectId: 'default-project', createdByUserId: 1 }
        )
    })

    it('creates runner resources with the authenticated local user token', async () => {
        const ensurePersonalProject = mock(personalProject)
        const getOrCreateMachine = mock(() => ({ id: 'machine-1' }))
        const getOrCreateSession = mock(() => ({ id: sessionId }))
        const user = localUser({ id: 42, namespace: 'team-a', accessToken: 'hapi_user_alice' })
        const app = createApp({
            getMachine: () => null,
            getOrCreateMachine,
            getOrCreateSession
        } as never, createRouteStore({
            users: [user],
            ensurePersonalProject
        }))

        const response = await app.request('/cli/sessions', {
            method: 'POST',
            headers: {
                ...authHeaders('hapi_user_alice'),
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                id: sessionId,
                tag: 'lazy-tag',
                metadata: { path: '/tmp/project' },
                machine: {
                    id: 'machine-1',
                    metadata: { host: 'localhost' }
                }
            })
        })

        expect(response.status).toBe(200)
        expect(ensurePersonalProject).toHaveBeenCalledWith('team-a', 42)
        expect(getOrCreateMachine).toHaveBeenCalledWith(
            'machine-1',
            { host: 'localhost' },
            null,
            'team-a',
            { ownerUserId: 42, teamId: 'personal-team:team-a:42' }
        )
        expect(getOrCreateSession).toHaveBeenCalledWith(
            'lazy-tag',
            { path: '/tmp/project' },
            null,
            'team-a',
            undefined,
            undefined,
            undefined,
            sessionId,
            { projectId: 'personal-project:team-a:42', createdByUserId: 42 }
        )
    })

    it('rejects disabled local user access tokens', async () => {
        const app = createApp({} as never, createRouteStore({
            users: [localUser({
                id: 42,
                accessToken: 'hapi_user_disabled',
                disabledAt: 123
            })]
        }))

        const response = await app.request('/cli/machines', {
            method: 'POST',
            headers: {
                ...authHeaders('hapi_user_disabled'),
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                id: 'machine-1',
                metadata: {}
            })
        })

        expect(response.status).toBe(401)
    })

    it('rejects a local user token claiming another user machine', async () => {
        const getOrCreateMachine = mock(() => ({ id: 'machine-1' }))
        const app = createApp({
            getMachine: () => ({ id: 'machine-1', namespace: 'default', ownerUserId: 7 }),
            getOrCreateMachine
        } as never, createRouteStore({
            users: [localUser({ id: 42, accessToken: 'hapi_user_alice' })]
        }))

        const response = await app.request('/cli/machines', {
            method: 'POST',
            headers: {
                ...authHeaders('hapi_user_alice'),
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                id: 'machine-1',
                metadata: {}
            })
        })

        expect(response.status).toBe(403)
        expect(getOrCreateMachine).not.toHaveBeenCalled()
    })

    it('rejects an embedded machine owned by another namespace', async () => {
        const getOrCreateMachine = mock(() => ({ id: 'machine-1' }))
        const getOrCreateSession = mock(() => ({ id: sessionId }))
        const app = createApp({
            ensureNamespaceDefaults: async () => defaultProject(),
            getMachine: () => ({ id: 'machine-1', namespace: 'other' }),
            getOrCreateMachine,
            getOrCreateSession
        } as never)

        const response = await app.request('/cli/sessions', {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                id: sessionId,
                tag: 'lazy-tag',
                metadata: {},
                machine: { id: 'machine-1', metadata: {} }
            })
        })

        expect(response.status).toBe(403)
        expect(getOrCreateMachine).not.toHaveBeenCalled()
        expect(getOrCreateSession).not.toHaveBeenCalled()
    })

    it('returns 409 for a requested identity conflict', async () => {
        const app = createApp({
            ensureNamespaceDefaults: async () => defaultProject(),
            getOrCreateSession: () => {
                throw new SessionIdentityConflictError('Session tag is already bound to a different id')
            }
        })

        const response = await app.request('/cli/sessions', {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                id: sessionId,
                tag: 'lazy-tag',
                metadata: {}
            })
        })

        expect(response.status).toBe(409)
    })
})
