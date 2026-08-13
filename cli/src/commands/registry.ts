import chalk from 'chalk'
import { authCommand } from './auth'
import { claudeCommand } from './claude'
import { codexCommand } from './codex'
import { cursorCommand } from './cursor'
import { connectCommand } from './connect'
import { runnerCommand } from './runner'
import { resumeCommand } from './resume'
import { doctorCommand } from './doctor'
import { kimiCommand } from './kimi'
import { grokCommand } from './grok'
import { opencodeCommand } from './opencode'
import { piCommand } from './pi'
import { hookForwarderCommand } from './hookForwarder'
import { mcpCommand } from './mcp'
import { notifyCommand } from './notify'
import { pingPeerCommand } from './pingPeer'
import { inspectPeerCommand } from './inspectPeer'
import { feature } from 'bun:bundle'
import type { CommandContext, CommandDefinition } from './types'

// Gemini CLI was sunset (Google stopped serving the consumer Gemini CLI on
// 2026-06-18) so the agent is no longer launchable. Keep an explicit tombstone
// command so `hapi gemini` reports a clear error instead of falling through to
// the default Claude command with "gemini" as a forwarded argument.
const removedGeminiCommand: CommandDefinition = {
    name: 'gemini',
    requiresRuntimeAssets: false,
    run: async () => {
        console.error(
            chalk.red('Error:'),
            'Gemini CLI is no longer supported and cannot be launched (Google sunset the consumer Gemini CLI on 2026-06-18). Existing Gemini sessions remain viewable in the web UI.'
        )
        process.exit(1)
    }
}

const BASE_COMMANDS: CommandDefinition[] = [
    authCommand,
    connectCommand,
    codexCommand,
    cursorCommand,
    removedGeminiCommand,
    grokCommand,
    kimiCommand,
    opencodeCommand,
    piCommand,
    mcpCommand,
    hookForwarderCommand,
    doctorCommand,
    resumeCommand,
    runnerCommand,
    notifyCommand,
    pingPeerCommand,
    inspectPeerCommand
]

const clientHubUnavailableCommand: CommandDefinition = {
    name: 'hub',
    requiresRuntimeAssets: false,
    run: async () => {
        console.error(chalk.red('Error:'), 'The hapi client binary does not include the Hub/Web server.')
        console.error(chalk.gray('  Install the hapi-server release package and run: hapi-server hub'))
        process.exit(1)
    }
}

let commandMapPromise: Promise<Map<string, CommandDefinition>> | null = null

async function buildCommandMap(): Promise<Map<string, CommandDefinition>> {
    const commands = [...BASE_COMMANDS]

    if (!feature('HAPI_BINARY_CLIENT')) {
        const { hubCommand } = await import('./hub')
        commands.push(hubCommand, { ...hubCommand, name: 'server' })
    } else {
        commands.push(clientHubUnavailableCommand, { ...clientHubUnavailableCommand, name: 'server' })
    }

    const commandMap = new Map<string, CommandDefinition>()
    for (const command of commands) {
        commandMap.set(command.name, command)
    }
    return commandMap
}

function getCommandMap(): Promise<Map<string, CommandDefinition>> {
    commandMapPromise ??= buildCommandMap()
    return commandMapPromise
}

export async function resolveCommand(args: string[]): Promise<{ command: CommandDefinition; context: CommandContext }> {
    const subcommand = args[0]
    const commandMap = await getCommandMap()
    const command = subcommand ? commandMap.get(subcommand) : undefined
    const resolvedCommand = command ?? claudeCommand
    const commandArgs = command ? args.slice(1) : args

    return {
        command: resolvedCommand,
        context: {
            args,
            subcommand,
            commandArgs
        }
    }
}
