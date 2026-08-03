import { describe, expect, it } from 'vitest'

import type { Machine } from '@/types/api'
import { isPathInsideProjectRoot } from './ProjectSelector'

const posixMachine = {
    id: 'machine-1',
    metadata: {
        host: 'mac',
        platform: 'darwin',
        happyCliVersion: '1.0.0',
        workspaceRoots: ['/srv/projects']
    }
} as Machine

const windowsMachine = {
    id: 'machine-2',
    metadata: {
        host: 'win',
        platform: 'win32',
        happyCliVersion: '1.0.0',
        workspaceRoots: ['C:\\Projects']
    }
} as Machine

describe('ProjectSelector path matching', () => {
    it('normalizes dot segments before checking POSIX project roots', () => {
        expect(isPathInsideProjectRoot(posixMachine, '/srv/projects/app/./src', '/srv/projects/app')).toBe(true)
        expect(isPathInsideProjectRoot(posixMachine, '/srv/projects/app/../secret', '/srv/projects/app')).toBe(false)
    })

    it('normalizes Windows separators, case, and dot segments', () => {
        expect(isPathInsideProjectRoot(windowsMachine, 'c:/projects/app/src', 'C:\\Projects\\App')).toBe(true)
        expect(isPathInsideProjectRoot(windowsMachine, 'C:\\Projects\\App\\..\\Secret', 'C:\\Projects\\App')).toBe(false)
    })
})
