import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import type { AuthResponse, EnterpriseUser } from '@/types/api'
import SettingsUsersPage from './users'

const apiMock = {
    getUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    resetUserPassword: vi.fn(),
    regenerateUserAccessToken: vi.fn()
}

let currentUser: AuthResponse['user'] = {
    id: 1,
    username: 'admin',
    role: 'admin'
}

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: apiMock,
        baseUrl: 'https://hub.example',
        user: currentUser
    }),
}))

function makeLocalUser(overrides?: Partial<EnterpriseUser>): EnterpriseUser {
    return {
        id: 2,
        platform: 'local',
        platformUserId: 'default:alice',
        namespace: 'default',
        username: 'alice',
        displayName: 'Alice',
        role: 'user',
        disabledAt: null,
        createdAt: 1,
        updatedAt: 1,
        accessToken: 'hapi_user_alice',
        ...overrides
    }
}

function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <SettingsUsersPage />
            </I18nProvider>
        </QueryClientProvider>,
    )
}

describe('SettingsUsersPage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        currentUser = { id: 1, username: 'admin', role: 'admin' }
        apiMock.getUsers.mockResolvedValue({ users: [makeLocalUser()] })
        apiMock.createUser.mockResolvedValue({ user: makeLocalUser({ id: 3, username: 'bob' }) })
        apiMock.deleteUser.mockResolvedValue({ ok: true })
    })

    afterEach(() => {
        cleanup()
    })

    it('renders users for administrators and creates local users', async () => {
        renderPage()

        expect(await screen.findByText('Alice')).toBeInTheDocument()

        fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'bob' } })
        fireEvent.change(screen.getByPlaceholderText('Password (8+ characters)'), { target: { value: 'correct-password' } })
        fireEvent.click(screen.getByRole('button', { name: 'Create user' }))

        await waitFor(() => expect(apiMock.createUser).toHaveBeenCalledWith({
            username: 'bob',
            password: 'correct-password',
            displayName: null,
            role: 'user'
        }))
    })

    it('deletes local users after confirmation', async () => {
        renderPage()

        expect(await screen.findByText('Alice')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Delete user' }))
        expect(screen.getByText('Delete Alice? This cannot be undone.')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

        await waitFor(() => expect(apiMock.deleteUser).toHaveBeenCalledWith(2))
    })

    it('shows delete for local users when the owner has the same numeric id', async () => {
        currentUser = { id: 1, username: 'admin', role: 'admin', platform: 'owner' }
        apiMock.getUsers.mockResolvedValue({ users: [makeLocalUser({ id: 1, username: 'jacobs', displayName: 'Jacobs' })] })

        renderPage()

        expect(await screen.findByText('Jacobs')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Delete user' })).toBeEnabled()
    })

    it('blocks non-admin users from the management list', () => {
        currentUser = { id: 2, username: 'alice', role: 'user' }

        renderPage()

        expect(screen.getByText('Only administrators can manage users.')).toBeInTheDocument()
        expect(apiMock.getUsers).not.toHaveBeenCalled()
    })
})
