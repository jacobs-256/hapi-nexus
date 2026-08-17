import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CodexImportJob } from '@/types/api'
import { SettingsPageContent, SettingsSection } from '@/components/settings/SettingsPrimitives'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'

function isActiveTask(job: CodexImportJob): boolean {
    return job.status === 'queued' || job.status === 'running'
}

function formatTime(value?: number): string {
    if (!value) return '—'
    return new Date(value).toLocaleString()
}

function statusClass(status: string): string {
    if (status === 'succeeded') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    if (status === 'failed') return 'bg-red-500/10 text-red-700 dark:text-red-300'
    if (status === 'canceled') return 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300'
    if (status === 'running') return 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
    return 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
}

function TaskStatusBadge(props: { status: string }) {
    return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(props.status)}`}>{props.status}</span>
}

function TaskSummary(props: { job: CodexImportJob; selected: boolean; onClick: () => void }) {
    const job = props.job
    return (
        <button
            type="button"
            onClick={props.onClick}
            className={`grid w-full gap-2 px-4 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)] ${props.selected ? 'bg-[var(--app-subtle-bg)]' : ''}`}
        >
            <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0 truncate text-sm font-semibold text-[var(--app-fg)]">Codex sync task</div>
                <TaskStatusBadge status={job.status} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--app-hint)]">
                <span>{formatTime(job.createdAt)}</span>
                <span>{job.completedItems}/{job.totalItems} items</span>
                <span>{job.importedMessages}/{job.totalMessages} messages</span>
                {job.failedItems > 0 ? <span className="text-red-600">{job.failedItems} failed</span> : null}
                {job.skippedItems > 0 ? <span>{job.skippedItems} skipped</span> : null}
            </div>
            <div className="truncate text-xs text-[var(--app-hint)]">{job.cwd || job.machineId || job.id}</div>
        </button>
    )
}

function TaskDetail(props: { job: CodexImportJob; onCancel: () => void; canceling: boolean; onDelete: () => void; deleting: boolean }) {
    const job = props.job
    return (
        <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <div className="text-sm font-semibold text-[var(--app-fg)]">Codex sync task</div>
                    <div className="mt-1 break-all text-xs text-[var(--app-hint)]">{job.id}</div>
                </div>
                <div className="flex items-center gap-2">
                    <TaskStatusBadge status={job.status} />
                    {isActiveTask(job) ? (
                        <button
                            type="button"
                            onClick={props.onCancel}
                            disabled={props.canceling}
                            className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50"
                        >
                            {props.canceling ? 'Canceling…' : 'Cancel task'}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={props.onDelete}
                            disabled={props.deleting}
                            className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50"
                        >
                            {props.deleting ? 'Deleting…' : 'Delete task'}
                        </button>
                    )}
                </div>
            </div>

            <div className="grid gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-3 text-xs text-[var(--app-hint)] sm:grid-cols-2">
                <div>Created: {formatTime(job.createdAt)}</div>
                <div>Started: {formatTime(job.startedAt)}</div>
                <div>Finished: {formatTime(job.finishedAt)}</div>
                <div>Machine: {job.machineId || '—'}</div>
                <div className="sm:col-span-2">Directory: {job.cwd || '—'}</div>
                {job.error ? <div className="text-red-600 sm:col-span-2">Error: {job.error}</div> : null}
            </div>

            <div>
                <div className="mb-2 text-sm font-semibold text-[var(--app-fg)]">Items</div>
                <div className="overflow-hidden rounded-lg border border-[var(--app-border)]">
                    {job.items.map((item) => (
                        <div key={item.codexSessionId} className="grid gap-1 border-b border-[var(--app-divider)] px-3 py-2 text-xs last:border-b-0">
                            <div className="flex min-w-0 items-center justify-between gap-2">
                                <span className="min-w-0 truncate font-medium text-[var(--app-fg)]">{item.title || item.codexSessionId}</span>
                                <TaskStatusBadge status={item.status} />
                            </div>
                            <div className="text-[var(--app-hint)]">{item.importedMessages}/{item.messagesToImport} imported · {item.appendedMessages} appended</div>
                            {item.error ? <div className="text-red-600">{item.error}</div> : null}
                        </div>
                    ))}
                </div>
            </div>

            <div>
                <div className="mb-2 text-sm font-semibold text-[var(--app-fg)]">Logs</div>
                <div className="max-h-96 overflow-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-3 font-mono text-xs">
                    {job.logs.length === 0 ? <div className="text-[var(--app-hint)]">No logs</div> : job.logs.map((log, index) => (
                        <div key={`${log.at}-${index}`} className={log.level === 'error' ? 'text-red-600' : 'text-[var(--app-fg)]'}>
                            <span className="text-[var(--app-hint)]">[{formatTime(log.at)}]</span> {log.level.toUpperCase()} {log.codexSessionId ? `${log.codexSessionId}: ` : ''}{log.message}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default function SettingsTasksPage() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
    const queryKey = useMemo(() => ['codex-import-jobs', 'settings', 'all'], [])
    const jobsQuery = useQuery({
        queryKey,
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            const result = await api.getCodexImportJobs({ all: true })
            if (!result.success) throw new Error(result.error)
            return result.jobs
        },
        enabled: Boolean(api),
        refetchInterval: (query) => query.state.data?.some(isActiveTask) ? 1500 : false
    })
    const jobs = jobsQuery.data ?? []
    const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null

    useEffect(() => {
        if (!selectedJobId && jobs[0]) setSelectedJobId(jobs[0].id)
    }, [jobs, selectedJobId])

    const cancelMutation = useMutation({
        mutationFn: async (jobId: string) => {
            if (!api) throw new Error('API unavailable')
            const result = await api.cancelCodexImportJob(jobId, { all: true })
            if (!result.success) throw new Error(result.error)
            return result.job
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey })
        }
    })
    const deleteMutation = useMutation({
        mutationFn: async (jobId: string) => {
            if (!api) throw new Error('API unavailable')
            const result = await api.deleteCodexImportJob(jobId, { all: true })
            if (!result.success) throw new Error(result.error)
        },
        onSuccess: (_data, jobId) => {
            setSelectedJobId((current) => current === jobId ? null : current)
            void queryClient.invalidateQueries({ queryKey })
        }
    })

    return (
        <SettingsPageContent
            title={t('settings.tasks.title')}
            description={t('settings.tasks.description')}
            actions={<button type="button" onClick={() => void jobsQuery.refetch()} className="rounded-md border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]">Refresh</button>}
        >
            <SettingsSection>
                <div className="grid min-h-[28rem] lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
                    <div className="border-b border-[var(--app-divider)] lg:border-b-0 lg:border-r">
                        {jobsQuery.error ? <div className="p-4 text-sm text-red-600">{jobsQuery.error instanceof Error ? jobsQuery.error.message : 'Failed to load tasks'}</div> : null}
                        {jobs.length === 0 && !jobsQuery.isLoading ? <div className="p-4 text-sm text-[var(--app-hint)]">No sync tasks</div> : null}
                        {jobs.map((job) => <TaskSummary key={job.id} job={job} selected={selectedJob?.id === job.id} onClick={() => setSelectedJobId(job.id)} />)}
                    </div>
                    <div className="min-w-0">
                        {selectedJob ? (
                            <TaskDetail
                                job={selectedJob}
                                onCancel={() => cancelMutation.mutate(selectedJob.id)}
                                canceling={cancelMutation.isPending}
                                onDelete={() => deleteMutation.mutate(selectedJob.id)}
                                deleting={deleteMutation.isPending}
                            />
                        ) : <div className="p-4 text-sm text-[var(--app-hint)]">Select a task</div>}
                    </div>
                </div>
            </SettingsSection>
        </SettingsPageContent>
    )
}
