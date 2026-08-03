import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { ApiClient } from '@/api/client'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useAppearance, useTheme } from '@/hooks/useTheme'
import { useTranslation } from '@/lib/use-translation'
import type { ServerUrlResult } from '@/hooks/useServerUrl'
import type { AuthResponse } from '@/types/api'

type LoginPromptProps = {
    mode?: 'login' | 'bind'
    onLogin?: (auth: AuthResponse, remember: boolean) => void
    onBind?: (token: string) => Promise<void>
    baseUrl: string
    serverUrl: string | null
    setServerUrl: (input: string) => ServerUrlResult
    clearServerUrl: () => void
    requireServerUrl?: boolean
    error?: string | null
}

function IconSun() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
    )
}

function IconMoon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
    )
}

function IconUser() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
        </svg>
    )
}

function IconEye(props: { show: boolean }) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {props.show ? (
                <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                </>
            ) : (
                <>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                </>
            )}
        </svg>
    )
}

function IconCode(props: { size?: number }) {
    const size = props.size ?? 26
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
        </svg>
    )
}

function TrafficLights() {
    return (
        <>
            {['#ff5f56', '#ffbd2e', '#27c93f'].map((color) => (
                <div key={color} style={{ width: 11, height: 11, borderRadius: '50%', background: color, opacity: 0.9 }} />
            ))}
        </>
    )
}

