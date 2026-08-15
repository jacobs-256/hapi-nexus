import { beforeEach, describe, expect, it } from 'vitest'
import {
    DEFAULT_COMPOSER_TOOLBAR_LAYOUT,
    isComposerToolbarItemEnabled,
    mergeComposerToolbarDisabledItems,
    moveComposerToolbarItemInSingleLayout,
    normalizeComposerToolbarLayout,
    setComposerToolbarItemDisabled,
} from './useComposerToolbarLayout'

describe('DEFAULT_COMPOSER_TOOLBAR_LAYOUT', () => {
    it('keeps abort last in the default order', () => {
        expect(DEFAULT_COMPOSER_TOOLBAR_LAYOUT.left).toEqual([
            'attachment',
            'settings',
            'piModel',
            'piThinking',
            'terminal',
            'switch',
            'voiceMic',
            'scratchlist',
            'schedule',
            'abort',
        ])
        expect(DEFAULT_COMPOSER_TOOLBAR_LAYOUT.disabled).toEqual([])
    })
})

describe('normalizeComposerToolbarLayout', () => {
    beforeEach(() => localStorage.clear())

    it('falls back to the default layout for invalid data', () => {
        expect(normalizeComposerToolbarLayout(null)).toEqual(DEFAULT_COMPOSER_TOOLBAR_LAYOUT)
    })

    it('keeps valid order, removes duplicates, and appends newly introduced items', () => {
        const result = normalizeComposerToolbarLayout({
            mode: 'split',
            left: ['settings', 'attachment', 'settings', 'unknown'],
            right: ['abort', 'schedule', 'attachment'],
            disabled: ['terminal', 'unknown', 'terminal', 'schedule'],
        })

        expect(result.mode).toBe('split')
        expect(result.left.slice(0, 2)).toEqual(['settings', 'attachment'])
        expect(result.right).toEqual(['abort', 'schedule'])
        expect(result.disabled).toEqual(['terminal', 'schedule'])
        expect([...result.left, ...result.right]).toHaveLength(DEFAULT_COMPOSER_TOOLBAR_LAYOUT.left.length)
    })

    it('reorders across a hidden split boundary in single-column modes', () => {
        const layout = normalizeComposerToolbarLayout({
            mode: 'right',
            left: ['attachment', 'settings', 'piModel', 'piThinking', 'terminal'],
            right: ['abort', 'switch', 'voiceMic', 'scratchlist', 'schedule'],
        })
        const result = moveComposerToolbarItemInSingleLayout(layout, 'attachment', 7)

        expect([...result.left, ...result.right].slice(0, 8)).toEqual([
            'settings',
            'piModel',
            'piThinking',
            'terminal',
            'abort',
            'switch',
            'voiceMic',
            'attachment',
        ])
        expect(result.left).toHaveLength(layout.left.length)
    })

    it('toggles disabled tools without changing their order', () => {
        const disabled = setComposerToolbarItemDisabled(DEFAULT_COMPOSER_TOOLBAR_LAYOUT, 'terminal', true)
        const enabled = setComposerToolbarItemDisabled(disabled, 'terminal', false)

        expect(isComposerToolbarItemEnabled(disabled, 'terminal')).toBe(false)
        expect(disabled.left).toEqual(DEFAULT_COMPOSER_TOOLBAR_LAYOUT.left)
        expect(enabled.disabled).toEqual([])
    })

    it('merges global disabled tools with local disabled tools', () => {
        const layout = setComposerToolbarItemDisabled(DEFAULT_COMPOSER_TOOLBAR_LAYOUT, 'attachment', true)
        const result = mergeComposerToolbarDisabledItems(layout, ['terminal', 'attachment'])

        expect(result.disabled).toEqual(['attachment', 'terminal'])
        expect(result.left).toEqual(DEFAULT_COMPOSER_TOOLBAR_LAYOUT.left)
    })
})
