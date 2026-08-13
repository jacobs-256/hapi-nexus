import { describe, expect, it, vi } from 'vitest'

const {
    bundleFeatureMock,
    maybeAutoStartServerImplMock
} = vi.hoisted(() => ({
    bundleFeatureMock: vi.fn((_: string) => false),
    maybeAutoStartServerImplMock: vi.fn(async () => {})
}))

vi.mock('bun:bundle', () => ({
    feature: bundleFeatureMock
}))

vi.mock('./autoStartServerImpl', () => ({
    maybeAutoStartServerImpl: maybeAutoStartServerImplMock
}))

describe('maybeAutoStartServer', () => {
    it('does not attempt to start hub from the client binary', async () => {
        vi.resetModules()
        bundleFeatureMock.mockImplementation((name: string) => name === 'HAPI_BINARY_CLIENT')

        const { maybeAutoStartServer } = await import('./autoStartServer')
        await maybeAutoStartServer()

        expect(maybeAutoStartServerImplMock).not.toHaveBeenCalled()
    })

    it('delegates to the hub auto-start implementation outside client binaries', async () => {
        vi.resetModules()
        bundleFeatureMock.mockReturnValue(false)

        const { maybeAutoStartServer } = await import('./autoStartServer')
        await maybeAutoStartServer({ waitForReady: false, quiet: true })

        expect(maybeAutoStartServerImplMock).toHaveBeenCalledWith({ waitForReady: false, quiet: true })
    })
})
