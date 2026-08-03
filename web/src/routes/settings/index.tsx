import { useTranslation } from '@/lib/use-translation'
import { SettingsNav } from '@/components/settings/SettingsNav'
import { SettingsPageContent } from '@/components/settings/SettingsPrimitives'
import SettingsDisplayPage from './display'

export default function SettingsHubPage() {
    const { t } = useTranslation()
    return (
        <>
            <div className="lg:hidden">
                <SettingsPageContent title={t('settings.title')} description={t('settings.hub.description')}>
                    <SettingsNav mobile />
                </SettingsPageContent>
            </div>
            <div className="hidden lg:block">
                <SettingsDisplayPage />
            </div>
        </>
    )
}
