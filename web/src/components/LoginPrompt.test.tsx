import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ApiClient } from '@/api/client'
import { I18nProvider } from '@/lib/i18n-context'
import { LoginPrompt } from './LoginPrompt'

function renderWithProviders(ui: React.ReactElement) {
    return render(
        <I18nProvider>
            {ui}
        </I18nProvider>
    )
}

describe('LoginPrompt', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        const localStorageMock = {
            getItem: vi.fn(() => 'en'),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            clear: vi.fn(),
            key: vi.fn(() => null),
            length: 0,
        }
        Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true })
    })

    it('submits the trimmed email and password', async () => {
        const auth = { token: 'web-session', user: { id: 1, email: 'alice@example.com' } }
        const authenticate = vi.spyOn(ApiClient.prototype, 'authenticate').mockResolvedValue(auth)
        const onLogin = vi.fn()
        try {
            renderWithProviders(
                <LoginPrompt
                    baseUrl="https://hub.example.com"
                    serverUrl={null}
                    setServerUrl={vi.fn((value: string) => ({ ok: true as const, value }))}
                    clearServerUrl={vi.fn()}
                    onLogin={onLogin}
                />
            )
            fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' alice@example.com ' } })
            fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } })
            fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
            await waitFor(() => expect(authenticate).toHaveBeenCalledWith({ email: 'alice@example.com', password: 'correct-password' }))
            expect(onLogin).toHaveBeenCalledWith(auth, false)
        } finally {
            authenticate.mockRestore()
        }
    })

    it('does not clear first hub URL edit when hub URL required', async () => {
        renderWithProviders(
            <LoginPrompt
                baseUrl="https://app.example.com"
                serverUrl={null}
                setServerUrl={vi.fn((value: string) => ({ ok: true as const, value }))}
                clearServerUrl={vi.fn()}
                requireServerUrl={true}
                onLogin={vi.fn()}
            />
        )

        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@hapi.local' } })
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
        fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

        const hubInput = await screen.findByPlaceholderText('https://hapi.example.com')
        expect(screen.getByText('Hub URL required. Please set it before signing in.')).toBeInTheDocument()

        fireEvent.change(hubInput, { target: { value: 'https://hub.example.com' } })

        expect(hubInput).toHaveValue('https://hub.example.com')
        expect(screen.queryByText('Hub URL required. Please set it before signing in.')).not.toBeInTheDocument()
    })
})
