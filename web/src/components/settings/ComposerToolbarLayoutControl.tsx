import { useState, type DragEvent } from 'react'
import { ComposerSendButtonPreview, ComposerToolbarItemPreview } from '@/components/AssistantChat/ComposerButtons'
import {
    COMPOSER_TOOLBAR_ITEM_IDS,
    isComposerToolbarItemEnabled,
    mergeComposerToolbarDisabledItems,
    moveComposerToolbarItem,
    moveComposerToolbarItemInSingleLayout,
    setComposerToolbarItemDisabled,
    useComposerToolbarLayout,
    type ComposerToolbarGroup,
    type ComposerToolbarItemId,
    type ComposerToolbarLayoutMode,
} from '@/hooks/useComposerToolbarLayout'
import {
    dispatchGlobalComposerToolbarSettingsChange,
    useGlobalComposerToolbarSettings
} from '@/hooks/useGlobalComposerToolbarSettings'
import { useAppContext } from '@/lib/app-context'
import { getNamespace } from '@/routes/settings/categories'
import { useTranslation } from '@/lib/use-translation'
import { SettingsChoiceGroup } from './SettingsPrimitives'

const ITEM_LABEL_KEYS: Record<ComposerToolbarItemId, string> = {
    attachment: 'settings.chat.composerToolbar.item.attachment',
    settings: 'settings.chat.composerToolbar.item.settings',
    piModel: 'settings.chat.composerToolbar.item.piModel',
    piThinking: 'settings.chat.composerToolbar.item.piThinking',
    terminal: 'settings.chat.composerToolbar.item.terminal',
    abort: 'settings.chat.composerToolbar.item.abort',
    switch: 'settings.chat.composerToolbar.item.switch',
    voiceMic: 'settings.chat.composerToolbar.item.voiceMic',
    scratchlist: 'settings.chat.composerToolbar.item.scratchlist',
    schedule: 'settings.chat.composerToolbar.item.schedule',
}

