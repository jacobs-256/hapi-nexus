import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { Machine, SessionSummary } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { ToastProvider } from '@/lib/toast-context'
import { SessionList } from './SessionList'

const projectsMock = vi.hoisted(() => vi.fn<() => Array<{ id: string; name: string; workspaces: unknown[] }>>(() => []))

vi.mock('@/hooks/queries/useProjects', () => ({
    useProjects: () => ({ projects: projectsMock(), isLoading: false, error: null, refetch: vi.fn() })
}))

function openFilterMenu() {
    fireEvent.click(screen.getByRole('button', { name: 'Filter sessions by machine' }))
}

afterEach(() => cleanup())

function makeSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: null,
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        pendingRequests: [],
        backgroundTaskCount: 0,
        futureScheduledMessageCount: 0,
        nextScheduledAt: null,
        model: null,
        effort: null,
        ...overrides
    }
}


function makeMachine(id: string, displayName: string, active = false): Machine {
    return {
        id,
        namespace: 'default',
        ownerUserId: null,
        teamId: null,
        seq: 0,
        createdAt: 0,
        updatedAt: 0,
        active,
        activeAt: 0,
        metadata: {
            host: displayName,
            displayName,
            platform: 'darwin',
            happyCliVersion: '1.3.0'
        },
        metadataVersion: 0,
        runnerState: null,
        runnerStateVersion: 0,
        health: null
    }
}

function renderWithProviders(children: ReactNode) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        }
    })

    return render(
        <QueryClientProvider client={queryClient}>
            <ToastProvider>
                <I18nProvider>
                    {children}
                </I18nProvider>
            </ToastProvider>
        </QueryClientProvider>
    )
}

function renderSessionList(sessions: SessionSummary[], options?: {
    machineLabelsById?: Record<string, string>
    machinesById?: Record<string, Machine>
}) {
    return renderWithProviders(
        <SessionList
            sessions={sessions}
            selectedSessionId={null}
            onSelect={vi.fn()}
            onNewSession={vi.fn()}
            onRefresh={vi.fn()}
            isLoading={false}
            renderHeader={false}
            api={null}
            machineLabelsById={options?.machineLabelsById ?? { 'machine-1': 'Mint', 'machine-2': 'Teemo' }}
            machinesById={options?.machinesById}
        />
    )
}

const multiMachineSessions = [
    makeSession({
        id: 'session-m1',
        updatedAt: 100,
        metadata: { path: '/work/hapi', machineId: 'machine-1', agentSessionId: 'thread-1' }
    }),
    makeSession({
        id: 'session-m2',
        updatedAt: 90,
        metadata: { path: '/work/docs', machineId: 'machine-2', agentSessionId: 'thread-2' }
    })
]

