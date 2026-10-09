import { describe, expect, it } from 'vitest'
import en from '@/lib/locales/en'
import zhCN from '@/lib/locales/zh-CN'
import { getBuiltinSlashCommands } from '@/lib/codexSlashCommands'
import { getLocalizedSlashCommandDescription } from './useSlashCommands'

const enMessages = en as Record<string, string>
const zhMessages = zhCN as Record<string, string>

function translate(dict: Record<string, string>) {
    return (key: string, params?: Record<string, string | number>) => {
        const value = dict[key] ?? enMessages[key] ?? key
        if (!params) return value
        return value.replace(/\{(\w+)\}/g, (match, paramKey) => {
            const paramValue = params[paramKey]
            return paramValue === undefined ? match : String(paramValue)
        })
    }
}

describe('getLocalizedSlashCommandDescription', () => {
    it('has English and Chinese descriptions for every built-in slash command', () => {
        for (const agentType of ['claude', 'codex', 'gemini', 'grok', 'opencode', 'cursor']) {
            for (const command of getBuiltinSlashCommands(agentType)) {
                const key = `slashCommands.${agentType}.${command.name}.description`
                expect(enMessages[key], key).toBeTruthy()
                expect(zhMessages[key], key).toBeTruthy()
            }
        }
    })

    it('uses the active locale for API-provided built-in command descriptions', () => {
        expect(getLocalizedSlashCommandDescription({
            name: 'agent',
            source: 'builtin',
            description: 'Toggle proactive Codex multi-agent delegation',
        }, 'codex', translate(zhCN))).toBe('开启/关闭 Codex 主动多智能体委派')
    })

    it('keeps custom command descriptions supplied by the user or project', () => {
        expect(getLocalizedSlashCommandDescription({
            name: 'ship-it',
            source: 'project',
            description: 'Run the release checklist',
        }, 'codex', translate(zhCN))).toBe('Run the release checklist')
    })

    it('localizes the fallback label for custom commands without descriptions', () => {
        expect(getLocalizedSlashCommandDescription({
            name: 'ship-it',
            source: 'project',
            description: 'Custom command',
        }, 'codex', translate(zhCN))).toBe('自定义命令')
    })

    it('localizes generated plugin command descriptions', () => {
        expect(getLocalizedSlashCommandDescription({
            name: 'qa:ship-it',
            source: 'plugin',
            pluginName: 'qa',
            description: 'qa command',
        }, 'claude', translate(zhCN))).toBe('插件 qa 命令')
    })

    it('uses Claude descriptions for unknown agents that fall back to Claude commands', () => {
        expect(getLocalizedSlashCommandDescription({
            name: 'clear',
            source: 'builtin',
            description: 'Clear conversation history and free up context',
        }, 'mystery', translate(zhCN))).toBe('清除对话历史并释放上下文')
    })

    it('falls back to the command description when a built-in translation is missing', () => {
        expect(getLocalizedSlashCommandDescription({
            name: 'future',
            source: 'builtin',
            description: 'Future command',
        }, 'codex', translate(zhCN))).toBe('Future command')
    })
})
