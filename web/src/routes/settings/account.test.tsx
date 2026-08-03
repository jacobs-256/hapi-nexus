import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import type { EnterpriseUser } from '@/types/api'
import SettingsAccountPage from './account'

const apiMock = {
    getAccount: vi.fn(),
    regenerateOwnAccessToken: vi.fn(),
    changeOwnUsername: vi.fn(),
    changeOwnPassword: vi.fn()
}
const clearAuthMock = vi.fn()

function makeUser(): EnterpriseUser {
    return {
        id: 1,
        platform: 'local',
        platformUserId: 'default:admin',
        namespace: 'default',
        username: 'admin',
        displayName: 'Admin',
        role: 'admin',
        disabledAt: null,
        createdAt: 1,
        updatedAt: 1,
        accessToken: 'hapi_user_admin'
    }
}

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: apiMock,
        baseUrl: 'https://hub.example',
        clearAuth: clearAuthMock
    }),
}))

function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <SettingsAccountPage />
            </I18nProvider>
        </QueryClientProvider>,
    )
}

describe('SettingsAccountPage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        apiMock.getAccount.mockResolvedValue({ user: makeUser() })
        apiMock.changeOwnUsername.mockResolvedValue({ user: makeUser() })
        apiMock.changeOwnPassword.mockResolvedValue({ user: makeUser() })
    })

    afterEach(() => {
        cleanup()
    })

    it('signs out by clearing browser auth state', async () => {
        renderPage()

        expect(await screen.findByDisplayValue('hapi_user_admin')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

        expect(clearAuthMock).toHaveBeenCalledTimes(1)
    })

    it('changes the current local username', async () => {
        renderPage()

        expect(await screen.findByDisplayValue('hapi_user_admin')).toBeInTheDocument()
        const usernameInput = screen.getByLabelText('Username')
        fireEvent.change(usernameInput, { target: { value: 'root' } })
        fireEvent.click(screen.getByRole('button', { name: 'Change username' }))

        await waitFor(() => expect(apiMock.changeOwnUsername).toHaveBeenCalledWith('root'))
    })

    it('changes the current local password', async () => {
        renderPage()

        expect(await screen.findByDisplayValue('hapi_user_admin')).toBeInTheDocument()
        fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'admin' } })
        fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } })
        fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-password' } })
        fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

        await waitFor(() => expect(apiMock.changeOwnPassword).toHaveBeenCalledWith('admin', 'new-password'))
    })
})
