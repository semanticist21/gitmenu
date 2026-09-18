// Default keybindings from the registry plus the user's keybindings.json, resolved like
// VS Code: later entries win, `-command` removes a default, `when` decides per keypress.
import type { RawHotkey } from '@tanstack/hotkeys'
import { useHotkeySequences, useHotkeys } from '@tanstack/react-hotkeys'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ipc, useTauriEvent } from '@/lib/ipc'
import { contextSnapshot } from './context'
import { defaultBindings, executeCommand, isEnabled, type KeybindingContribution } from './registry'
import { matchesWhen } from './when'

export interface UserKeybinding {
  key: string
  command: string
  when?: string
  args?: unknown
}

export interface EffectiveBinding {
  key: string
  command: string
  when?: string
  args?: unknown
  source: 'default' | 'user'
}

export const keybindingsQuery = {
  queryKey: ['keybindings'],
  queryFn: async () => (await ipc.keybindingsGet()) as UserKeybinding[],
  staleTime: Infinity,
}

/** Normalizes `Cmd+Shift+P`, `shift+cmd+p` → `shift+cmd+p` in VS Code's modifier order. */
export function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((chord) => {
      const parts = chord.split('+').map((p) => p.trim())
      const base = parts.pop() ?? ''
      const mods = ['ctrl', 'shift', 'alt', 'cmd'].filter((m) =>
        parts.some((p) => p === m || (m === 'cmd' && (p === 'meta' || p === 'command')) || (m === 'alt' && p === 'option')),
      )
      return [...mods, base].join('+')
    })
    .join(' ')
}

export function resolveBindings(user: UserKeybinding[]): EffectiveBinding[] {
  let result: EffectiveBinding[] = defaultBindings().map((b: KeybindingContribution) => ({
    key: normalizeKey(b.mac ?? b.key),
    command: b.command,
    when: b.when,
    args: b.args,
    source: 'default',
  }))
  for (const entry of user) {
    if (!entry?.command) continue
    if (entry.command.startsWith('-')) {
      const command = entry.command.slice(1)
      const key = entry.key ? normalizeKey(entry.key) : undefined
      result = result.filter(
        (b) => !(b.command === command && (!key || b.key === key) && (entry.when === undefined || b.when === entry.when)),
      )
    } else if (entry.key) {
      result.push({ key: normalizeKey(entry.key), command: entry.command, when: entry.when, args: entry.args, source: 'user' })
    }
  }
  return result
}

export function useEffectiveBindings(): EffectiveBinding[] {
  const { data } = useQuery(keybindingsQuery)
  return useMemo(() => resolveBindings(data ?? []), [data])
}

export function useKeybindingsSync() {
  const client = useQueryClient()
  useTauriEvent<UserKeybinding[]>('keybindings://changed', (bindings) => {
    client.setQueryData(keybindingsQuery.queryKey, bindings)
  })
}

const KEY_NAMES: Record<string, string> = {
  enter: 'Enter',
  escape: 'Escape',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
}

function toRaw(chord: string): RawHotkey {
  const parts = chord.split('+')
  const base = parts[parts.length - 1]
  const key = KEY_NAMES[base] ?? (/^f\d+$/.test(base) ? base.toUpperCase() : base.length === 1 ? base.toUpperCase() : base)
  return {
    key,
    meta: parts.includes('cmd'),
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
  }
}

/** Sequences take hotkey strings (`Meta+K`), not raw objects. */
function toHotkeyString(chord: string): string {
  const raw = toRaw(chord)
  const mods = [raw.ctrl && 'Control', raw.alt && 'Alt', raw.shift && 'Shift', raw.meta && 'Meta'].filter(Boolean)
  return [...mods, raw.key].join('+')
}

/** The command a key triggers now: the last matching binding whose `when` holds. */
function resolve(bindings: EffectiveBinding[], key: string): EffectiveBinding | undefined {
  const ctx = contextSnapshot()
  for (let i = bindings.length - 1; i >= 0; i--) {
    const b = bindings[i]
    if (b.key === key && matchesWhen(b.when, ctx) && isEnabled(b.command, ctx)) return b
  }
  return undefined
}

/** Dispatches every bound key in this window. */
export function useCommandHotkeys() {
  const bindings = useEffectiveBindings()
  const singles = useMemo(() => [...new Set(bindings.map((b) => b.key).filter((k) => !k.includes(' ')))], [bindings])
  const chords = useMemo(() => [...new Set(bindings.map((b) => b.key).filter((k) => k.includes(' ')))], [bindings])

  useHotkeys(
    singles.map((key) => ({
      hotkey: toRaw(key),
      callback: (event: KeyboardEvent) => {
        const binding = resolve(bindings, key)
        if (!binding) return
        event.preventDefault()
        event.stopPropagation()
        void executeCommand(binding.command, binding.args)
      },
    })),
    { ignoreInputs: false, preventDefault: false },
  )

  useHotkeySequences(
    chords.map((key) => ({
      sequence: key.split(' ').map(toHotkeyString) as never,
      callback: (event: KeyboardEvent) => {
        const binding = resolve(bindings, key)
        if (!binding) return
        event.preventDefault()
        void executeCommand(binding.command, binding.args)
      },
    })),
    { ignoreInputs: false },
  )
}

/** macOS glyphs for display: `shift+cmd+p` → `⇧⌘P`. */
export function formatKey(key: string): string {
  const glyphs: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', cmd: '⌘' }
  const names: Record<string, string> = {
    enter: '↩',
    escape: '⎋',
    space: 'Space',
    tab: '⇥',
    backspace: '⌫',
    delete: '⌦',
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
    pageup: '⇞',
    pagedown: '⇟',
  }
  return key
    .split(' ')
    .map((chord) => {
      const parts = chord.split('+')
      const base = parts.pop() ?? ''
      return parts.map((p) => glyphs[p] ?? p).join('') + (names[base] ?? base.toUpperCase())
    })
    .join(' ')
}

/** The display shortcut for a command (first effective binding without a restrictive when). */
export function useShortcutFor(command: string): string | undefined {
  const bindings = useEffectiveBindings()
  const binding = [...bindings].reverse().find((b) => b.command === command)
  return binding ? formatKey(binding.key) : undefined
}
