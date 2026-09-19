// Typed wrappers over the Rust commands in src-tauri/src/commands.rs.
import { invoke } from '@tauri-apps/api/core'
import type { Prompt } from '@/features/prompt/PromptDialog'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'

export interface IpcError {
  kind: string
  message: string
  stderr: string | null
}

export function isIpcError(value: unknown): value is IpcError {
  return typeof value === 'object' && value !== null && 'kind' in value && 'message' in value
}

export function errorMessage(value: unknown): string {
  if (isIpcError(value)) return value.message
  if (value instanceof Error) return value.message
  return String(value)
}

export type RepoKind = 'root' | 'submodule' | 'nested'

export interface RepoInfo {
  root: string
  gitDir: string
  commonDir: string
  kind: RepoKind
  name: string
}

export interface ProjectInfo {
  id: string
  name: string
  missing: boolean
  dirty: boolean
  repos: RepoInfo[]
  parentCandidate: string | null
}

export interface EnvStatus {
  shellFailed: boolean
  ready: boolean
  git: string | null
  gitVersion: string | null
}

/** One git command in the Git output log (src-tauri/src/output.rs) */
export interface GitLogEntry {
  op: number
  time: number
  repo: string
  args: string[]
  durationMs: number
  /** Null when git was cancelled, killed, or couldn't start */
  code: number | null
  cancelled: boolean
  stderr: string
}

export type LoginItem = 'enabled' | 'disabled' | 'requiresApproval' | 'unavailable'

export const ipc = {
  envStatus: () => invoke<EnvStatus>('env_status'),
  envRefresh: () => invoke<void>('env_refresh'),
  settingsGet: () => invoke<Record<string, unknown>>('settings_get'),
  settingsSet: (key: string, value: unknown) => invoke<void>('settings_set', { key, value }),
  settingsFilePaths: () => invoke<[string, string]>('settings_file_paths'),
  keybindingsGet: () => invoke<unknown[]>('keybindings_get'),
  keybindingsSet: (bindings: unknown[]) => invoke<void>('keybindings_set', { bindings }),
  uiStateGet: <T>(key: string) => invoke<T | null>('ui_state_get', { key }),
  uiStateSet: (key: string, value: unknown) => invoke<void>('ui_state_set', { key, value }),
  projectsList: () => invoke<[ProjectInfo[], string | null]>('projects_list'),
  projectsRecent: () => invoke<string[]>('projects_recent'),
  projectOpen: (path: string) => invoke<ProjectInfo>('project_open', { path }),
  projectClose: (id: string) => invoke<void>('project_close', { id }),
  projectActivate: (id: string) => invoke<void>('project_activate', { id }),
  projectReorder: (order: string[]) => invoke<void>('project_reorder', { order }),
  projectRelocate: (id: string, path: string) => invoke<ProjectInfo>('project_relocate', { id, path }),
  projectAnswerParent: (id: string, accept: boolean) => invoke<ProjectInfo>('project_answer_parent', { id, accept }),
  projectInitRepo: (id: string, label: string, branch: string | null) => invoke<ProjectInfo>('project_init_repo', { id, label, branch }),
  pickFolder: (title?: string) => invoke<string | null>('pick_folder', { title }),
  pickFile: (directory: string, title?: string) => invoke<string | null>('pick_file', { directory, title }),
  clipboardWrite: (text: string) => invoke<void>('clipboard_write', { text }),
  panelHide: () => invoke<void>('panel_hide'),
  panelSetPinned: (pinned: boolean) => invoke<void>('panel_set_pinned', { pinned }),
  panelSetDetached: (detached: boolean) => invoke<void>('panel_set_detached', { detached }),
  detailOpen: (route: string) => invoke<void>('detail_open', { route }),
  detailSetAlwaysOnTop: (value: boolean) => invoke<void>('detail_set_always_on_top', { value }),
  promptOpen: () => invoke<Prompt[]>('prompt_open'),
  promptRespond: (id: number, value: string | null) => invoke<void>('prompt_respond', { id, value }),
  promptReadFile: (path: string) => invoke<string>('prompt_read_file', { path }),
  promptWriteFile: (id: number, path: string, content: string | null) =>
    invoke<void>('prompt_write_file', { id, path, content }),
  opCancel: (id: number) => invoke<void>('op_cancel', { id }),
  gitLogEntries: () => invoke<GitLogEntry[]>('git_log_entries'),
  gitLogClear: () => invoke<void>('git_log_clear'),
  /** A failed operation's commands, by the key from `op://finished` */
  gitLogFailure: (key: string) => invoke<GitLogEntry[] | null>('git_log_failure', { key }),
  openInTerminal: (path: string) => invoke<void>('open_in_terminal', { path }),
  revealInFinder: (path: string) => invoke<void>('reveal_in_finder', { path }),
  openPath: (path: string) => invoke<void>('open_path', { path }),
  terminalApps: () => invoke<string[]>('terminal_apps'),
  appQuit: () => invoke<void>('app_quit'),
  crashReport: (message: string) => invoke<void>('crash_report', { message }),
  aiAvailability: () => invoke<string>('ai_availability'),
  aiCommitMessage: (root: string) => invoke<string>('ai_commit_message', { root }),
  loginItemStatus: () => invoke<LoginItem>('login_item_status'),
  loginItemSet: (enabled: boolean) => invoke<LoginItem>('login_item_set', { enabled }),
  updateCheck: () => invoke<{ version: string; notes: string | null } | null>('update_check'),
  updateInstall: () => invoke<void>('update_install'),
}

/** Subscribes to a Rust event for the component's lifetime; the handler may change freely. */
export function useTauriEvent<T>(name: string, handler: (payload: T) => void) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    let disposed = false
    listen<T>(name, (event) => ref.current(event.payload)).then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [name])
}
