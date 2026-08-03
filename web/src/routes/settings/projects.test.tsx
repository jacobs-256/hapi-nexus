import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import type { Machine, ProjectWithDetails } from '@/types/api'
import SettingsProjectsPage from '@/routes/settings/projects'

const apiMock = {
    createProject: vi.fn(),
    updateProject: vi.fn(),
    addProjectMember: vi.fn(),
    removeProjectMember: vi.fn(),
    addProjectWorkspace: vi.fn(),
    removeProjectWorkspace: vi.fn(),
    createProjectInvite: vi.fn()
}
const projectsMock = vi.fn()
const machinesMock = vi.fn()

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: apiMock,
        baseUrl: 'https://hub.example'
    }),
}))

vi.mock('@/hooks/queries/useProjects', () => ({
    useProjects: () => ({
        projects: projectsMock(),
        isLoading: false,
        error: null,
        refetch: vi.fn()
    }),
}))

vi.mock('@/hooks/queries/useMachines', () => ({
    useMachines: () => ({
        machines: machinesMock(),
        isLoading: false,
        error: null,
        refetch: vi.fn()
    }),
}))

function makeMachine(): Machine {
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
            workspaceRoots: ['/srv/projects']
        },
        metadataVersion: 1,
        runnerState: null,
        runnerStateVersion: 1
    } as Machine
}

function makeProject(): ProjectWithDetails {
    return {
        id: 'project-1',
        namespace: 'default',
        name: 'Shared Project',
        repoUrl: null,
        createdByUserId: 1,
        createdAt: 1,
        archivedAt: null,
        role: 'owner',
        members: [
            { projectId: 'project-1', userId: 1, role: 'owner', createdAt: 1 },
            { projectId: 'project-1', userId: 2, role: 'editor', createdAt: 2 }
        ],
        workspaces: [{
            id: 'workspace-1',
            projectId: 'project-1',
            machineId: 'machine-1',
            rootPath: '/srv/projects/app',
            createdByUserId: 1,
            createdAt: 1
        }]
    }
}

function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <SettingsProjectsPage />
            </I18nProvider>
        </QueryClientProvider>,
    )
}

describe('SettingsProjectsPage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        apiMock.createProject.mockResolvedValue({ project: makeProject() })
        apiMock.updateProject.mockResolvedValue({ project: makeProject() })
        apiMock.addProjectMember.mockResolvedValue({ member: { projectId: 'project-1', userId: 3, role: 'editor', createdAt: 3 } })
        apiMock.removeProjectMember.mockResolvedValue(undefined)
        apiMock.addProjectWorkspace.mockResolvedValue({
            workspace: {
                id: 'workspace-2',
                projectId: 'project-1',
                machineId: 'machine-1',
                rootPath: '/srv/projects/lib',
                createdByUserId: 1,
                createdAt: 2
            }
        })
        apiMock.removeProjectWorkspace.mockResolvedValue(undefined)
        apiMock.createProjectInvite.mockResolvedValue({
            invite: {
                id: 'invite-1',
                projectId: 'project-1',
                role: 'editor',
                expiresAt: Date.now() + 60_000,
                createdAt: Date.now()
            },
            token: 'invite-token'
        })
        projectsMock.mockReturnValue([makeProject()])
        machinesMock.mockReturnValue([makeMachine()])
    })

    afterEach(() => {
        cleanup()
    })

    it('renames a project', async () => {
        renderPage()

        fireEvent.click(screen.getByRole('button', { name: 'Rename Shared Project' }))
        const input = screen.getByRole('textbox', { name: 'Rename Shared Project' })
        fireEvent.change(input, { target: { value: 'Shared Project 2' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(apiMock.updateProject).toHaveBeenCalledWith('project-1', { name: 'Shared Project 2' }))
    })

    it('updates and removes members', async () => {
        renderPage()

        fireEvent.change(screen.getByRole('combobox', { name: 'Change role for user 2' }), {
            target: { value: 'viewer' }
        })
        await waitFor(() => expect(apiMock.addProjectMember).toHaveBeenCalledWith('project-1', {
            userId: 2,
            role: 'viewer'
        }))

        fireEvent.click(screen.getByRole('button', { name: 'Remove user 2' }))
        await waitFor(() => expect(apiMock.removeProjectMember).toHaveBeenCalledWith('project-1', 2))
    })

    it('adds a direct member by user ID', async () => {
        renderPage()

        fireEvent.change(screen.getByPlaceholderText('User ID'), { target: { value: '3' } })
        fireEvent.click(screen.getByRole('button', { name: 'Add member' }))

        await waitFor(() => expect(apiMock.addProjectMember).toHaveBeenCalledWith('project-1', {
            userId: 3,
            role: 'editor'
        }))
    })

    it('removes workspaces and creates invites', async () => {
        renderPage()

        fireEvent.click(screen.getByRole('button', { name: 'Remove workspace /srv/projects/app' }))
        await waitFor(() => expect(apiMock.removeProjectWorkspace).toHaveBeenCalledWith('project-1', 'workspace-1'))

        fireEvent.click(screen.getByRole('button', { name: 'Create link' }))
        await waitFor(() => expect(apiMock.createProjectInvite).toHaveBeenCalledWith('project-1', { role: 'editor' }))
        expect(screen.getByDisplayValue(/invite-token/)).toBeTruthy()
    })
})
