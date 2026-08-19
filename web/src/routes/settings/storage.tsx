import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CoreStorageBackend, StorageConfig, StorageMigrationMode } from '@hapi/protocol/storage'
import { SettingsChoiceGroup, SettingsPageContent, SettingsRow, SettingsSection } from '@/components/settings/SettingsPrimitives'
import { useAppContext } from '@/lib/app-context'
import { formatFileSize } from '@/lib/file-metadata'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'

function backendLabel(value: string): string {
    switch (value) {
        case 'sqlite': return 'SQLite'
        case 'elasticsearch': return 'Elasticsearch'
        case 'mysql': return 'MySQL'
        default: return value
    }
}

type TFunction = (key: string, params?: Record<string, string | number>) => string

function formatStorageMessage(message: string, t: TFunction): string {
    const exported = /^Exported (\d+) row\(s\) to configured external storage\.$/.exec(message)
    if (exported) {
        return t('settings.storage.migration.exportedRows', { count: exported[1] })
    }
    switch (message) {
        case 'Copied SQLite tables into configured storage files.':
            return t('settings.storage.migration.copiedSqlite')
        case 'Storage paths unchanged; no migration needed.':
            return t('settings.storage.migration.pathsUnchanged')
        case 'Source migration currently supports SQLite only.':
            return t('settings.storage.migration.sourceSqliteOnly')
        case 'Target migration currently supports SQLite only. Save config, then run external MySQL/Elasticsearch migration tooling.':
            return t('settings.storage.migration.targetSqliteOnly')
        default:
            return message
    }
}

function cloneConfig(config: StorageConfig): StorageConfig {
    return JSON.parse(JSON.stringify(config)) as StorageConfig
}

function emptyConfig(): StorageConfig {
    return {
        conversation: { backend: 'sqlite', sqlite: { path: '' } },
        core: { backend: 'sqlite', sqlite: { path: '' } }
    }
}

function TextInput(props: {
    label: string
    value: string
    onChange: (value: string) => void
    placeholder?: string
    type?: string
}) {
    return (
        <label className="grid min-h-14 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] sm:items-center sm:gap-6">
            <span className="text-sm font-semibold text-[var(--app-fg)]">{props.label}</span>
            <input
                type={props.type ?? 'text'}
                value={props.value}
                placeholder={props.placeholder}
                onChange={(event) => props.onChange(event.target.value)}
                className="min-w-0 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-[var(--app-link)]"
            />
        </label>
    )
}

function UsageRows(props: { title: string; usage?: { path: string; totalBytes: number; databaseBytes: number; walBytes: number; shmBytes: number; schemaVersion: number; expectedSchemaVersion: number } }) {
    const { t } = useTranslation()
    const usage = props.usage
    if (!usage) return null
    return (
        <>
            <SettingsRow label={props.title} trailing={<span className="font-medium text-[var(--app-fg)]">{formatFileSize(usage.totalBytes)}</span>} />
            <SettingsRow label={t('settings.storage.database')} trailing={<span className="text-[var(--app-hint)]">{formatFileSize(usage.databaseBytes)}</span>} />
            <SettingsRow label={t('settings.storage.walShm')} trailing={<span className="text-[var(--app-hint)]">{formatFileSize(usage.walBytes)} / {formatFileSize(usage.shmBytes)}</span>} />
            <SettingsRow label={t('settings.storage.schema')} trailing={<span className="text-[var(--app-hint)]">{usage.schemaVersion} / {usage.expectedSchemaVersion}</span>} />
            <SettingsRow label={t('settings.storage.path')} trailing={<code className="block max-w-[min(28rem,55vw)] truncate text-xs text-[var(--app-hint)]" title={usage.path}>{usage.path}</code>} />
        </>
    )
}

function formatTime(value: number | null | undefined): string {
    return value ? new Date(value).toLocaleString() : '—'
}

