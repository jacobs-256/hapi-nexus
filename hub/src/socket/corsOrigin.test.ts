import { describe, expect, it } from 'bun:test'
import { isSocketOriginAllowed } from './corsOrigin'

describe('isSocketOriginAllowed', () => {
    it('allows an explicitly configured origin', () => {
        const request = new Request('https://hub.internal/socket.io/')

        expect(isSocketOriginAllowed(request, 'https://web.example', ['https://web.example'])).toBe(true)
    })

    it('allows the same public origin behind a reverse proxy', () => {
        const request = new Request('http://127.0.0.1:3006/socket.io/', {
            headers: {
                host: '127.0.0.1:3006',
                'x-forwarded-host': 'hapi.example.com',
                'x-forwarded-proto': 'https'
            }
        })

        expect(isSocketOriginAllowed(request, 'https://hapi.example.com', [])).toBe(true)
    })

    it('rejects an unrelated origin', () => {
        const request = new Request('https://hapi.example.com/socket.io/', {
            headers: { host: 'hapi.example.com' }
        })

        expect(isSocketOriginAllowed(request, 'https://attacker.example', [])).toBe(false)
    })
})
