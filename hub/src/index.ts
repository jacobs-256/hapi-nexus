import { startHub } from './startHub'

async function main() {
    const hub = await startHub()
    let shuttingDown = false

    const shutdown = async () => {
        if (shuttingDown) return
        shuttingDown = true
        console.log('\nShutting down...')
        const forceExit = setTimeout(() => {
            console.warn('Shutdown timed out; forcing exit.')
            process.exit(0)
        }, 5_000)
        forceExit.unref()
        try {
            await hub.stop()
        } finally {
            clearTimeout(forceExit)
            process.exit(0)
        }
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    // Keep process running
    await new Promise(() => {})
}

main().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
})
