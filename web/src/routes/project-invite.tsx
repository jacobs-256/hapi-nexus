import { useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { queryKeys } from '@/lib/query-keys'
import { LoadingState } from '@/components/LoadingState'

export default function ProjectInvitePage(props: { token: string }) {
    const { t } = useTranslation()
    const { api } = useAppContext()
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    const acceptMutation = useMutation({
        mutationFn: async () => await api.acceptProjectInvite(props.token),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            void queryClient.invalidateQueries({ queryKey: queryKeys.machines })
        }
    })

    useEffect(() => {
        if (acceptMutation.isIdle) {
            acceptMutation.mutate()
        }
    }, [acceptMutation])

    return (
        <div className="flex h-full min-h-0 items-center justify-center bg-[var(--app-bg)] p-4">
            <div className="w-full max-w-sm space-y-3 text-center">
                {acceptMutation.isPending || acceptMutation.isIdle ? (
                    <LoadingState label={t('invite.accept.loading')} className="text-sm" />
                ) : acceptMutation.isSuccess ? (
                    <>
                        <div className="text-base font-semibold text-[var(--app-fg)]">{t('invite.accept.success.title')}</div>
                        <div className="text-sm text-[var(--app-hint)]">{t('invite.accept.success.body')}</div>
                        <button
                            type="button"
                            onClick={() => navigate({ to: '/settings/projects', replace: true })}
                            className="rounded-md bg-[var(--app-link)] px-3 py-2 text-sm font-medium text-white"
                        >
                            {t('invite.accept.openProjects')}
                        </button>
                    </>
                ) : (
                    <>
                        <div className="text-base font-semibold text-[var(--app-fg)]">{t('invite.accept.failed.title')}</div>
                        <div className="text-sm text-red-600">
                            {acceptMutation.error instanceof Error ? acceptMutation.error.message : t('invite.accept.failed.body')}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
