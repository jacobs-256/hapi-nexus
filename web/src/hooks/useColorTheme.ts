import { useCallback, useEffect, useState } from 'react'
import type { ThemeColorKeyId } from './useThemeColors'

export type ColorScheme = 'light' | 'dark' | 'oled'

/** The single supported web-console palette. */
export type ColorThemePreset = 'xthings'

export type ColorThemeOption = {
    value: ColorThemePreset
    labelKey: string
    preview: {
        light: string
        dark: string
        accent: string
    }
}

type ThemePalette = {
    accent: string
    background: string
    foreground: string
    hint: string
    secondary: string
    dialog: string
    surface: string
    userBubble: string
    surfaceHover: string
    code: string
    border: string
    subtle: string
    buttonText: string
}

const COLOR_THEME_KEY = 'hapi-color-theme'
const XTHINGS_THEME: ColorThemePreset = 'xthings'

const COLOR_THEME_OPTIONS: ReadonlyArray<ColorThemeOption> = [
    {
        value: XTHINGS_THEME,
        labelKey: 'settings.display.colorTheme.xthings',
        preview: { light: '#f6f8fc', dark: '#101827', accent: '#1769ff' },
    },
]

/** Xthings Survey colors, with a navy dark-mode counterpart. */
const PALETTES: Record<'light' | 'dark', ThemePalette> = {
    light: {
        accent: '#1769ff',
        background: '#f6f8fc',
        foreground: '#172033',
        hint: '#738096',
        secondary: '#eef2f7',
        dialog: '#ffffff',
        surface: '#ffffff',
        userBubble: '#edf3ff',
        surfaceHover: '#f8faff',
        code: '#eef2f7',
        border: 'rgba(23, 32, 51, 0.12)',
        subtle: '#edf3ff',
        buttonText: '#ffffff',
    },
    dark: {
        accent: '#73a5ff',
        background: '#101827',
        foreground: '#eef4ff',
        hint: '#a7b0c1',
        secondary: '#18263d',
        dialog: '#18263d',
        surface: '#1e2b40',
        userBubble: '#223756',
        surfaceHover: '#263957',
        code: '#18263d',
        border: 'rgba(230, 234, 241, 0.16)',
        subtle: '#1e2b40',
        buttonText: '#101827',
    },
}

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function safeGetItem(key: string): string | null {
    if (!isBrowser()) return null
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeRemoveItem(key: string): void {
    if (!isBrowser()) return
    try {
        localStorage.removeItem(key)
    } catch {
        // Ignore storage errors
    }
}

/** Resolve any previous selection to the only supported Xthings palette. */
export function parseColorTheme(_raw: string | null): ColorThemePreset {
    return XTHINGS_THEME
}

export function getStoredColorTheme(): ColorThemePreset {
    // Clear a legacy selection as soon as it is observed. The palette is now
    // fixed, so keeping that value would only make old settings look active.
    const stored = safeGetItem(COLOR_THEME_KEY)
    if (stored !== null && stored !== XTHINGS_THEME) safeRemoveItem(COLOR_THEME_KEY)
    return XTHINGS_THEME
}

export function getColorThemeOptions(): ReadonlyArray<ColorThemeOption> {
    return COLOR_THEME_OPTIONS
}

export function getColorThemePreview(_theme: ColorThemePreset): ColorThemeOption['preview'] {
    return COLOR_THEME_OPTIONS[0]!.preview
}

export function getColorThemeStorageKey(): string {
    return COLOR_THEME_KEY
}

export function getColorThemeBackground(_theme: ColorThemePreset, scheme: ColorScheme): string {
    return PALETTES[toPaletteScheme(scheme)].background
}

export function getColorThemePickerValue(_theme: ColorThemePreset, scheme: ColorScheme, id: ThemeColorKeyId): string {
    const palette = PALETTES[toPaletteScheme(scheme)]
    const values: Record<ThemeColorKeyId, string> = {
        background: palette.background,
        surface: palette.secondary,
        text: palette.foreground,
        hint: palette.hint,
        accent: palette.accent,
        border: compositeOnBackground(palette.border, palette.background),
        userBubble: palette.userBubble,
    }
    return values[id]
}

export function applyColorTheme(_theme: ColorThemePreset = XTHINGS_THEME, scheme: ColorScheme): void {
    if (!isBrowser()) return

    const root = document.documentElement
    root.setAttribute('data-color-theme', XTHINGS_THEME)

    const values = PALETTES[toPaletteScheme(scheme)]
    const properties: Record<string, string> = {
        '--app-bg': values.background,
        '--app-fg': values.foreground,
        '--app-hint': values.hint,
        '--app-link': values.accent,
        '--app-button': values.accent,
        '--app-button-text': values.buttonText,
        '--app-banner-bg': values.accent,
        '--app-banner-text': values.buttonText,
        '--app-secondary-bg': values.secondary,
        '--app-dialog-bg': values.dialog,
        '--app-chat-user-bg': values.userBubble,
        '--app-chat-user-fg': values.foreground,
        '--app-chat-user-chip-bg': withAlpha(values.accent, toPaletteScheme(scheme) === 'dark' ? 0.24 : 0.15),
        '--app-chat-user-chip-fg': values.accent,
        '--app-tool-card-bg': values.surface,
        '--app-tool-card-hover-bg': values.surfaceHover,
        '--app-tool-card-accent': values.hint,
        '--app-tool-card-muted-action-fg': withAlpha(values.hint, 0.72),
        '--app-tool-card-subtitle': values.hint,
        '--app-code-header-bg': values.surfaceHover,
        '--app-code-header-fg': values.hint,
        '--app-code-bg': values.code,
        '--app-inline-code-bg': values.code,
        '--app-inline-code-fg': values.foreground,
        '--app-md-quote-bg': values.surface,
        '--app-md-quote-border': withAlpha(values.accent, 0.35),
        '--app-md-quote-fg': values.foreground,
        '--app-md-table-bg': values.surface,
        '--app-md-table-head-bg': values.surfaceHover,
        '--app-reasoning-bg': values.surface,
        '--app-border': values.border,
        '--app-divider': values.border,
        '--app-subtle-bg': values.subtle,
        '--app-scrollbar-thumb': withAlpha(values.hint, 0.38),
        '--app-scrollbar-thumb-hover': withAlpha(values.hint, 0.56),
    }

    for (const [key, value] of Object.entries(properties)) {
        root.style.setProperty(key, value)
    }
}

function getDocumentColorScheme(): ColorScheme {
    if (!isBrowser()) return 'light'
    const theme = document.documentElement.getAttribute('data-theme')
    return theme === 'dark' || theme === 'oled' ? theme : 'light'
}

function toPaletteScheme(scheme: ColorScheme): 'light' | 'dark' {
    return scheme === 'light' ? 'light' : 'dark'
}

export function useColorTheme(): { colorTheme: ColorThemePreset; setColorTheme: (theme: ColorThemePreset) => void } {
    const [colorTheme, setColorThemeState] = useState<ColorThemePreset>(XTHINGS_THEME)

    useEffect(() => {
        if (!isBrowser()) return
        const onStorage = (event: StorageEvent) => {
            if (event.key !== COLOR_THEME_KEY) return
            setColorThemeState(XTHINGS_THEME)
            applyColorTheme(XTHINGS_THEME, getDocumentColorScheme())
            window.dispatchEvent(new CustomEvent('hapi-color-theme-change', { detail: XTHINGS_THEME }))
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setColorTheme = useCallback((_theme: ColorThemePreset) => {
        setColorThemeState(XTHINGS_THEME)
        applyColorTheme(XTHINGS_THEME, getDocumentColorScheme())
        // The fixed palette does not need a preference in storage.
        safeRemoveItem(COLOR_THEME_KEY)
        window.dispatchEvent(new CustomEvent('hapi-color-theme-change', { detail: XTHINGS_THEME }))
    }, [])

    return { colorTheme, setColorTheme }
}

function withAlpha(hex: string, alpha: number): string {
    const color = parseHex(hex)
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`
}

function compositeOnBackground(rgba: string, background: string): string {
    const match = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(rgba)
    if (!match) return rgba
    const base = parseHex(background)
    const alpha = Number(match[4])
    const blend = (foreground: number, behind: number) => Math.round(foreground * alpha + behind * (1 - alpha))
    return toHex(blend(Number(match[1]), base.r), blend(Number(match[2]), base.g), blend(Number(match[3]), base.b))
}

function parseHex(hex: string): { r: number; g: number; b: number } {
    const clean = hex.replace('#', '')
    const value = clean.length === 3
        ? clean.split('').map((char) => `${char}${char}`).join('')
        : clean
    return {
        r: parseInt(value.slice(0, 2), 16),
        g: parseInt(value.slice(2, 4), 16),
        b: parseInt(value.slice(4, 6), 16),
    }
}

function toHex(r: number, g: number, b: number): string {
    return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}
