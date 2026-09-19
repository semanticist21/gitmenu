// A view's description, shown after its title in the pane header (VS Code's
// `view.description`, which GitLens sets to e.g. "main • 1↓ 2↑" on Commits).
import { useEffect, useSyncExternalStore } from 'react'

let descriptions: Record<string, string> = {}
const listeners = new Set<() => void>()

function set(viewId: string, text: string | undefined) {
  if ((descriptions[viewId] ?? undefined) === text) return
  const next = { ...descriptions }
  if (text) next[viewId] = text
  else delete next[viewId]
  descriptions = next
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Publishes the calling view's description while it is mounted. */
export function useViewDescription(viewId: string, text: string | undefined) {
  useEffect(() => {
    set(viewId, text)
    return () => set(viewId, undefined)
  }, [viewId, text])
}

export function useViewDescriptions(): Record<string, string> {
  return useSyncExternalStore(subscribe, () => descriptions)
}
