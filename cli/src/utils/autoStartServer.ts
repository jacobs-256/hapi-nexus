import { feature } from 'bun:bundle'

export type AutoStartServerOptions = {
    waitForReady?: boolean
    quiet?: boolean
}

export async function maybeAutoStartServer(options?: AutoStartServerOptions): Promise<void> {
    if (!feature('HAPI_BINARY_CLIENT')) {
        const { maybeAutoStartServerImpl } = await import('./autoStartServerImpl')
        await maybeAutoStartServerImpl(options)
    }
}