function MockAppShell() {
    const taskRows = [
        ['Refactor authentication module', 'Done', '#30d158'],
        ['Add rate limiting middleware', 'Running', '#0a84ff'],
        ['Generate OpenAPI spec from routes', 'Pending', '#8e8e93'],
        ['Write unit tests for UserService', 'Done', '#30d158'],
    ]
    const diffRows = [
        ['+', 'import { RefreshTokenService } from "./refresh"', '#30d158', 'var(--diff-add)'],
        ['-', 'export function createToken(userId: string) {', '#ff453a', 'var(--diff-remove)'],
        ['-', '  return sign({ sub: userId }, config.jwtSecret)', '#ff453a', 'var(--diff-remove)'],
        ['+', 'export class AuthService {', '#30d158', 'var(--diff-add)'],
        ['+', '  private refreshTokenService = new RefreshTokenService()', '#30d158', 'var(--diff-add)'],
        ['', '  verifyToken(token: string) {', 'var(--muted-foreground)', 'transparent'],
        ['+', '  async refreshAccess(refreshToken: string) {', '#30d158', 'var(--diff-add)'],
    ]

    return (
        <div
            className="absolute inset-0 flex min-w-[1180px] flex-col overflow-hidden"
            style={{
                background: 'var(--background)',
                color: 'var(--foreground)',
                filter: 'blur(8px) saturate(0.5)',
                transform: 'scale(1.015)',
                transformOrigin: 'center',
                pointerEvents: 'none',
            }}
        >
            <div className="relative flex h-11 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--toolbar)] pl-20 pr-4">
                <div className="absolute left-3.5 flex gap-[7px]">
                    <TrafficLights />
                </div>
                <div className="flex items-center gap-1.5">
                    <div
                        className="flex h-[22px] w-[22px] items-center justify-center rounded-md text-white"
                        style={{ background: 'linear-gradient(135deg, #0a84ff, #5e5ce6)' }}
                    >
                        <IconCode size={12} />
                    </div>
                    <span className="text-[13px] font-semibold tracking-[-0.2px]">HAPI</span>
                    <span className="font-mono text-[11px] text-[var(--muted-foreground)]">— private-hub</span>
                </div>
                <div
                    className="ml-auto h-7 w-7 rounded-full text-center text-[11px] font-bold leading-7 text-white"
                    style={{ background: 'linear-gradient(135deg, #0a84ff, #5e5ce6)' }}
                >
                    A
                </div>
            </div>

            <div className="flex min-h-0 flex-1">
                <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--sidebar)]">
                    <div className="flex border-b border-[var(--border)] px-2">
                        {['Tasks', 'Explorer', 'History'].map((label, index) => (
                            <div
                                key={label}
                                className="flex-1 py-2.5 text-center text-[11px] font-medium"
                                style={{
                                    color: index === 0 ? 'var(--primary)' : 'var(--muted-foreground)',
                                    borderBottom: index === 0 ? '2px solid var(--primary)' : '2px solid transparent',
                                    marginBottom: -1,
                                }}
                            >
                                {label}
                            </div>
                        ))}
                    </div>
                    <div className="p-2.5 pb-1.5">
                        <div className="flex h-8 items-center justify-center gap-1 rounded-[7px] border border-dashed border-[var(--border)] text-[11px] font-medium text-[var(--muted-foreground)]">
                            + New Task
                        </div>
                    </div>
                    <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden px-2">
                        {taskRows.map(([title, status, color], index) => (
                            <div
                                key={title}
                                className="rounded-lg px-3 py-2.5"
                                style={{
                                    background: index === 0 ? 'var(--primary)' : 'transparent',
                                    color: index === 0 ? '#ffffff' : 'var(--sidebar-foreground)',
                                }}
                            >
                                <div className="mb-1 text-xs font-medium leading-snug">{title}</div>
                                <div className="font-mono text-[10px]" style={{ color: index === 0 ? 'rgba(255,255,255,0.72)' : color }}>
                                    {status}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center gap-1.5 border-t border-[var(--border)] px-3 py-2 font-mono text-[11px] text-[var(--muted-foreground)]">
                        feat/auth-refactor
                        <span className="ml-auto h-[7px] w-[7px] rounded-full bg-[#30d158]" />
                    </div>
                </aside>

                <main className="flex min-w-0 flex-1 flex-col">
                    <div className="border-b border-[var(--border)] bg-[var(--card)] px-5 py-3.5">
                        <div className="mb-1 text-sm font-semibold tracking-[-0.2px]">Refactor authentication module</div>
                        <div className="max-w-[560px] text-xs leading-normal text-[var(--muted-foreground)]">
                            Extracted JWT logic into dedicated service class, added refresh token support, and updated all call sites.
                        </div>
                    </div>
                    <div className="space-y-2 p-5">
                        {['Analyzing codebase structure...', 'Identifying auth module dependencies...', 'Generating refactored implementation...', 'Running tests...', 'All 42 tests passed'].map((step, index) => (
                            <div key={step} className="flex items-start gap-2.5">
                                <div
                                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px]"
                                    style={{
                                        border: `1.5px solid ${index === 4 ? '#30d158' : '#0a84ff'}`,
                                        color: index === 4 ? '#30d158' : '#0a84ff',
                                        background: index === 4 ? 'rgba(48,209,88,0.15)' : 'rgba(10,132,255,0.1)',
                                    }}
                                >
                                    ✓
                                </div>
                                <div className="font-mono text-xs leading-6">{step}</div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-auto flex items-center gap-2 border-t border-[var(--border)] bg-[var(--card)] p-2.5">
                        <div className="h-9 flex-1 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 text-xs leading-9 text-[var(--muted-foreground)]">
                            Ask HAPI anything...
                        </div>
                        <div className="h-9 w-9 rounded-lg bg-[var(--primary)]" />
                    </div>
                </main>

                <aside className="flex w-[480px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--card)]">
                    <div className="flex h-11 items-center border-b border-[var(--border)] px-3.5 font-mono text-xs text-[var(--muted-foreground)]">
                        src/auth/<span className="font-medium text-[var(--foreground)]">AuthService.ts</span>
                    </div>
                    <div className="min-h-0 flex-1 py-2">
                        {diffRows.map(([symbol, code, color, bg], index) => (
                            <div key={`${code}-${index}`} className="flex min-h-5 px-4" style={{ background: bg }}>
                                <span className="w-3.5 shrink-0 font-mono text-xs leading-5" style={{ color }}>{symbol}</span>
                                <span className="whitespace-pre font-mono text-xs leading-5" style={{ color }}>{code}</span>
                            </div>
                        ))}
                    </div>
                    <div className="border-t border-[var(--border)]">
                        <div className="h-8 bg-[var(--toolbar)] px-3 font-mono text-[11px] leading-8 text-[var(--foreground)]">Terminal</div>
                        <div className="h-[140px] bg-[var(--terminal-bg)] px-3.5 py-2 font-mono text-[11.5px] leading-relaxed text-[var(--terminal-fg)]">
                            <div><span className="font-semibold text-[#0a84ff]">$ </span>bun test</div>
                            <div className="text-[#30d158]">PASS src/auth/AuthService.test.ts</div>
                            <div className="text-[#30d158]">Tests: 42 passed, 42 total</div>
                        </div>
                    </div>
                </aside>
            </div>

            <div className="flex h-[22px] shrink-0 items-center gap-4 bg-[var(--primary)] px-3 font-mono text-[10.5px] text-white/90">
                <span className="opacity-80">HAPI Enterprise</span>
                <span>◉ TypeScript</span>
                <span>UTF-8</span>
                <span className="ml-auto">Connected</span>
                <span className="h-1.5 w-1.5 rounded-full bg-[#30d158]" />
            </div>
        </div>
    )
}

function FieldLabel(props: { htmlFor: string; children: string }) {
    return (
        <label htmlFor={props.htmlFor} className="mb-[5px] block text-[11px] font-semibold uppercase tracking-[0.5px] text-[var(--muted-foreground)]">
            {props.children}
        </label>
    )
}

export function LoginPrompt(props: LoginPromptProps) {
    const { t } = useTranslation()
    const { colorScheme } = useTheme()
    const { setAppearance } = useAppearance()
    const isBindMode = props.mode === 'bind'
    const isDark = colorScheme === 'dark' || colorScheme === 'oled'
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [accessToken, setAccessToken] = useState('')
    const [showSecret, setShowSecret] = useState(false)
    const [remember, setRemember] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [isServerDialogOpen, setIsServerDialogOpen] = useState(false)
    const [serverInput, setServerInput] = useState(props.serverUrl ?? '')
    const [serverError, setServerError] = useState<string | null>(null)

    const handleSubmit = useCallback(async (event: FormEvent) => {
        event.preventDefault()

        if (!isBindMode && props.requireServerUrl && !props.serverUrl) {
            setServerError(t('login.server.required'))
            setIsServerDialogOpen(true)
            return
        }

        setIsLoading(true)
        setError(null)

        try {
            if (isBindMode) {
                const trimmedToken = accessToken.trim()
                if (!trimmedToken) {
                    setError(t('login.error.enterToken'))
                    return
                }
                if (!props.onBind) {
                    setError(t('login.error.bindingUnavailable'))
                    return
                }
                await props.onBind(trimmedToken)
            } else {
                const trimmedUsername = username.trim()
                if (!trimmedUsername || !password) {
                    setError(t('login.error.enterCredentials'))
                    return
                }
                const client = new ApiClient('', { baseUrl: props.baseUrl })
                const auth = await client.authenticate({
                    username: trimmedUsername,
                    password
                })
                if (!props.onLogin) {
                    setError(t('login.error.loginUnavailable'))
                    return
                }
                props.onLogin(auth, remember)
            }
        } catch (e) {
            const fallbackMessage = isBindMode ? t('login.error.bindFailed') : t('login.error.authFailed')
            setError(e instanceof Error ? e.message : fallbackMessage)
        } finally {
            setIsLoading(false)
        }
    }, [accessToken, password, props, t, isBindMode, remember, username])

    useEffect(() => {
        if (isServerDialogOpen) {
            setServerInput(props.serverUrl ?? '')
        }
    }, [isServerDialogOpen, props.serverUrl])

    const handleSaveServer = useCallback((event: FormEvent) => {
        event.preventDefault()
        const result = props.setServerUrl(serverInput)
        if (!result.ok) {
            setServerError(result.error)
            return
        }
        setServerError(null)
        setServerInput(result.value)
        setIsServerDialogOpen(false)
    }, [props, serverInput])

    const handleClearServer = useCallback(() => {
        props.clearServerUrl()
        setServerInput('')
        setServerError(null)
        setIsServerDialogOpen(false)
    }, [props])

    const handleServerDialogOpenChange = useCallback((open: boolean) => {
        setIsServerDialogOpen(open)
        if (!open) {
            setServerError(null)
        }
    }, [])

    const displayError = error || props.error
    const title = isBindMode ? t('login.bind.title') : t('login.title')
    const subtitle = t('login.subtitle')
    const submitLabel = isBindMode ? t('login.bind.submit') : t('login.submit')
    const serverSummary = props.serverUrl ?? `${props.baseUrl} ${t('login.server.default')}`
    const secretValue = isBindMode ? accessToken : password
    const secretId = isBindMode ? 'login-access-token' : 'login-password'
    const handleSecretChange = (value: string) => {
        if (isBindMode) {
            setAccessToken(value)
        } else {
            setPassword(value)
        }
    }

    const cardStyle: CSSProperties = {
        width: 380,
        maxWidth: 'calc(100vw - 32px)',
        background: 'var(--card)',
        borderRadius: 16,
        boxShadow: isDark
            ? '0 32px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06)'
            : '0 32px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06)',
        overflow: 'hidden',
    }
    const inputClassName = 'h-[38px] w-full rounded-lg border border-[var(--border)] bg-[var(--muted)] text-[13px] text-[var(--foreground)] outline-none transition-[border,box-shadow] placeholder:text-[var(--muted-foreground)] placeholder:opacity-60 focus:border-[#0a84ff] focus:shadow-[0_0_0_3px_var(--ring)] disabled:opacity-50'

    return (
        <div className="relative h-full min-h-0 overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
            <MockAppShell />

            <div
                className="absolute inset-0 z-10 flex items-center justify-center px-4 py-16 backdrop-blur-[20px]"
                style={{ background: isDark ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.4)' }}
            >
                <div className="absolute right-5 top-5 flex items-center gap-2">
                    <LanguageSwitcher variant="login" />
                    <button
                        type="button"
                        onClick={() => setAppearance(isDark ? 'light' : 'dark')}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                        title={isDark ? t('login.theme.light') : t('login.theme.dark')}
                        aria-label={isDark ? t('login.theme.light') : t('login.theme.dark')}
                    >
                        {isDark ? <IconSun /> : <IconMoon />}
                    </button>
                </div>

                <div style={cardStyle}>
                    <div className="flex h-11 items-center gap-[7px] border-b border-[var(--border)] px-4" style={{ background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
                        <TrafficLights />
                        <span className="mr-9 flex-1 text-center text-xs font-medium text-[var(--muted-foreground)]">HAPI</span>
                    </div>

                    <div className="px-8 pb-7 pt-8">
                        <div className="mb-7 flex flex-col items-center">
                            <div
                                className="mb-3.5 flex h-[52px] w-[52px] items-center justify-center rounded-[14px] text-white shadow-[0_8px_24px_rgba(10,132,255,0.3)]"
                                style={{ background: 'linear-gradient(135deg, #0a84ff 0%, #5e5ce6 100%)' }}
                            >
                                <IconCode />
                            </div>
                            <div className="text-lg font-bold tracking-[-0.3px] text-[var(--foreground)]">{title}</div>
                            <div className="mt-1 text-xs text-[var(--muted-foreground)]">{subtitle}</div>
                        </div>

                        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                            {!isBindMode ? (
                                <div>
                                    <FieldLabel htmlFor="login-username">{t('login.username')}</FieldLabel>
                                    <div className="relative">
                                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]">
                                            <IconUser />
                                        </span>
                                        <input
                                            id="login-username"
                                            type="text"
                                            value={username}
                                            onChange={(event) => setUsername(event.target.value)}
                                            autoComplete="username"
                                            placeholder="admin"
                                            disabled={isLoading}
                                            className={`${inputClassName} pl-8 pr-3 font-mono`}
                                        />
                                    </div>
                                </div>
                            ) : null}

                            <div>
                                <FieldLabel htmlFor={secretId}>{isBindMode ? t('login.placeholder') : t('login.password')}</FieldLabel>
                                <div className="relative">
                                    <input
                                        id={secretId}
                                        type={showSecret ? 'text' : 'password'}
                                        value={secretValue}
                                        onChange={(event) => handleSecretChange(event.target.value)}
                                        autoComplete="current-password"
                                        placeholder={isBindMode ? t('login.placeholder') : '••••••••'}
                                        disabled={isLoading}
                                        className={`${inputClassName} pl-3 pr-10 font-mono`}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowSecret((value) => !value)}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                                        aria-label={showSecret ? t('login.hideSecret') : t('login.showSecret')}
                                    >
                                        <IconEye show={showSecret} />
                                    </button>
                                </div>
                            </div>

                            {!isBindMode ? (
                                <div className="flex items-center justify-between">
                                    <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                                        <input
                                            type="checkbox"
                                            checked={remember}
                                            onChange={(event) => setRemember(event.target.checked)}
                                            className="sr-only"
                                        />
                                        <span
                                            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border-[1.5px] text-[9px] transition-colors"
                                            style={{
                                                borderColor: 'var(--border)',
                                                background: remember ? 'var(--primary)' : 'var(--muted)',
                                                color: '#ffffff',
                                            }}
                                            aria-hidden="true"
                                        >
                                            {remember ? '✓' : null}
                                        </span>
                                        {t('login.rememberMe')}
                                    </label>

                                    <Dialog open={isServerDialogOpen} onOpenChange={handleServerDialogOpenChange}>
                                        <DialogTrigger asChild>
                                            <button type="button" className="p-0 text-xs text-[var(--primary)]">
                                                Hub {props.serverUrl ? t('login.server.custom') : t('login.server.default')}
                                            </button>
                                        </DialogTrigger>
                                        <DialogContent className="max-w-md">
                                            <DialogHeader>
                                                <DialogTitle>{t('login.server.title')}</DialogTitle>
                                                <DialogDescription>{t('login.server.description')}</DialogDescription>
                                            </DialogHeader>
                                            <form onSubmit={handleSaveServer} className="space-y-4">
                                                <div className="text-xs text-[var(--app-hint)]">
                                                    {t('login.server.current')} {serverSummary}
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-xs font-medium">{t('login.server.origin')}</label>
                                                    <input
                                                        type="url"
                                                        value={serverInput}
                                                        onChange={(event) => {
                                                            setServerInput(event.target.value)
                                                            setServerError(null)
                                                        }}
                                                        placeholder={t('login.server.placeholder')}
                                                        className={`${inputClassName} px-3`}
                                                    />
                                                    <div className="text-[11px] text-[var(--app-hint)]">{t('login.server.hint')}</div>
                                                </div>

                                                {serverError ? <div className="text-sm text-red-500">{serverError}</div> : null}

                                                <div className="flex items-center justify-end gap-2">
                                                    {props.serverUrl ? (
                                                        <Button type="button" variant="outline" onClick={handleClearServer}>
                                                            {t('login.server.useSameOrigin')}
                                                        </Button>
                                                    ) : null}
                                                    <Button type="submit">{t('login.server.save')}</Button>
                                                </div>
                                            </form>
                                        </DialogContent>
                                    </Dialog>
                                </div>
                            ) : null}

                            {displayError ? (
                                <div className="rounded-md border border-[rgba(255,69,58,0.2)] bg-[rgba(255,69,58,0.1)] px-2.5 py-1.5 text-xs text-[#ff453a]">
                                    {displayError}
                                </div>
                            ) : null}

                            <button
                                type="submit"
                                disabled={isLoading}
                                aria-busy={isLoading}
                                className="mt-1 flex h-10 items-center justify-center gap-2 rounded-lg border-0 text-[13px] font-semibold tracking-[0.2px] text-white shadow-[0_4px_14px_rgba(10,132,255,0.35)] transition-opacity disabled:cursor-not-allowed disabled:text-[var(--muted-foreground)] disabled:opacity-60 disabled:shadow-none"
                                style={{
                                    background: isLoading
                                        ? 'var(--muted)'
                                        : 'linear-gradient(135deg, #0a84ff 0%, #5e5ce6 100%)'
                                }}
                            >
                                {isLoading ? <Spinner size="sm" label={null} className="text-current" /> : null}
                                {isLoading ? (isBindMode ? t('login.bind.submitting') : t('login.submitting')) : submitLabel}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    )
}
