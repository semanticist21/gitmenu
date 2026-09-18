// Source Control state shared by the view and the git commands: the repository commands act
// on by default (the one selected in the panel), and each repository's commit input.
import { QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import type { FileChange } from '@/lib/git'
import { ipc } from '@/lib/ipc'

export type GroupId = 'merge' | 'index' | 'workingTree' | 'untracked'

/** What a resource or resource-group command receives (VS Code's SourceControlResourceState). */
export interface ScmSelection {
  root: string
  group: GroupId
  changes: FileChange[]
}

export function isSelection(value: unknown): value is ScmSelection {
  return typeof value === 'object' && value !== null && 'root' in value && 'changes' in value
}

let activeRepo: string | null = null
let client: QueryClient | null = null

export function setActiveRepo(root: string | null) {
  activeRepo = root
}

export function getActiveRepo(): string | null {
  return activeRepo
}

/** The query client the commands use to read fresh status and invalidate after writes. */
export function setScmQueryClient(queryClient: QueryClient) {
  client = queryClient
}

export function scmQueryClient(): QueryClient {
  if (!client) throw new Error('query client not set')
  return client
}

/** Resolves a command's target repository: an explicit root/selection, else the active one. */
export function repoFrom(arg: unknown): string | null {
  if (typeof arg === 'string') return arg
  if (isSelection(arg)) return arg.root
  if (Array.isArray(arg) && isSelection(arg[0])) return arg[0].root
  // View rows pass `{ root, … }`
  if (typeof arg === 'object' && arg !== null && typeof (arg as { root?: unknown }).root === 'string') return (arg as { root: string }).root
  return activeRepo
}

// Commit input per repository, kept across panel reopen and app restart (VS Code keeps it too)
const inputs = new Map<string, string>()
const listeners = new Set<() => void>()
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

export async function loadCommitInput(root: string) {
  if (inputs.has(root)) return
  const saved = await ipc.uiStateGet<string>(`scmInput:${root}`)
  if (!inputs.has(root)) {
    inputs.set(root, saved ?? '')
    listeners.forEach((fn) => fn())
  }
}

export function getCommitInput(root: string): string {
  return inputs.get(root) ?? ''
}

export function setCommitInput(root: string, value: string) {
  inputs.set(root, value)
  listeners.forEach((fn) => fn())
  clearTimeout(saveTimers.get(root))
  saveTimers.set(
    root,
    setTimeout(() => void ipc.uiStateSet(`scmInput:${root}`, value || null), 400),
  )
}

export function useCommitInput(root: string): string {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => inputs.get(root) ?? '',
  )
}
