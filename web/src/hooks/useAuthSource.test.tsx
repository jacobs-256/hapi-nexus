import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthSource } from './useAuthSource'

describe('useAuthSource', () => {
    beforeEach(() => {
        localStorage.clear()
        sessionStorage.clear()
        window.history.replaceState({}, '', '/')
    })

    it('stores and clears username/password Web sessions', async () => {
        window.history.replaceState({}, '', '/sessions?token=from-url&view=list#top')

        const { result } = renderHook(() => useAuthSource('https://hub.example'))

        await waitFor(() => expect(result.current.authSource).toBeNull())

        act(() => result.current.setWebSession({
            token: 'jwt-token',
            user: {
                id: 1,
                username: 'admin',
                accessToken: 'hapi_user_admin'
            }
        }, true))

        await waitFor(() => expect(result.current.authSource).toEqual({
            type: 'webSession',
            token: 'jwt-token'
        }))
        expect(localStorage.getItem('hapi_web_session::https://hub.example')).toBe(JSON.stringify({ token: 'jwt-token' }))
        expect(localStorage.getItem('hapi_access_token::https://hub.example')).toBe('hapi_user_admin')

        act(() => result.current.clearAuth())

        await waitFor(() => expect(result.current.authSource).toBeNull())
        expect(localStorage.getItem('hapi_web_session::https://hub.example')).toBeNull()
        expect(localStorage.getItem('hapi_access_token::https://hub.example')).toBeNull()
        expect(window.location.search).toBe('?view=list')
        expect(window.location.hash).toBe('#top')
    })

    it('ignores access tokens in URL parameters and legacy storage for Web login', async () => {
        window.history.replaceState({}, '', '/sessions?token=from-url')
        localStorage.setItem('hapi_access_token::https://hub.example', 'legacy-token')

        const { result } = renderHook(() => useAuthSource('https://hub.example'))

        await waitFor(() => expect(result.current.authSource).toBeNull())
    })
})
