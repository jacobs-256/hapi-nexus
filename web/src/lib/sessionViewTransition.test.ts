import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParsedLocation, ViewTransitionOptions } from '@tanstack/router-core'
import { getSessionViewTransition } from './sessionViewTransition'

const originalStart = Object.getOwnPropertyDescriptor(document, 'startViewTransition')

beforeEach(() => {
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: vi.fn() })
    vi.stubGlobal('CSS', { supports: vi.fn(() => true) })
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
})

afterEach(() => {
    vi.unstubAllGlobals()
    if (originalStart) Object.defineProperty(document, 'startViewTransition', originalStart)
    else Reflect.deleteProperty(document, 'startViewTransition')
})

function location(pathname: string): ParsedLocation {
    return { pathname, search: {}, searchStr: '', hash: '', href: pathname, state: {} } as ParsedLocation
}

function transition(from: string | undefined, to: string) {
    const options = getSessionViewTransition() as ViewTransitionOptions
    if (typeof options.types !== 'function') throw new Error('Expected a route filter')
    return options.types({
        fromLocation: from ? location(from) : undefined,
        toLocation: location(to),
        pathChanged: from !== to,
        hrefChanged: from !== to,
        hashChanged: false,
    })
}

describe('mobile session view transitions', () => {
    it('slides into a session and reverses on return to the list', () => {
        expect(transition('/sessions', '/sessions/abc')).toEqual(['session-open'])
        expect(transition('/sessions/abc', '/sessions/')).toEqual(['session-close'])
        expect(transition('/sessions/', '/sessions/new')).toEqual(['session-open'])
    })

    it('does not animate initial loads, unrelated routes, or navigation inside a session', () => {
        expect(transition(undefined, '/sessions/abc')).toBe(false)
        expect(transition('/sessions/abc', '/sessions/abc/files')).toBe(false)
        expect(transition('/sessions/abc', '/sessions/def')).toBe(false)
        expect(transition('/settings', '/sessions')).toBe(false)
        expect(transition('/sessions', '/browse')).toBe(false)
        expect(transition('/sessions', '/sessions')).toBe(false)
    })

    it('rechecks viewport and reduced-motion preferences on every navigation', () => {
        const options = getSessionViewTransition() as ViewTransitionOptions
        if (typeof options.types !== 'function') throw new Error('Expected a route filter')
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
        expect(options.types({ fromLocation: location('/sessions'), toLocation: location('/sessions/abc'), pathChanged: true, hrefChanged: true, hashChanged: false })).toBe(false)
        expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 919px) and (prefers-reduced-motion: no-preference)')
    })

    it('keeps normal navigation when the browser cannot filter typed transitions', () => {
        vi.stubGlobal('CSS', { supports: () => false })
        expect(getSessionViewTransition()).toBe(false)
    })

    it('keeps normal navigation when the browser has no View Transition API', () => {
        Reflect.deleteProperty(document, 'startViewTransition')
        expect(getSessionViewTransition()).toBe(false)
    })
})
