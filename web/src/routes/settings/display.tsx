import { useEffect, useState } from 'react'
import { useTranslation } from '@/lib/use-translation'
import { getAppearanceOptions, useAppearance } from '@/hooks/useTheme'
import { getFontScaleOptions, useFontScale } from '@/hooks/useFontScale'
import { getTerminalFontSizeOptions, useTerminalFontSize } from '@/hooks/useTerminalFontSize'
import { getSessionListStatusModeOptions, useSessionListStatusMode } from '@/hooks/useSessionListStatusMode'
import { useShowActiveSessionsOnly } from '@/hooks/useShowActiveSessionsOnly'
import { MAX_SESSION_PREVIEW_LIMIT, MIN_SESSION_PREVIEW_LIMIT, normalizeSessionPreviewLimit, useSessionPreviewLimit } from '@/hooks/useSessionPreviewLimit'
import { SettingsChoiceGroup, SettingsPageContent, SettingsRow, SettingsSection, SettingsSwitch } from '@/components/settings/SettingsPrimitives'

function MinusIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true"><path d="M5 12h14" /></svg>
}

function PlusIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
}

function SessionPreviewLimitControl() {
    const { t } = useTranslation()
    const { sessionPreviewLimit, setSessionPreviewLimit } = useSessionPreviewLimit()
    const [draft, setDraft] = useState(String(sessionPreviewLimit))

    useEffect(() => setDraft(String(sessionPreviewLimit)), [sessionPreviewLimit])

    const commit = () => {
        const parsed = draft.trim() === '' ? sessionPreviewLimit : Number(draft)
        const next = normalizeSessionPreviewLimit(parsed)
        setSessionPreviewLimit(next)
        setDraft(String(next))
    }
    const step = (delta: number) => setSessionPreviewLimit(normalizeSessionPreviewLimit(sessionPreviewLimit + delta))

    return (
        <SettingsRow label={t('settings.display.sessionPreviewLimit')} trailing={
            <div className="flex h-9 items-center rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)]">
                <button type="button" onClick={() => step(-1)} disabled={sessionPreviewLimit <= MIN_SESSION_PREVIEW_LIMIT} aria-label={t('settings.display.sessionPreviewLimit.decrease')} className="flex h-8 w-8 items-center justify-center disabled:opacity-40"><MinusIcon /></button>
                <input
                    aria-label={t('settings.display.sessionPreviewLimit')}
                    type="number"
                    inputMode="numeric"
                    min={MIN_SESSION_PREVIEW_LIMIT}
                    max={MAX_SESSION_PREVIEW_LIMIT}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={commit}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') { commit(); event.currentTarget.blur() }
                        if (event.key === 'Escape') { setDraft(String(sessionPreviewLimit)); event.currentTarget.blur() }
                    }}
                    className="h-8 w-14 border-x border-[var(--app-border)] bg-transparent text-center text-sm text-[var(--app-fg)] outline-none"
                />
                <button type="button" onClick={() => step(1)} disabled={sessionPreviewLimit >= MAX_SESSION_PREVIEW_LIMIT} aria-label={t('settings.display.sessionPreviewLimit.increase')} className="flex h-8 w-8 items-center justify-center disabled:opacity-40"><PlusIcon /></button>
            </div>
        } />
    )
}

export default function SettingsDisplayPage() {
    const { t } = useTranslation()
    const { appearance, setAppearance } = useAppearance()
    const { fontScale, setFontScale } = useFontScale()
    const { terminalFontSize, setTerminalFontSize } = useTerminalFontSize()
    const { sessionListStatusMode, setSessionListStatusMode } = useSessionListStatusMode()
    const { showActiveSessionsOnly, setShowActiveSessionsOnly } = useShowActiveSessionsOnly()

    return (
        <SettingsPageContent title={t('settings.display.title')} description={t('settings.display.description')}>
            <SettingsSection title={t('settings.display.appearance')}>
                <SettingsChoiceGroup
                    label={t('settings.display.appearanceMode')}
                    value={appearance}
                    columns={3}
                    options={getAppearanceOptions().map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                    onChange={setAppearance}
                />
            </SettingsSection>

            <SettingsSection title={t('settings.display.typography')}>
                <SettingsChoiceGroup label={t('settings.display.fontSize')} value={fontScale} columns={5} options={getFontScaleOptions()} onChange={setFontScale} />
                <SettingsChoiceGroup label={t('settings.display.terminalFontSize')} value={terminalFontSize} columns={5} options={getTerminalFontSizeOptions()} onChange={setTerminalFontSize} />
            </SettingsSection>

            <SettingsSection title={t('settings.display.sessions')}>
                <SessionPreviewLimitControl />
                <SettingsSwitch label={t('settings.display.activeSessionsOnly')} description={t('settings.display.activeSessionsOnly.desc')} checked={showActiveSessionsOnly} onChange={setShowActiveSessionsOnly} />
                <SettingsChoiceGroup
                    label={t('settings.display.sessionListStatus')}
                    description={t('settings.display.sessionListStatus.detailedDescription')}
                    value={sessionListStatusMode}
                    options={getSessionListStatusModeOptions().map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                    onChange={setSessionListStatusMode}
                />
            </SettingsSection>
        </SettingsPageContent>
    )
}
