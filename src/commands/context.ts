// Context keys for `when` clauses, as in VS Code.
// - global keys: set with setContext() (e.g. `gitmenu.hasRepository`)
// - focus keys: read from `data-context` JSON on the focused element and its ancestors
//   (e.g. a list sets `{"listFocus":true,"focusedView":"workbench.scm"}`)
// - settings: exposed as `config.<key>`
// - menu keys: passed per call (the item a context menu opened on)
import { useSyncExternalStore } from 'react'
import type { Context } from './when'

let globals: Context = {}
let focus: Context = {}
let settings: Context = {}
let snapshot: Context = {}
const listeners = new Set<() => void>()

function publish() {
  snapshot = { ...settings, ...globals, ...focus }
  listeners.forEach((fn) => fn())
}

export function setContext(key: string, value: unknown) {
  if (globals[key] === value) return
  globals = { ...globals, [key]: value }
  publish()
}

let overlays = 0

/** Marks a dialog as open (`gitmenu.overlayOpen`) until the returned function runs. */
export function openOverlay(): () => void {
  overlays++
  setContext('gitmenu.overlayOpen', true)
  let closed = false
  return () => {
    if (closed) return
    closed = true
    overlays--
    setContext('gitmenu.overlayOpen', overlays > 0)
  }
}

export function setSettingsContext(values: Record<string, unknown>) {
  settings = Object.fromEntries(Object.entries(values).map(([k, v]) => [`config.${k}`, v]))
  publish()
}

export function contextSnapshot(extra?: Context): Context {
  return extra ? { ...snapshot, ...extra } : snapshot
}

function readFocusContext(target: Element | null): Context {
  const keys: Context = {}
  const chain: Element[] = []
  for (let el = target; el; el = el.parentElement) chain.push(el)
  // Outer elements first so inner ones override
  for (const el of chain.reverse()) {
    const raw = el.getAttribute('data-context')
    if (!raw) continue
    try {
      Object.assign(keys, JSON.parse(raw))
    } catch {
      // ignore malformed attributes
    }
  }
  const tag = target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (target as HTMLElement | null)?.isContentEditable) {
    keys.inputFocus = true
    keys.textInputFocus = true
  }
  return keys
}

let installed = false

export function installFocusTracking() {
  if (installed) return
  installed = true
  const update = () => {
    focus = readFocusContext(document.activeElement)
    publish()
  }
  document.addEventListener('focusin', update)
  document.addEventListener('focusout', () => queueMicrotask(update))
  update()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useContextKeys(): Context {
  return useSyncExternalStore(subscribe, () => snapshot)
}
