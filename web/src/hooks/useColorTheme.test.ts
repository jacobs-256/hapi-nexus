import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    applyColorTheme,
    getColorThemeOptions,
    getColorThemeStorageKey,
    getStoredColorTheme,
    parseColorTheme,
    useColorTheme,
} from './useColorTheme'

const THEME_VARS = ['--app-bg', '--app-fg', '--app-link', '--app-button', '--app-secondary-bg', '--app-chat-user-chip-bg']

describe('useColorTheme', () => {
    beforeEach(() => {
        localStorage.clear()
        document.documentElement.removeAttribute('data-color-theme')
        document.documentElement.setAttribute('data-theme', 'light')
        for (const name of THEME_VARS) document.documentElement.style.removeProperty(name)
    })

    it('exposes only the Xthings Survey palette', () => {
        expect(getColorThemeOptions()).toHaveLength(1)
        expect(getColorThemeOptions()[0]?.value).toBe('xthings')
        expect(parseColorTheme(null)).toBe('xthings')
        expect(parseColorTheme('nord')).toBe('xthings')
    })

    it('ignores legacy stored color theme selections', () => {
        localStorage.setItem(getColorThemeStorageKey(), 'rose-pine')
        expect(getStoredColorTheme()).toBe('xthings')
        expect(localStorage.getItem(getColorThemeStorageKey())).toBeNull()
    })

    it('applies the Xthings light palette to the document css variables', () => {
        applyColorTheme('xthings', 'light')
        expect(document.documentElement).toHaveAttribute('data-color-theme', 'xthings')
        expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('#f6f8fc')
        expect(document.documentElement.style.getPropertyValue('--app-fg')).toBe('#172033')
        expect(document.documentElement.style.getPropertyValue('--app-link')).toBe('#1769ff')
    })

    it('applies the navy Xthings palette in dark mode', () => {
        applyColorTheme('xthings', 'dark')
        expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('#101827')
        expect(document.documentElement.style.getPropertyValue('--app-fg')).toBe('#eef4ff')
        expect(document.documentElement.style.getPropertyValue('--app-link')).toBe('#73a5ff')
    })

    it('keeps the palette fixed when the hook is asked to change it', () => {
        const { result } = renderHook(() => useColorTheme())

        act(() => result.current.setColorTheme('xthings'))

        expect(result.current.colorTheme).toBe('xthings')
        expect(localStorage.getItem(getColorThemeStorageKey())).toBeNull()
        expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('#f6f8fc')
    })
})
