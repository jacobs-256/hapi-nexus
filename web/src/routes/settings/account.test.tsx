import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import type { EnterpriseUser } from '@/types/api'
import SettingsAccountPage from './account'

const apiMock = {
    getAccount: vi.fn(),
    regenerateOwnAccessToken: vi.fn(),
    changeOwnEmail: vi.fn(),
    changeOwnPassword: vi.fn()
}
const clearAuthMock = vi.fn()

function makeUser(): EnterpriseUser {
    return {
        id: 1,
        platform: 'local',
        platformUserId: 'default:admin@hapi.local',
        namespace: 'default',
        email: 'admin@hapi.local',
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
        apiMock.changeOwnEmail.mockResolvedValue({ user: makeUser() })
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

    it('changes the current local email', async () => {
        renderPage()

        expect(await screen.findByDisplayValue('hapi_user_admin')).toBeInTheDocument()
        const emailInput = screen.getByLabelText('Email')
        fireEvent.change(emailInput, { target: { value: 'root@hapi.local' } })
        fireEvent.click(screen.getByRole('button', { name: 'Change email' }))

        await waitFor(() => expect(apiMock.changeOwnEmail).toHaveBeenCalledWith('root@hapi.local'))
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