export function ComposerToolbarLayoutControl() {
    const { t } = useTranslation()
    const { api, token, user } = useAppContext()
    const { layout, setLayout, resetLayout } = useComposerToolbarLayout()
    const { settings: globalSettings, isLoading: globalSettingsLoading } = useGlobalComposerToolbarSettings(api)
    const [draggedItem, setDraggedItem] = useState<ComposerToolbarItemId | null>(null)
    const [selectedItem, setSelectedItem] = useState<ComposerToolbarItemId | null>(null)
    const [globalSavingItem, setGlobalSavingItem] = useState<ComposerToolbarItemId | null>(null)
    const [globalError, setGlobalError] = useState<string | null>(null)
    const effectiveLayout = mergeComposerToolbarDisabledItems(layout, globalSettings.disabled)
    const canManageGlobal = getNamespace(token) === 'default' && user?.role === 'admin'

    const setMode = (mode: ComposerToolbarLayoutMode) => {
        setLayout({ ...layout, mode })
    }

    const moveDraggedItem = (group: ComposerToolbarGroup, index: number) => {
        if (draggedItem) {
            const next = layout.mode === 'split'
                ? moveComposerToolbarItem(layout, draggedItem, group, index)
                : moveComposerToolbarItemInSingleLayout(layout, draggedItem, index)
            const unchanged = next.left.join() === layout.left.join() && next.right.join() === layout.right.join()
            if (!unchanged) {
                setLayout(next)
            }
        }
    }

    const onDrop = (event: DragEvent, group: ComposerToolbarGroup, index: number) => {
        event.preventDefault()
        const item = draggedItem ?? event.dataTransfer.getData('text/plain')
        if ((COMPOSER_TOOLBAR_ITEM_IDS as readonly string[]).includes(item)) {
            const next = layout.mode === 'split'
                ? moveComposerToolbarItem(layout, item as ComposerToolbarItemId, group, index)
                : moveComposerToolbarItemInSingleLayout(layout, item as ComposerToolbarItemId, index)
            setLayout(next)
        }
        setDraggedItem(null)
    }

    const moveItemByOffset = (item: ComposerToolbarItemId, group: ComposerToolbarGroup, index: number, offset: -1 | 1) => {
        const targetIndex = Math.max(0, index + offset)
        const next = layout.mode === 'split'
            ? moveComposerToolbarItem(layout, item, group, targetIndex)
            : moveComposerToolbarItemInSingleLayout(layout, item, targetIndex)
        setLayout(next)
    }

    const setGlobalDisabled = async (item: ComposerToolbarItemId, disabled: boolean) => {
        if (!canManageGlobal) return
        const disabledSet = new Set(globalSettings.disabled)
        if (disabled) {
            disabledSet.add(item)
        } else {
            disabledSet.delete(item)
        }
        const nextDisabled = COMPOSER_TOOLBAR_ITEM_IDS.filter((entry) => disabledSet.has(entry))
        setGlobalSavingItem(item)
        setGlobalError(null)
        try {
            const response = await api.updateGlobalComposerToolbarSettings({ disabled: nextDisabled })
            dispatchGlobalComposerToolbarSettingsChange(response.settings)
        } catch (error) {
            setGlobalError(error instanceof Error ? error.message : t('settings.chat.composerToolbar.globalError'))
        } finally {
            setGlobalSavingItem(null)
        }
    }

    const renderItem = (item: ComposerToolbarItemId, group: ComposerToolbarGroup, index: number) => {
        const label = t(ITEM_LABEL_KEYS[item])
        const disabled = !isComposerToolbarItemEnabled(effectiveLayout, item)
        const title = disabled
            ? `${label} · ${t('settings.chat.composerToolbar.disabled')}`
            : label
        return (
            <button
                key={item}
                type="button"
                draggable
                aria-label={title}
                title={title}
                onDragStart={(event) => {
                    setDraggedItem(item)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', item)
                }}
                onDragEnter={(event) => {
                    event.preventDefault()
                    moveDraggedItem(group, index)
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                    event.stopPropagation()
                    onDrop(event, group, index)
                }}
                onDragEnd={() => setDraggedItem(null)}
                onClick={() => setSelectedItem((current) => current === item ? null : item)}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft' && index > 0) {
                        event.preventDefault()
                        moveItemByOffset(item, group, index, -1)
                    }
                    if (event.key === 'ArrowRight') {
                        event.preventDefault()
                        moveItemByOffset(item, group, index, 1)
                    }
                }}
                aria-pressed={selectedItem === item}
                className={`relative cursor-grab rounded-full transition-colors hover:bg-[var(--app-bg)] active:cursor-grabbing ${selectedItem === item ? 'bg-[var(--app-bg)] ring-1 ring-[var(--app-link)]' : ''} ${disabled ? 'opacity-40 grayscale' : ''} ${draggedItem === item ? 'opacity-35' : ''}`}
            >
                <ComposerToolbarItemPreview item={item} label={label} />
                {disabled ? (
                    <span className="pointer-events-none absolute inset-x-1 top-1/2 h-px -rotate-12 bg-[var(--app-fg)]/60" aria-hidden="true" />
                ) : null}
            </button>
        )
    }

    const renderGroup = (group: ComposerToolbarGroup, items: ComposerToolbarItemId[], alignment: string, grow: boolean) => (
        <div
            className={`flex min-h-10 min-w-12 items-center gap-1 rounded-lg ${grow ? 'flex-1' : 'shrink-0'} ${alignment}`}
            onDragEnter={(event) => {
                if (event.target === event.currentTarget) {
                    moveDraggedItem(group, items.length)
                }
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDrop(event, group, items.length)}
        >
            {items.map((item, index) => renderItem(item, group, index))}
        </div>
    )

    const singleAlignment = layout.mode === 'center' ? 'justify-center' : layout.mode === 'right' ? 'justify-end' : 'justify-start'
    const singleItems = [...layout.left, ...layout.right]
    const selectedGroup: ComposerToolbarGroup = selectedItem && layout.right.includes(selectedItem) ? 'right' : 'left'
    const selectedItems = layout.mode === 'split' ? layout[selectedGroup] : singleItems
    const selectedIndex = selectedItem ? selectedItems.indexOf(selectedItem) : -1
    const selectedLocalDisabled = selectedItem ? !isComposerToolbarItemEnabled(layout, selectedItem) : false
    const selectedGlobalDisabled = selectedItem ? globalSettings.disabled.includes(selectedItem) : false
    const selectedDisabled = selectedLocalDisabled || selectedGlobalDisabled

    return (
        <div className="border-t border-[var(--app-divider)] py-3">
            <div className="mb-3 px-3">
                <h3 className="text-sm font-medium text-[var(--app-fg)]">{t('settings.chat.composerToolbar.title')}</h3>
                <p className="mt-0.5 text-xs text-[var(--app-hint)]">{t('settings.chat.composerToolbar.description')}</p>
            </div>
            <SettingsChoiceGroup
                label={t('settings.chat.composerToolbar.layout')}
                value={layout.mode}
                columns={4}
                options={([
                    ['left', 'settings.chat.composerToolbar.layout.left'],
                    ['center', 'settings.chat.composerToolbar.layout.center'],
                    ['right', 'settings.chat.composerToolbar.layout.right'],
                    ['split', 'settings.chat.composerToolbar.layout.split'],
                ] as const).map(([value, labelKey]) => ({ value, label: t(labelKey) }))}
                onChange={setMode}
            />

            <div className="mt-3 flex items-center justify-between gap-3 px-3">
                <div>
                    <h4 className="text-sm font-medium text-[var(--app-fg)]">{t('settings.chat.composerToolbar.order')}</h4>
                    <p className="mt-0.5 text-xs text-[var(--app-hint)]">{t('settings.chat.composerToolbar.previewHint')}</p>
                </div>
                <button type="button" onClick={resetLayout} className="shrink-0 text-sm text-[var(--app-link)] hover:underline">{t('settings.chat.composerToolbar.reset')}</button>
            </div>

            <div className="mx-3 mt-2 rounded-[24px] bg-[var(--app-composer-bg,var(--app-subtle-bg))] px-3 pb-2 pt-3 shadow-sm ring-1 ring-[var(--app-border)]">
                <div className="mb-2 px-1 text-sm text-[var(--app-hint)]">{t('misc.typeAMessage')}</div>
                <div className="flex items-center gap-1">
                    <div className="min-w-0 flex-1 overflow-x-auto">
                        {layout.mode === 'split' ? (
                            <div className="flex min-w-full items-center gap-1">
                                {renderGroup('left', layout.left, 'justify-start', false)}
                                <span className="min-w-2 flex-1" aria-hidden="true" />
                                {renderGroup('right', layout.right, 'justify-end', false)}
                            </div>
                        ) : renderGroup('left', singleItems, singleAlignment, true)}
                    </div>
                    <span className="ml-1" title={t('composer.send')}><ComposerSendButtonPreview /></span>
                </div>
            </div>
            {selectedItem && selectedIndex >= 0 ? (
                <div className="mx-3 mt-2 rounded-lg bg-[var(--app-subtle-bg)] px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="min-w-0 truncate text-[var(--app-fg)]">{t(ITEM_LABEL_KEYS[selectedItem])}</span>
                                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${selectedDisabled ? 'bg-red-500/10 text-red-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
                                    {selectedDisabled ? t('settings.chat.composerToolbar.disabled') : t('settings.chat.composerToolbar.enabled')}
                                </span>
                                {selectedGlobalDisabled ? (
                                    <span className="shrink-0 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] text-red-600">
                                        {t('settings.chat.composerToolbar.globalBadge')}
                                    </span>
                                ) : null}
                            </div>
                            <p className="mt-0.5 text-xs text-[var(--app-hint)]">{t('settings.chat.composerToolbar.disableHint')}</p>
                            {globalError ? <p className="mt-1 text-xs text-red-600">{globalError}</p> : null}
                        </div>
                        <span className="flex shrink-0 items-center gap-1">
                            <button
                                type="button"
                                onClick={() => setLayout(setComposerToolbarItemDisabled(layout, selectedItem, !selectedLocalDisabled))}
                                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--app-bg)] ${selectedLocalDisabled ? 'text-emerald-600' : 'text-red-600'}`}
                            >
                                {selectedLocalDisabled ? t('settings.chat.composerToolbar.enableTool') : t('settings.chat.composerToolbar.disableTool')}
                            </button>
                            {canManageGlobal ? (
                                <button
                                    type="button"
                                    disabled={globalSettingsLoading || globalSavingItem === selectedItem}
                                    onClick={() => {
                                        void setGlobalDisabled(selectedItem, !selectedGlobalDisabled)
                                    }}
                                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--app-bg)] disabled:opacity-50 ${selectedGlobalDisabled ? 'text-emerald-600' : 'text-red-600'}`}
                                >
                                    {selectedGlobalDisabled
                                        ? t('settings.chat.composerToolbar.enableGlobally')
                                        : t('settings.chat.composerToolbar.disableGlobally')}
                                </button>
                            ) : null}
                            <button
                                type="button"
                                disabled={selectedIndex === 0}
                                aria-label={t('settings.chat.composerToolbar.moveEarlier')}
                                title={t('settings.chat.composerToolbar.moveEarlier')}
                                onClick={() => moveItemByOffset(selectedItem, selectedGroup, selectedIndex, -1)}
                                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-[var(--app-bg)] disabled:opacity-35"
                            >
                                ←
                            </button>
                            <button
                                type="button"
                                disabled={selectedIndex === selectedItems.length - 1}
                                aria-label={t('settings.chat.composerToolbar.moveLater')}
                                title={t('settings.chat.composerToolbar.moveLater')}
                                onClick={() => moveItemByOffset(selectedItem, selectedGroup, selectedIndex, 1)}
                                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-[var(--app-bg)] disabled:opacity-35"
                            >
                                →
                            </button>
                            {layout.mode === 'split' ? (
                                <button
                                    type="button"
                                    aria-label={selectedGroup === 'left' ? t('settings.chat.composerToolbar.moveRight') : t('settings.chat.composerToolbar.moveLeft')}
                                    title={selectedGroup === 'left' ? t('settings.chat.composerToolbar.moveRight') : t('settings.chat.composerToolbar.moveLeft')}
                                    onClick={() => setLayout(moveComposerToolbarItem(layout, selectedItem, selectedGroup === 'left' ? 'right' : 'left', selectedGroup === 'left' ? layout.right.length : layout.left.length))}
                                    className="ml-1 rounded-lg px-2.5 py-1.5 text-xs text-[var(--app-link)] hover:bg-[var(--app-bg)]"
                                >
                                    {selectedGroup === 'left' ? t('settings.chat.composerToolbar.rightGroup') : t('settings.chat.composerToolbar.leftGroup')}
                                </button>
                            ) : null}
                        </span>
                    </div>
                </div>
            ) : null}
        </div>
    )
}
