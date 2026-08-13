import { describe, expect, it, vi } from 'vitest'

const { bundleFeatureMock } = vi.hoisted(() => ({
    bundleFeatureMock: vi.fn((_: string) => false)
}))

vi.mock('bun:bundle', () => ({
    feature: bundleFeatureMock
}))

describe('command registry', () => {
    it('excludes hub commands from client binaries', async () => {
        vi.resetModules()
        bundleFeatureMock.mockImplementation((name: string) => name === 'HAPI_BINARY_CLIENT')
        const { resolveCommand } = await import('./registry')

        await expect(resolveCommand(['hub'])).resolves.toMatchObject({
            command: { name: 'hub' },
            context: {
                subcommand: 'hub',
                commandArgs: []
            }
        })

        await expect(resolveCommand(['server'])).resolves.toMatchObject({
            command: { name: 'server' },
            context: {
                subcommand: 'server',
                commandArgs: []
            }
        })
    })

    it('keeps hub commands available outside client binaries', async () => {
        vi.resetModules()
        bundleFeatureMock.mockReturnValue(false)
        const { resolveCommand } = await import('./registry')

        await expect(resolveCommand(['hub'])).resolves.toMatchObject({
            command: { name: 'hub' },
            context: {
                subcommand: 'hub',
                commandArgs: []
            }
        })

        await expect(resolveCommand(['server'])).resolves.toMatchObject({
            command: { name: 'server' },
            context: {
                subcommand: 'server',
                commandArgs: []
            }
        })
    })
})
