import { afterEach, describe, expect, it, vi } from 'vitest'

describe('CLI entrypoint', () => {
    afterEach(() => {
        vi.resetModules()
        vi.doUnmock('./commands/runCli')
    })

    it('waits for runCli so pending startup work can keep the process alive', async () => {
        let completed = false
        vi.doMock('./commands/runCli', () => ({
            runCli: vi.fn(async () => {
                await new Promise<void>((resolve) => setTimeout(resolve, 20))
                completed = true
            })
        }))

        const loaded = import('./index')

        await Promise.resolve()
        expect(completed).toBe(false)

        await loaded
        expect(completed).toBe(true)
    })
})
