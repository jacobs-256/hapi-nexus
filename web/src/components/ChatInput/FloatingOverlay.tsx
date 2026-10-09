import { memo, ReactNode } from 'react'

interface FloatingOverlayProps {
    children: ReactNode
    maxHeight?: number
}

/**
 * A floating panel container with shadow and rounded corners
 * Used for autocomplete suggestions and settings panels
 */
export const FloatingOverlay = memo(function FloatingOverlay(props: FloatingOverlayProps) {
    const { children, maxHeight = 240 } = props
    const constrainedHeight = `min(${maxHeight}px, calc(100dvh - 1rem))`

    return (
        <div
            className="overflow-hidden rounded-xl border border-[var(--app-divider)] bg-[var(--app-bg)] shadow-lg"
            style={{ maxHeight: constrainedHeight }}
        >
            <div className="overflow-y-auto" style={{ maxHeight: constrainedHeight }}>
                {children}
            </div>
        </div>
    )
})
