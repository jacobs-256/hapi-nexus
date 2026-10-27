import { describe, expect, it } from 'bun:test'
import { MysqlBackoff } from './backoff'

const error = (code: string) => Object.assign(new Error(code), { code })

describe('MySQL reconnect backoff', () => {
    it('backs off exponentially, caps delays and admits only one recovery probe', () => {
        let now = 0
        const gate = new MysqlBackoff(() => now, () => 1)
        gate.enter()
        for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
            gate.failure(error('ER_CON_COUNT_ERROR'))
            expect(() => gate.enter()).toThrow('reconnect paused')
            now += delay - 1
            expect(() => gate.enter()).toThrow('reconnect paused')
            now++
            gate.enter()
            expect(() => gate.enter()).toThrow('reconnect paused')
        }
    })

    it('pauses blocked hosts for one minute, increases to five minutes and resets on recovery', () => {
        let now = 0
        const gate = new MysqlBackoff(() => now, () => 1)
        for (const delay of [60000, 120000, 240000, 300000]) {
            gate.failure(error('ER_HOST_IS_BLOCKED'))
            now += delay - 1
            expect(() => gate.enter()).toThrow('reconnect paused')
            now++
            gate.enter()
        }
        // The admitted probe succeeds; normal concurrent admissions resume.
        gate.success(4)
        expect(gate.enter()).toBe(0)
        expect(gate.enter()).toBe(0)
    })

    it('does not multiply the delay for concurrent failures or reset it on stale success', () => {
        let now = 0
        const gate = new MysqlBackoff(() => now, () => 1)
        const generation = gate.enter()
        gate.failure(error('ECONNRESET'))
        gate.failure(error('ECONNRESET'))
        gate.success(generation)
        expect(() => gate.enter()).toThrow('reconnect paused')
        now = 1000
        expect(gate.enter()).toBe(1)
    })

    it('does not back off SQL or authentication errors', () => {
        const gate = new MysqlBackoff()
        for (const code of ['ER_PARSE_ERROR', 'ER_ACCESS_DENIED_ERROR', 'ER_DUP_ENTRY']) {
            gate.failure(error(code))
            expect(gate.enter()).toBe(0)
        }
    })

    it('unlocks the recovery probe after a non-retryable failure', () => {
        let now = 0
        const gate = new MysqlBackoff(() => now, () => 1)
        gate.failure(error('ETIMEDOUT'))
        now = 1000
        gate.enter()
        gate.failure(error('ER_ACCESS_DENIED_ERROR'))
        expect(gate.enter()).toBe(1)
    })
})