function ExternalSyncRows(props: {
    title: string
    status?: {
        running: boolean
        lastStartedAt: number | null
        lastSucceededAt: number | null
        lastFailedAt: number | null
        lastError: string | null
        lastCopiedRows: number | null
    }
}) {
    const { t } = useTranslation()
    if (!props.status) return null
    return (
        <>
            <SettingsRow
                label={props.title}
                trailing={<span className={props.status.lastError ? 'text-red-600' : 'text-[var(--app-hint)]'}>{props.status.running ? t('settings.storage.externalSync.running') : (props.status.lastError ? t('settings.storage.externalSync.failed') : t('settings.storage.externalSync.idle'))}</span>}
            />
            <SettingsRow label={t('settings.storage.externalSync.lastSuccess')} trailing={<span className="text-[var(--app-hint)]">{formatTime(props.status.lastSucceededAt)}</span>} />
            <SettingsRow label={t('settings.storage.externalSync.lastRows')} trailing={<span className="text-[var(--app-hint)]">{props.status.lastCopiedRows ?? '—'}</span>} />
            {props.status.lastError ? <SettingsRow label={t('settings.storage.externalSync.lastError')} description={props.status.lastError} trailing={<span className="text-[var(--app-hint)]">{formatTime(props.status.lastFailedAt)}</span>} /> : null}
        </>
    )
}

