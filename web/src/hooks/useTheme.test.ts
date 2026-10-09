import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getAppearanceOptions, getThemeColor, initializeTheme, useAppearance } from '@/hooks/useTheme'

describe('useTheme', () => {
    beforeEach(() => {
        localStorage.clear()
        document.documentElement.removeAttribute('data-theme')
        document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove())
    })

    it('applies the stored dark appearance to the document and browser theme color', () => {
        localStorage.setItem('hapi-appearance', 'dark')

        initializeTheme()

        expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
        expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(getThemeColor('dark'))
    })

    it('creates a browser theme color meta tag with the Xthings background', () => {
        initializeTheme()

        const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        expect(meta?.content).toBe(getThemeColor('light'))
        expect(meta?.content).toBe('#f6f8fc')
        expect(meta?.hasAttribute('media')).toBe(false)
    })

    it('clears the boot-time inline html background when runtime theme initializes', () => {
        document.documentElement.style.backgroundColor = '#fbfbff'

        initializeTheme()

        expect(document.documentElement.style.backgroundColor).toBe('')
        expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('#f6f8fc')
    })

    it('keeps the fixed palette after legacy color theme storage events', () => {
        localStorage.setItem('hapi-color-theme', 'one')
        initializeTheme()
        expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe('#f6f8fc')

        localStorage.setItem('hapi-color-theme', 'notion')
        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: 'hapi-color-theme', newValue: 'notion' }))
        })

        expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe('#f6f8fc')
        expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('#f6f8fc')
    })

    it('updates browser theme color when appearance changes', () => {
        const { result } = renderHook(() => useAppearance())

        act(() => result.current.setAppearance('dark'))
        expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
        expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe('#101827')

        act(() => result.current.setAppearance('light'))
        expect(document.documentElement).toHaveAttribute('data-theme', 'light')
        expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe('#f6f8fc')
    })

    it('exposes only system, light, and dark appearance options', () => {
        expect(getAppearanceOptions().map((option) => option.value)).toEqual(['system', 'light', 'dark'])
    })

    it('maps a legacy OLED preference to the system appearance', () => {
        localStorage.setItem('hapi-appearance', 'oled')

        initializeTheme()

        expect(document.documentElement.getAttribute('data-theme')).not.toBe('oled')
        expect(['light', 'dark']).toContain(document.documentElement.getAttribute('data-theme'))
    })
})
