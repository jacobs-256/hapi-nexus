import type { AuthResponse } from '@/types/api'

export const settingsCategories = [
    { id: 'general', path: '/settings/general', titleKey: 'settings.general.title' },
    { id: 'display', path: '/settings/display', titleKey: 'settings.display.title' },
    { id: 'chat', path: '/settings/chat', titleKey: 'settings.chat.title' },
    { id: 'voice', path: '/settings/voice', titleKey: 'settings.voice.title' },
    { id: 'account', path: '/settings/account', titleKey: 'settings.account.title' },
    { id: 'users', path: '/settings/users', titleKey: 'settings.users.title' },
    { id: 'projects', path: '/settings/projects', titleKey: 'settings.projects.title' },
    { id: 'machines', path: '/settings/machines', titleKey: 'settings.machines.title' },
    { id: 'storage', path: '/settings/storage', titleKey: 'settings.storage.title' },
    { id: 'tasks', path: '/settings/tasks', titleKey: 'settings.tasks.title' },
    { id: 'about', path: '/settings/about', titleKey: 'settings.about.title' },
] as const

export type SettingsCategory = typeof settingsCategories[number]
export type SettingsCategoryId = SettingsCategory['id']

export const settingsCategoryGroups: Array<{ id: string; titleKey: string; categoryIds: SettingsCategoryId[] }> = [
    { id: 'workspace', titleKey: 'settings.nav.workspace', categoryIds: ['general', 'display', 'chat', 'voice'] },
    { id: 'enterprise', titleKey: 'settings.nav.enterprise', categoryIds: ['account', 'users', 'projects', 'machines'] },
    { id: 'system', titleKey: 'settings.nav.system', categoryIds: ['storage', 'tasks', 'about'] },
]

export function getNamespace(token: string): string | null {
    try {
        const payload = token.split('.')[1]
        if (!payload) return null
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
        const decoded = JSON.parse(atob(base64)) as { ns?: unknown }
        return typeof decoded.ns === 'string' ? decoded.ns : null
    } catch {
        return null
    }
}

export function getVisibleSettingsCategories(args: {
    token: string
    user: AuthResponse['user'] | null | undefined
}): SettingsCategory[] {
    return settingsCategories.filter((category) => {
        if (category.id === 'storage') return getNamespace(args.token) === 'default' && args.user?.role === 'admin'
        if (category.id === 'tasks') return args.user?.role === 'admin'
        if (category.id === 'users') return args.user?.role === 'admin'
        return true
    })
}

export function getSettingsCategory(pathname: string): SettingsCategory | undefined {
    return settingsCategories.find((category) => pathname === category.path || pathname.startsWith(`${category.path}/`))
}
