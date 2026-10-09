import type { ViewTransitionOptions } from '@tanstack/router-core'

const SESSION_NAVIGATION_MEDIA = '(max-width: 919px) and (prefers-reduced-motion: no-preference)'

/** Use the router's snapshots so the outgoing chat survives the back animation. */
export function getSessionViewTransition(): ViewTransitionOptions | false {
    // Without typed transitions the router skips the route filter and animates
    // every navigation. Keep normal navigation on those older browsers.
    if (typeof window === 'undefined'
        || typeof document.startViewTransition !== 'function'
        || !window.CSS?.supports?.('selector(:active-view-transition-type(a))')) {
        return false
    }

    return {
        types: ({ fromLocation, toLocation }) => {
            if (!fromLocation || !window.matchMedia(SESSION_NAVIGATION_MEDIA).matches) {
                return false
            }

            const from = fromLocation.pathname.replace(/\/$/, '')
            const to = toLocation.pathname.replace(/\/$/, '')
            if (from === '/sessions' && to.startsWith('/sessions/')) {
                return ['session-open']
            }
            if (from.startsWith('/sessions/') && to === '/sessions') {
                return ['session-close']
            }
            return false
        },
    }
}
