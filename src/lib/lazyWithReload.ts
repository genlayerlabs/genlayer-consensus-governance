import { lazy, type ComponentType } from 'react'

const RELOAD_FLAG = 'genlayer-gov-chunk-reload'

/**
 * `lazy()` that survives a redeploy.
 *
 * Route chunks are content-hashed, so publishing a new build deletes the old
 * filenames. A tab opened before the deploy still holds the old index, and the
 * first navigation asks for a chunk that no longer exists:
 *
 *   Failed to fetch dynamically imported module: .../ProposalsPage-<hash>.js
 *
 * React has no content to render and the page goes blank until a manual
 * reload — exactly the state a user hits after sitting on one route while a
 * deploy lands. Reloading picks up the current index and its chunks.
 *
 * The sessionStorage flag makes this fire at most once per tab: if the import
 * still fails after a reload the cause is not staleness (offline, a genuinely
 * broken deploy), and looping would hide it.
 */
export function lazyWithReload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const module = await factory()
      sessionStorage.removeItem(RELOAD_FLAG)
      return module
    } catch (error) {
      const alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG)
      if (!alreadyReloaded) {
        sessionStorage.setItem(RELOAD_FLAG, '1')
        window.location.reload()
        // Never resolves: the reload replaces this document.
        return new Promise<{ default: T }>(() => {})
      }
      throw error
    }
  })
}
