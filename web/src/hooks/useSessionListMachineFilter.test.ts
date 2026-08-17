import { beforeEach, describe, expect, it } from 'vitest'
import {
    DEFAULT_SESSION_LIST_MACHINE_FILTER,
    getInitialSessionListMachineFilter,
} from './useSessionListMachineFilter'

describe('useSessionListMachineFilter helpers', () => {
    beforeEach(() => {
        window.localStorage.clear()
    })

    it('defaults to an empty array (all machines) for missing or blank storage values', () => {
        expect(getInitialSessionListMachineFilter()).toBe(DEFAULT_SESSION_LIST_MACHINE_FILTER)
        expect(getInitialSessionListMachineFilter()).toEqual([])

        window.localStorage.setItem('hapi-session-list-machine-filter', '')
        expect(getInitialSessionListMachineFilter()).toEqual([])

        window.localStorage.setItem('hapi-session-list-machine-filter', '   ')
        expect(getInitialSessionListMachineFilter()).toEqual([])
    })

    it('reads a legacy stored machine id', () => {
        window.localStorage.setItem('hapi-session-list-machine-filter', 'machine-1')

        expect(getInitialSessionListMachineFilter()).toEqual(['machine-1'])
    })

    it('reads stored machine ids', () => {
        window.localStorage.setItem('hapi-session-list-machine-filter', JSON.stringify(['machine-1', 'machine-2']))

        expect(getInitialSessionListMachineFilter()).toEqual(['machine-1', 'machine-2'])
    })
})
