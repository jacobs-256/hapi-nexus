import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import type { Machine, ProjectWithDetails } from '@/types/api'
import SettingsMachinesPage from '@/routes/settings/machines'

const renameMachineMock = vi.fn()
const deleteMachineMock = vi.fn()
const machinesMock = vi.fn()
const projectsMock = vi.fn()

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: { renameMachine: renameMachineMock, deleteMachine: deleteMachineMock },
        user: { id: 1, username: 'admin', role: 'admin' }
    }),
}))

vi.mock('@/hooks/queries/useMachines', () => ({
    useMachines: () => ({ machines: machinesMock(), isLoading: false, error: null, refetch: vi.fn() }),
}))

vi.mock('@/hooks/queries/useProjects', () => ({
    useProjects: () => ({ projects: projectsMock(), isLoading: false, error: null, refetch: vi.fn() }),
}))

function makeMachine(overrides?: Partial<Machine>): Machine {
    return {
        id: 'machine-1',
        namespace: 'default',
        ownerUserId: 1,
        teamId: 'default-team:default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: {
            host: 'workstation.local',
            platform: 'linux',
            happyCliVersion: '1.0.0',
        },
        metadataVersion: 1,
        runnerState: null,
        runnerStateVersion: 1,
        ...overrides,
    } as Machine
}

function makeProject(overrides?: Partial<ProjectWithDetails>): ProjectWithDetails {
    return {
        id: 'project-1',
        namespace: 'default',
        name: 'Shared Project',
        repoUrl: null,
        createdByUserId: 2,
        createdAt: 1,
        archivedAt: null,
        role: 'editor',
        members: [
            { projectId: 'project-1', userId: 2, role: 'owner', createdAt: 1 },
            { projectId: 'project-1', userId: 1, role: 'editor', createdAt: 2 }
        ],
        workspaces: [{
            id: 'workspace-1',
            projectId: 'project-1',
            machineId: 'machine-1',
            rootPath: '/srv/projects/app',
            createdByUserId: 2,
            createdAt: 1
        }],
        createdByUser: {
            id: 2,
            platform: 'local',
            platformUserId: '2',
            namespace: 'default',
            username: 'jacobs',
            displayName: 'Jacobs',
            role: 'user',
            disabledAt: null,
            createdAt: 1,
            updatedAt: null
        },
        ...overrides,
    } as ProjectWithDetails
}

function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <SettingsMachinesPage />
            </I18nProvider>
        </QueryClientProvider>,
    )
}

function startEditing(name: string) {
    fireEvent.click(screen.getByRole('button', { name: `Rename ${name}` }))
    return screen.getByRole('textbox')
}

