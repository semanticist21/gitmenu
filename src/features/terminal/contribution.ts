// VS Code's New Terminal: a shell in a detail tab, like a terminal in VS Code's editor area.
import { type Contribution, registerHandler } from '@/commands/registry'
import { ipc } from '@/lib/ipc'

export const terminalContribution: Contribution = {
  commands: [{ command: 'workbench.action.terminal.new', title: { app: 'terminal.new' }, category: { app: 'terminal.title' }, icon: 'add' }],
  // ⌃⇧` on every platform, macOS included
  keybindings: [{ command: 'workbench.action.terminal.new', key: 'ctrl+shift+`' }],
}

/** A new terminal tab: a fresh session key, starting in `cwd` (without one, Rust picks the active project). */
export function newTerminalRoute(cwd?: string | null) {
  const params = new URLSearchParams({ key: crypto.randomUUID() })
  if (cwd) params.set('cwd', cwd)
  return `/detail/terminal?${params}`
}

export function registerTerminalHandlers() {
  // The panel opens the detail window on a new terminal; the detail window replaces this with
  // a handler that starts in its active tab's repository
  registerHandler('workbench.action.terminal.new', () => ipc.detailOpen(newTerminalRoute()))
}
