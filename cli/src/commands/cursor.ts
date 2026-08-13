import chalk from 'chalk'
import { authAndSetupMachineIfNeeded } from '@/ui/auth'
import { initializeToken } from '@/ui/tokenInit'
import { maybeAutoStartServer } from '@/utils/autoStartServer'
import type { CommandDefinition } from './types'
import { parseCursorCommandArgs } from './cursorCommandOptions'

export const cursorCommand: CommandDefinition = {
    name: 'cursor',
    requiresRuntimeAssets: true,
    run: async ({ commandArgs }) => {
        try {
            const { runCursor } = await import('@/cursor/runCursor')
            const options = parseCursorCommandArgs(commandArgs)

            await initializeToken()
            await maybeAutoStartServer()
            await authAndSetupMachineIfNeeded()
            await runCursor(options)
        } catch (error) {
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
            if (process.env.DEBUG) {
                console.error(error)
            }
            process.exit(1)
        }
    }
}