describe('SettingsMachinesPage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        renameMachineMock.mockResolvedValue(undefined)
        deleteMachineMock.mockResolvedValue({ ok: true, deletedSessionCount: 0, deletedProjectCount: 0, deletedProjectWorkspaceCount: 0 })
        machinesMock.mockReturnValue([makeMachine()])
        projectsMock.mockReturnValue([])
    })

    afterEach(() => {
        cleanup()
    })

    it('falls back to the hostname and always shows host and platform', () => {
        renderPage()

        expect(screen.getByRole('button', { name: 'Rename workstation.local' })).toBeTruthy()
        expect(screen.getByText('workstation.local · linux')).toBeTruthy()
    })

    it('shows the custom name while keeping the hostname visible', () => {
        machinesMock.mockReturnValue([makeMachine({
            metadata: { host: 'workstation.local', platform: 'linux', happyCliVersion: '1.0.0', displayName: 'Workstation' },
        } as Partial<Machine>)])

        renderPage()

        expect(screen.getByRole('button', { name: 'Rename Workstation' })).toBeTruthy()
        expect(screen.getByText('workstation.local · linux')).toBeTruthy()
    })

    it('seeds the input with the current custom name, not the hostname', () => {
        machinesMock.mockReturnValue([makeMachine({
            metadata: { host: 'workstation.local', platform: 'linux', happyCliVersion: '1.0.0', displayName: 'Workstation' },
        } as Partial<Machine>)])
        renderPage()

        expect((startEditing('Workstation') as HTMLInputElement).value).toBe('Workstation')
    })

    it('leaves the input empty when no custom name is set', () => {
        renderPage()

        expect((startEditing('workstation.local') as HTMLInputElement).value).toBe('')
    })

    it('saves a trimmed name on Enter', async () => {
        renderPage()
        const input = startEditing('workstation.local')

        fireEvent.change(input, { target: { value: '  Workstation  ' } })
        fireEvent.keyDown(input, { key: 'Enter' })

        await waitFor(() => expect(renameMachineMock).toHaveBeenCalledWith('machine-1', 'Workstation'))
    })

    it('saves on blur', async () => {
        renderPage()
        const input = startEditing('workstation.local')

        fireEvent.change(input, { target: { value: 'Workstation' } })
        fireEvent.blur(input)

        await waitFor(() => expect(renameMachineMock).toHaveBeenCalledWith('machine-1', 'Workstation'))
    })

    it('submits once when Enter is followed by a blur', async () => {
        // Disabling a focused control forces it to blur, so a real browser fires
        // blur right after Enter starts the save. jsdom does not reproduce that,
        // so the sequence is driven explicitly here.
        renderPage()
        const input = startEditing('workstation.local')

        fireEvent.change(input, { target: { value: 'Workstation' } })
        fireEvent.keyDown(input, { key: 'Enter' })
        fireEvent.blur(input)

        await waitFor(() => expect(renameMachineMock).toHaveBeenCalled())
        expect(renameMachineMock).toHaveBeenCalledTimes(1)
    })

    it('clears the name with an empty string', async () => {
        machinesMock.mockReturnValue([makeMachine({
            metadata: { host: 'workstation.local', platform: 'linux', happyCliVersion: '1.0.0', displayName: 'Workstation' },
        } as Partial<Machine>)])
        renderPage()
        const input = startEditing('Workstation')

        fireEvent.change(input, { target: { value: '   ' } })
        fireEvent.keyDown(input, { key: 'Enter' })

        await waitFor(() => expect(renameMachineMock).toHaveBeenCalledWith('machine-1', ''))
    })

    it('does not call the API when the name is unchanged', async () => {
        renderPage()
        const input = startEditing('workstation.local')

        fireEvent.keyDown(input, { key: 'Enter' })

        await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
        expect(renameMachineMock).not.toHaveBeenCalled()
    })

    it('cancels on Escape without calling the API', async () => {
        renderPage()
        const input = startEditing('workstation.local')

        fireEvent.change(input, { target: { value: 'Workstation' } })
        fireEvent.keyDown(input, { key: 'Escape' })

        await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
        expect(renameMachineMock).not.toHaveBeenCalled()
    })

    it('surfaces an error and keeps the editor open when the save fails', async () => {
        renameMachineMock.mockRejectedValue(new Error('HTTP 409'))
        renderPage()
        const input = startEditing('workstation.local')

        fireEvent.change(input, { target: { value: 'Workstation' } })
        fireEvent.keyDown(input, { key: 'Enter' })

        await waitFor(() => expect(screen.getByText('Could not rename this machine.')).toBeTruthy())
        expect(screen.getByRole('textbox')).toBeTruthy()
    })

    it('shows online machines as online and disables deletion while connected', () => {
        renderPage()

        expect(screen.getByText('Online')).toBeTruthy()
        expect((screen.getByRole('button', { name: 'Delete workstation.local' }) as HTMLButtonElement).disabled).toBe(true)
    })

    it('shows offline machines with the last offline time and deletes after confirmation', async () => {
        machinesMock.mockReturnValue([makeMachine({
            active: false,
            activeAt: new Date('2026-08-10T08:00:00Z').getTime(),
        })])
        renderPage()

        expect(screen.getByText('Offline')).toBeTruthy()
        expect(screen.getByText(/^Last offline:/)).toBeTruthy()

        fireEvent.click(screen.getByRole('button', { name: 'Delete workstation.local' }))
        expect(screen.getByText(/projects that only belong to this machine/)).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

        await waitFor(() => expect(deleteMachineMock).toHaveBeenCalledWith('machine-1'))
    })

    it('marks who shared the machine and does not allow rename or delete', () => {
        machinesMock.mockReturnValue([makeMachine({
            ownerUserId: 2,
            active: false,
        })])
        projectsMock.mockReturnValue([makeProject()])
        renderPage()

        expect(screen.getByText('Shared by Jacobs (@jacobs)')).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'Rename workstation.local' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Delete workstation.local' })).toBeNull()
    })

    it('renders an empty state when no machines are registered', () => {
        machinesMock.mockReturnValue([])
        renderPage()

        expect(screen.getByText('No machines registered.')).toBeTruthy()
    })
})