describe('SessionList machine filter', () => {
    beforeEach(() => {
        window.localStorage.clear()
        projectsMock.mockReturnValue([])
    })

    it('shows the machine filter dropdown even when all sessions are on a single machine', () => {
        renderSessionList([
            makeSession({
                id: 'session-1',
                updatedAt: 100,
                metadata: { path: '/work/hapi', machineId: 'machine-1', agentSessionId: 'thread-1' }
            })
        ])

        expect(screen.getByRole('button', { name: 'Filter sessions by machine' })).toBeTruthy()
        openFilterMenu()
        expect(screen.getByRole('checkbox', { name: /All Machines \(1\)/ })).toBeTruthy()
        expect(screen.getByRole('checkbox', { name: /Mint \(1\)/ })).toBeTruthy()
        expect(screen.getByTitle('/work/hapi')).toBeTruthy()
    })

    it('shows the machine filter dropdown and machine-suffixed group titles with multiple machines', () => {
        renderSessionList(multiMachineSessions)

        expect(screen.getByRole('button', { name: 'Filter sessions by machine' })).toBeTruthy()
        openFilterMenu()
        expect(screen.getByRole('checkbox', { name: /All Machines \(2\)/ })).toBeTruthy()
        expect(screen.getByText('work/hapi · Mint')).toBeTruthy()
        expect(screen.getByText('work/docs · Teemo')).toBeTruthy()
    })

    it('filters directory groups when a machine is selected', () => {
        renderSessionList(multiMachineSessions)

        openFilterMenu()
        fireEvent.click(screen.getByRole('checkbox', { name: /Teemo \(1\)/ }))

        expect(screen.queryByTitle('/work/hapi')).toBeNull()
        expect(screen.getByTitle('/work/docs')).toBeTruthy()
        // Suffix disappears once a single machine is selected
        expect(screen.getByText('work/docs')).toBeTruthy()
        expect(window.localStorage.getItem('hapi-session-list-machine-filter')).toBe(JSON.stringify(['machine-2']))
    })


    it('includes offline known machines in the dropdown and allows selecting them', () => {
        renderSessionList(multiMachineSessions.slice(0, 1), {
            machineLabelsById: { 'machine-1': 'Mint', 'machine-offline': 'Offline Mac' },
            machinesById: { 'machine-offline': makeMachine('machine-offline', 'Offline Mac', false) }
        })

        openFilterMenu()
        expect(screen.getByRole('checkbox', { name: /Offline Mac \(0\)/ })).toBeTruthy()
        fireEvent.click(screen.getByRole('checkbox', { name: /Offline Mac \(0\)/ }))

        expect(screen.queryByTitle('/work/hapi')).toBeNull()
        expect(screen.getByText('No sessions match your filters.')).toBeTruthy()
        expect(window.localStorage.getItem('hapi-session-list-machine-filter')).toBe(JSON.stringify(['machine-offline']))
    })

    it('falls back to All when the persisted machine no longer has sessions', () => {
        window.localStorage.setItem('hapi-session-list-machine-filter', 'gone-machine')
        renderSessionList(multiMachineSessions)

        expect(screen.getByTitle('/work/hapi')).toBeTruthy()
        expect(screen.getByTitle('/work/docs')).toBeTruthy()
        openFilterMenu()
        expect(screen.getByRole('checkbox', { name: /All Machines \(2\)/ })).toBeChecked()
    })

    it('filters sessions by project from the same dropdown', () => {
        projectsMock.mockReturnValue([
            { id: 'project-a', name: 'Project A', workspaces: [] },
            { id: 'project-b', name: 'Project B', workspaces: [] }
        ])
        renderSessionList([
            makeSession({
                id: 'session-a',
                projectId: 'project-a',
                updatedAt: 100,
                metadata: { path: '/work/a', machineId: 'machine-1', agentSessionId: 'thread-a' }
            }),
            makeSession({
                id: 'session-b',
                projectId: 'project-b',
                updatedAt: 90,
                metadata: { path: '/work/b', machineId: 'machine-1', agentSessionId: 'thread-b' }
            })
        ])

        openFilterMenu()
        fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: 'project-b' } })

        expect(screen.queryByTitle('/work/a')).toBeNull()
        expect(screen.getByTitle('/work/b')).toBeTruthy()
        expect(window.localStorage.getItem('hapi-session-list-project-filter')).toBe('project-b')
    })

    it('shows an empty state when the search only matches sessions on another machine', () => {
        renderSessionList([
            makeSession({
                id: 'session-alpha',
                updatedAt: 100,
                metadata: { path: '/work/hapi', machineId: 'machine-1', agentSessionId: 'thread-1', name: 'Alpha task' }
            }),
            makeSession({
                id: 'session-beta',
                updatedAt: 90,
                metadata: { path: '/work/docs', machineId: 'machine-2', agentSessionId: 'thread-2', name: 'Beta task' }
            })
        ])

        openFilterMenu()
        fireEvent.click(screen.getByRole('checkbox', { name: /Teemo \(1\)/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Search sessions' }))
        fireEvent.change(screen.getByPlaceholderText('Search sessions…'), { target: { value: 'alpha' } })

        expect(screen.getByText('No sessions match your filters.')).toBeTruthy()
        expect(screen.queryByTitle('/work/hapi')).toBeNull()
        expect(screen.queryByTitle('/work/docs')).toBeNull()
    })
})
