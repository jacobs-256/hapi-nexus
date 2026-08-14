import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import type { EnterpriseUser, Machine, ProjectWithDetails } from '@/types/api'
import SettingsProjectsPage from '@/routes/settings/projects'

const apiMock = {
    getProjectMemberCandidates: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    addProjectMember: vi.fn(),
    removeProjectMember: vi.fn(),
    addProjectWorkspace: vi.fn(),
    removeProjectWorkspace: vi.fn(),
    createProjectInvite: vi.fn(),
    listMachineDirectory: vi.fn()
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

function makeUser(overrides: Partial<EnterpriseUser> & { id: number }): EnterpriseUser {
    return {
        id: overrides.id,
        platform: overrides.platform ?? 'local',
        platformUserId: overrides.platformUserId ?? String(overrides.id),
        namespace: overrides.namespace ?? 'default',
        username: overrides.username ?? `user-${overrides.id}`,
        displayName: overrides.displayName ?? null,
        role: overrides.role ?? 'user',
        disabledAt: overrides.disabledAt ?? null,
        createdAt: overrides.createdAt ?? 1,
        updatedAt: overrides.updatedAt ?? null,
        accessToken: overrides.accessToken ?? null
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
        apiMock.getProjectMemberCandidates.mockResolvedValue({
            users: [
                makeUser({ id: 1, username: 'owner', displayName: 'Owner User', role: 'admin' }),
                makeUser({ id: 2, username: 'existing', displayName: 'Existing Member' }),
                makeUser({ id: 3, username: 'alice', displayName: 'Alice Morgan' }),
                makeUser({ id: 4, username: 'bruno', displayName: 'Bruno Lee' })
            ]
        })
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
        apiMock.listMachineDirectory.mockImplementation(async (_machineId: string, path: string) => ({
            success: true,
            entries: path === '/srv/projects'
                ? [
                    { name: 'app', type: 'directory' },
                    { name: 'lib', type: 'directory', isGitRepo: true }
                ]
                : []
        }))
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

        fireEvent.click(screen.getByRole('button', { name: 'View details for Shared Project' }))

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

    it('adds multiple direct members from searchable users', async () => {
        renderPage()

        fireEvent.click(screen.getByRole('button', { name: 'Add member to Shared Project' }))
        fireEvent.click(screen.getByRole('button', { name: 'Select users' }))
        const search = await screen.findByPlaceholderText('Search username or display name')

        fireEvent.change(search, { target: { value: 'morg' } })
        expect(await screen.findByText('Alice Morgan (@alice)')).toBeTruthy()
        expect(screen.queryByText('Bruno Lee (@bruno)')).toBeNull()

        fireEvent.click(screen.getByText('Alice Morgan (@alice)'))
        fireEvent.change(search, { target: { value: 'bruno' } })
        fireEvent.click(await screen.findByText('Bruno Lee (@bruno)'))
        fireEvent.click(screen.getByRole('button', { name: 'Add member' }))

        await waitFor(() => expect(apiMock.addProjectMember).toHaveBeenCalledWith('project-1', {
            userId: 3,
            role: 'editor'
        }))
        expect(apiMock.addProjectMember).toHaveBeenCalledWith('project-1', {
            userId: 4,
            role: 'editor'
        })
    })

    it('removes project directories and creates invites', async () => {
        renderPage()

        fireEvent.click(screen.getByRole('button', { name: 'View details for Shared Project' }))
        fireEvent.click(screen.getByRole('button', { name: 'Remove project directory /srv/projects/app' }))
        await waitFor(() => expect(apiMock.removeProjectWorkspace).toHaveBeenCalledWith('project-1', 'workspace-1'))

        fireEvent.click(screen.getByRole('button', { name: 'Create invite for Shared Project' }))
        fireEvent.click(screen.getByRole('button', { name: 'Create link' }))
        await waitFor(() => expect(apiMock.createProjectInvite).toHaveBeenCalledWith('project-1', { role: 'editor' }))
        expect(screen.getByDisplayValue(/invite-token/)).toBeTruthy()
    })

    it('selects a project directory from the machine browser', async () => {
        renderPage()

        fireEvent.click(screen.getByRole('button', { name: 'Add directory to Shared Project' }))
        let browseButton: HTMLElement | null = null
        await waitFor(() => {
            browseButton = screen.getAllByRole('button', { name: 'Browse project directory' }).at(-1) ?? null
            expect(browseButton?.hasAttribute('disabled')).toBe(false)
        })
        fireEvent.click(browseButton!)
        fireEvent.click(await screen.findByRole('button', { name: /lib/ }))
        await waitFor(() => expect(apiMock.listMachineDirectory).toHaveBeenCalledWith('machine-1', '/srv/projects/lib'))

        fireEvent.click(screen.getByRole('button', { name: 'Select directory' }))
        expect(screen.getByDisplayValue('/srv/projects/lib')).toBeTruthy()

        fireEvent.click(screen.getByRole('button', { name: 'Add directory' }))
        await waitFor(() => expect(apiMock.addProjectWorkspace).toHaveBeenCalledWith('project-1', {
            machineId: 'machine-1',
            rootPath: '/srv/projects/lib'
        }))
    })
})