export default function SettingsStoragePage() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const query = useQuery({
        queryKey: queryKeys.storageSettings,
        queryFn: async () => {
            if (!api) throw new Error(t('settings.storage.apiUnavailable'))
            return await api.getStorageSettings()
        },
        enabled: Boolean(api),
        staleTime: 0,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchInterval: (query) => query.state.data?.migration?.status === 'running' ? 3000 : false,
    })
    const [draft, setDraft] = useState<StorageConfig>(() => emptyConfig())
    const [migrationMode, setMigrationMode] = useState<StorageMigrationMode>('none')
    const [savedMessage, setSavedMessage] = useState<string | null>(null)

    useEffect(() => {
        if (query.data?.config) {
            setDraft(cloneConfig(query.data.config))
        }
    }, [query.data?.config])

    const updateMutation = useMutation({
        mutationFn: async (options?: { restart?: boolean }) => {
            if (!api) throw new Error(t('settings.storage.apiUnavailable'))
            return await api.updateStorageSettings({ config: draft, migrate: migrationMode, restart: options?.restart })
        },
        onSuccess: (response) => {
            setSavedMessage(response.restarting ? t('settings.storage.restarting') : (response.migrationStarted ? t('settings.storage.migration.started') : (response.migrationMessage ? formatStorageMessage(response.migrationMessage, t) : (response.restartRequired ? t('settings.storage.savedRestart') : t('settings.storage.saved')))))
            if (response.migrationStarted && response.migration) {
                window.dispatchEvent(new CustomEvent('hapi-storage-migration-started', { detail: response.migration }))
            }
            void queryClient.invalidateQueries({ queryKey: queryKeys.storageSettings })
        }
    })

    const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(query.data?.config ?? null), [draft, query.data?.config])

    function setConversationBackend(backend: 'sqlite' | 'elasticsearch') {
        setDraft((current) => ({
            ...current,
            conversation: backend === 'sqlite'
                ? { backend, sqlite: { path: current.conversation.backend === 'sqlite' ? current.conversation.sqlite.path : '' } }
                : { backend, elasticsearch: current.conversation.backend === 'elasticsearch' ? current.conversation.elasticsearch : { url: '', index: 'hapi-conversations' } }
        }))
    }

    function setCoreBackend(backend: CoreStorageBackend) {
        setDraft((current) => ({
            ...current,
            core: backend === 'sqlite'
                ? { backend, sqlite: { path: current.core.backend === 'sqlite' ? current.core.sqlite.path : '' } }
                : { backend, mysql: current.core.backend === 'mysql' ? current.core.mysql : { host: '127.0.0.1', port: 3306, database: 'hapi' } }
        }))
    }

    return (
        <SettingsPageContent title={t('settings.storage.title')} description={t('settings.storage.description')}>
            <SettingsSection title={t('settings.storage.active.title')} description={t('settings.storage.active.description')}>
                {query.isLoading ? <SettingsRow label={t('settings.storage.loading')} /> : null}
                {query.error ? <SettingsRow label={t('settings.storage.error')} description={query.error instanceof Error ? query.error.message : undefined} /> : null}
                {query.data ? (
                    <>
                        <SettingsRow label={t('settings.storage.conversation.backend')} trailing={<span className="text-[var(--app-hint)]">{backendLabel(query.data.activeConfig.conversation.backend)}</span>} />
                        <SettingsRow label={t('settings.storage.core.backend')} trailing={<span className="text-[var(--app-hint)]">{backendLabel(query.data.activeConfig.core.backend)}</span>} />
                        {query.data.restartRequired ? <SettingsRow label={t('settings.storage.restartRequired')} description={t('settings.storage.restartRequired.description')} /> : null}
                    </>
                ) : null}
            </SettingsSection>


            {query.data?.sqlite ? (
                <SettingsSection title={t('settings.storage.sqliteUsage.title')}>
                    <UsageRows title={t('settings.storage.sqliteUsage.coreTotal')} usage={query.data.sqlite.core} />
                    <UsageRows title={t('settings.storage.sqliteUsage.conversationTotal')} usage={query.data.sqlite.conversation} />
                </SettingsSection>
            ) : null}

            {query.data?.externalSync && Object.keys(query.data.externalSync).length > 0 ? (
                <SettingsSection title={t('settings.storage.externalSync.title')} description={t('settings.storage.externalSync.description')}>
                    <ExternalSyncRows title={t('settings.storage.externalSync.core')} status={query.data.externalSync.core} />
                    <ExternalSyncRows title={t('settings.storage.externalSync.conversation')} status={query.data.externalSync.conversation} />
                </SettingsSection>
            ) : null}

            <form
                className="space-y-6"
                onSubmit={(event: FormEvent) => {
                    event.preventDefault()
                    updateMutation.mutate({ restart: false })
                }}
            >
                <SettingsSection title={t('settings.storage.conversation.title')} description={t('settings.storage.conversation.description')}>
                    <SettingsChoiceGroup
                        label={t('settings.storage.conversation.backend')}
                        value={draft.conversation.backend}
                        options={[
                            { value: 'sqlite', label: 'SQLite' },
                            { value: 'elasticsearch', label: 'Elasticsearch' }
                        ]}
                        onChange={setConversationBackend}
                    />
                    {draft.conversation.backend === 'sqlite' ? (
                        <TextInput label={t('settings.storage.field.sqlitePath')} value={draft.conversation.sqlite.path} onChange={(path) => setDraft((current) => ({ ...current, conversation: { backend: 'sqlite', sqlite: { path } } }))} />
                    ) : (
                        <>
                            <TextInput label={t('settings.storage.field.esUrl')} value={draft.conversation.elasticsearch.url} placeholder="http://localhost:9200" onChange={(url) => setDraft((current) => current.conversation.backend === 'elasticsearch' ? ({ ...current, conversation: { backend: 'elasticsearch', elasticsearch: { ...current.conversation.elasticsearch, url } } }) : current)} />
                            <TextInput label={t('settings.storage.field.esIndex')} value={draft.conversation.elasticsearch.index} onChange={(index) => setDraft((current) => current.conversation.backend === 'elasticsearch' ? ({ ...current, conversation: { backend: 'elasticsearch', elasticsearch: { ...current.conversation.elasticsearch, index } } }) : current)} />
                            <TextInput label={t('settings.storage.field.username')} value={draft.conversation.elasticsearch.username ?? ''} onChange={(username) => setDraft((current) => current.conversation.backend === 'elasticsearch' ? ({ ...current, conversation: { backend: 'elasticsearch', elasticsearch: { ...current.conversation.elasticsearch, username: username || undefined } } }) : current)} />
                            <TextInput label={t('settings.storage.field.password')} type="password" value={draft.conversation.elasticsearch.password ?? ''} onChange={(password) => setDraft((current) => current.conversation.backend === 'elasticsearch' ? ({ ...current, conversation: { backend: 'elasticsearch', elasticsearch: { ...current.conversation.elasticsearch, password: password || undefined } } }) : current)} />
                            <TextInput label={t('settings.storage.field.apiKey')} type="password" value={draft.conversation.elasticsearch.apiKey ?? ''} placeholder="base64(id:api_key)" onChange={(apiKey) => setDraft((current) => current.conversation.backend === 'elasticsearch' ? ({ ...current, conversation: { backend: 'elasticsearch', elasticsearch: { ...current.conversation.elasticsearch, apiKey: apiKey || undefined } } }) : current)} />
                        </>
                    )}
                </SettingsSection>

                <SettingsSection title={t('settings.storage.core.title')} description={t('settings.storage.core.description')}>
                    <SettingsChoiceGroup
                        label={t('settings.storage.core.backend')}
                        value={draft.core.backend}
                        options={[
                            { value: 'sqlite', label: 'SQLite' },
                            { value: 'mysql', label: 'MySQL' }
                        ]}
                        onChange={setCoreBackend}
                    />
                    {draft.core.backend === 'sqlite' ? (
                        <TextInput label={t('settings.storage.field.sqlitePath')} value={draft.core.sqlite.path} onChange={(path) => setDraft((current) => ({ ...current, core: { backend: 'sqlite', sqlite: { path } } }))} />
                    ) : (
                        <>
                            <TextInput label={t('settings.storage.field.mysqlUrl')} value={draft.core.mysql.url ?? ''} placeholder="mysql://user:pass@host:3306/hapi" onChange={(url) => setDraft((current) => current.core.backend === 'mysql' ? ({ ...current, core: { backend: 'mysql', mysql: { ...current.core.mysql, url: url || undefined } } }) : current)} />
                            <TextInput label={t('settings.storage.field.host')} value={draft.core.mysql.host ?? ''} onChange={(host) => setDraft((current) => current.core.backend === 'mysql' ? ({ ...current, core: { backend: 'mysql', mysql: { ...current.core.mysql, host: host || undefined } } }) : current)} />
                            <TextInput label={t('settings.storage.field.port')} value={draft.core.mysql.port ? String(draft.core.mysql.port) : ''} onChange={(port) => setDraft((current) => current.core.backend === 'mysql' ? ({ ...current, core: { backend: 'mysql', mysql: { ...current.core.mysql, port: port ? Number(port) : undefined } } }) : current)} />
                            <TextInput label={t('settings.storage.field.database')} value={draft.core.mysql.database ?? ''} onChange={(database) => setDraft((current) => current.core.backend === 'mysql' ? ({ ...current, core: { backend: 'mysql', mysql: { ...current.core.mysql, database: database || undefined } } }) : current)} />
                            <TextInput label={t('settings.storage.field.user')} value={draft.core.mysql.user ?? ''} onChange={(user) => setDraft((current) => current.core.backend === 'mysql' ? ({ ...current, core: { backend: 'mysql', mysql: { ...current.core.mysql, user: user || undefined } } }) : current)} />
                            <TextInput label={t('settings.storage.field.password')} type="password" value={draft.core.mysql.password ?? ''} onChange={(password) => setDraft((current) => current.core.backend === 'mysql' ? ({ ...current, core: { backend: 'mysql', mysql: { ...current.core.mysql, password: password || undefined } } }) : current)} />
                        </>
                    )}
                </SettingsSection>

                <SettingsSection title={t('settings.storage.migration.title')}>
                    <SettingsChoiceGroup
                        label={t('settings.storage.migration.whenSaving')}
                        value={migrationMode}
                        options={[
                            { value: 'none', label: t('settings.storage.migration.none'), description: t('settings.storage.migration.none.description') },
                            { value: 'copy', label: t('settings.storage.migration.copy'), description: t('settings.storage.migration.copy.description') }
                        ]}
                        onChange={setMigrationMode}
                    />
                </SettingsSection>

                {updateMutation.error ? <div className="text-sm text-red-600">{updateMutation.error instanceof Error ? updateMutation.error.message : t('settings.storage.saveError')}</div> : null}
                {savedMessage ? <div className="text-sm text-emerald-600">{savedMessage}</div> : null}
                <div className="flex gap-2">
                    <button type="submit" disabled={updateMutation.isPending || (!dirty && migrationMode === 'none')} className="rounded-lg bg-[var(--app-link)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                        {updateMutation.isPending ? t('settings.storage.saving') : t('settings.storage.save')}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            if (window.confirm(t('settings.storage.restartConfirm'))) {
                                updateMutation.mutate({ restart: true })
                            }
                        }}
                        disabled={updateMutation.isPending || (!dirty && migrationMode === 'none')}
                        className="rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm font-medium text-[var(--app-fg)] disabled:opacity-50"
                    >
                        {updateMutation.isPending ? t('settings.storage.saving') : t('settings.storage.saveRestart')}
                    </button>
                    <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} className="rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm font-medium text-[var(--app-fg)] disabled:opacity-50">
                        {query.isFetching ? t('settings.storage.refreshing') : t('settings.storage.refresh')}
                    </button>
                </div>
            </form>
        </SettingsPageContent>
    )
}
