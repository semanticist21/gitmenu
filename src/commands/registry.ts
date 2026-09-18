// The one place commands, menus and keybindings are declared, in the shape of VS Code's
// `contributes` (commands, menus with group/order/when, keybindings with key/mac/when).
// Features register handlers for the commands they own; menus, the palette and shortcuts
// all read from here.
import type { LucideIcon } from 'lucide-react'
import { gl, t, vs, vsb } from '@/i18n'
import type { AppKey } from '@/i18n/app/en'
import { contextSnapshot } from './context'
import { type Context, matchesWhen } from './when'

/**
 * A label: a VS Code git nls key (`vs`), a VS Code git runtime message by its English text
 * (`vsb`), an app string key (`app`), or text that is never translated (product names).
 */
export type Title = { vs: string } | { vsb: string } | { gl: string } | { app: AppKey } | { text: string }

export function title(value: Title): string {
  if ('vs' in value) return vs(value.vs)
  if ('vsb' in value) return vsb(value.vsb, '').trim()
  if ('gl' in value) return gl(value.gl)
  if ('app' in value) return t(value.app)
  return value.text
}

export interface CommandContribution {
  command: string
  title: Title
  category?: Title
  icon?: LucideIcon
  /** Command runs only when this holds (grays out in menus) */
  enablement?: string
}

export interface MenuItem {
  command?: string
  submenu?: string
  when?: string
  /** VS Code group syntax: `navigation`, `inline`, `1_modification@2` */
  group?: string
  alt?: string
}

export interface KeybindingContribution {
  command: string
  key: string
  mac?: string
  when?: string
  args?: unknown
}

export interface SubmenuContribution {
  id: string
  label: Title
  icon?: LucideIcon
}

export interface Contribution {
  commands?: CommandContribution[]
  menus?: Record<string, MenuItem[]>
  keybindings?: KeybindingContribution[]
  submenus?: SubmenuContribution[]
}

type Handler = (...args: unknown[]) => unknown

const commands = new Map<string, CommandContribution>()
const menus = new Map<string, MenuItem[]>()
const submenus = new Map<string, SubmenuContribution>()
const defaultKeybindings: KeybindingContribution[] = []
const handlers = new Map<string, Handler>()

export function contribute(contribution: Contribution) {
  for (const command of contribution.commands ?? []) commands.set(command.command, command)
  for (const [id, items] of Object.entries(contribution.menus ?? {})) {
    menus.set(id, [...(menus.get(id) ?? []), ...items])
  }
  for (const submenu of contribution.submenus ?? []) submenus.set(submenu.id, submenu)
  defaultKeybindings.push(...(contribution.keybindings ?? []))
}

/** Registers the implementation of a command; returns an unregister function. */
export function registerHandler(command: string, handler: Handler): () => void {
  handlers.set(command, handler)
  return () => {
    if (handlers.get(command) === handler) handlers.delete(command)
  }
}

export function getCommand(id: string): CommandContribution | undefined {
  return commands.get(id)
}

export function getSubmenu(id: string): SubmenuContribution | undefined {
  return submenus.get(id)
}

export function allCommands(): CommandContribution[] {
  return [...commands.values()]
}

export function defaultBindings(): KeybindingContribution[] {
  return defaultKeybindings
}

export function commandLabel(id: string): string {
  const command = commands.get(id)
  return command ? title(command.title) : id
}

export function paletteLabel(id: string): string {
  const command = commands.get(id)
  if (!command) return id
  return command.category ? `${title(command.category)}: ${title(command.title)}` : title(command.title)
}

export function isEnabled(id: string, ctx: Context = contextSnapshot()): boolean {
  const command = commands.get(id)
  return Boolean(command && handlers.has(id) && matchesWhen(command.enablement, ctx))
}

export async function executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(id)
  if (!handler) {
    console.warn(`no handler for command ${id}`)
    return undefined
  }
  return handler(...args)
}

export interface ResolvedMenuItem {
  id: string
  command?: CommandContribution
  submenu?: SubmenuContribution
  enabled: boolean
  alt?: CommandContribution
}

export interface MenuGroup {
  group: string
  items: ResolvedMenuItem[]
}

function splitGroup(group?: string): [string, number] {
  if (!group) return ['', 0]
  const at = group.lastIndexOf('@')
  return at === -1 ? [group, 0] : [group.slice(0, at), Number(group.slice(at + 1)) || 0]
}

/** VS Code ordering: `navigation` first, then groups by name, items by `@order` then title. */
export function resolveMenu(menuId: string, extra?: Context): MenuGroup[] {
  const ctx = contextSnapshot(extra)
  const groups = new Map<string, { order: number; item: ResolvedMenuItem; label: string }[]>()
  for (const item of menus.get(menuId) ?? []) {
    if (!matchesWhen(item.when, ctx)) continue
    const [group, order] = splitGroup(item.group)
    const command = item.command ? commands.get(item.command) : undefined
    const submenu = item.submenu ? submenus.get(item.submenu) : undefined
    if (!command && !submenu) continue
    const resolved: ResolvedMenuItem = {
      id: item.command ?? item.submenu!,
      command,
      submenu,
      enabled: command ? isEnabled(command.command, ctx) : true,
      alt: item.alt ? commands.get(item.alt) : undefined,
    }
    const label = command ? title(command.title) : title(submenu!.label)
    groups.set(group, [...(groups.get(group) ?? []), { order, item: resolved, label }])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'navigation' ? -1 : b === 'navigation' ? 1 : a.localeCompare(b)))
    .map(([group, entries]) => ({
      group,
      items: entries.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)).map((e) => e.item),
    }))
}

/** Commands shown in the palette: every command unless its `commandPalette` entry hides it. */
export function paletteCommands(ctx: Context = contextSnapshot()): CommandContribution[] {
  const hidden = new Map<string, string | undefined>()
  for (const item of menus.get('commandPalette') ?? []) {
    if (item.command) hidden.set(item.command, item.when)
  }
  return allCommands().filter((command) => {
    if (!handlers.has(command.command)) return false
    if (hidden.has(command.command) && !matchesWhen(hidden.get(command.command), ctx)) return false
    return matchesWhen(command.enablement, ctx)
  })
}
