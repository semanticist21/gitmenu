// Running git operations, shown the way VS Code shows them: `ProgressLocation.SourceControl`
// (the 2px bar on the Source Control view, which ends 300ms after the last operation), spinning
// sync and checkout icons, and failures as error notifications. VS Code has no general
// cancel; gitmenu keeps one (SPEC: operations can be cancelled) as a progress notification
// with Cancel, like VS Code's cancellable sync, once an operation has run for a while.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import { setContext } from '@/commands/context'
import { toastManager } from '@/components/ui/toast'
import { t, useLocale } from '@/i18n'
import type { OpKind } from '@/lib/git'
import { type IpcError, ipc, useTauriEvent } from '@/lib/ipc'

export interface RunningOp {
  id: number
  repo: string
  kind: OpKind
  label: string
}

interface OpStarted extends RunningOp {
  background: boolean
}

interface OpFinished {
  id: number
  repo: string
  kind: OpKind
  error: IpcError | null
  background: boolean
}

/** repository.ts debounces the end of SCM progress by 300ms */
const PROGRESS_END_DELAY = 300
/** How long an operation runs before its cancellable notification appears (gitmenu choice) */
const NOTIFICATION_DELAY = 3000

interface Snapshot {
  running: RunningOp[]
  /** Running, or finished less than 300ms ago */
  busy: boolean
}

let snapshot: Snapshot = { running: [], busy: false }
const listeners = new Set<() => void>()
let endTimer: number | undefined
const notifyTimers = new Map<number, number>()

function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next }
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const toastId = (id: number) => `op:${id}`

function started(op: RunningOp) {
  window.clearTimeout(endTimer)
  publish({ running: [...snapshot.running, op], busy: true })
  // Commands holding several operations together have no git process of their own to cancel
  if (op.id < 0) return
  notifyTimers.set(
    op.id,
    window.setTimeout(() => {
      notifyTimers.delete(op.id)
      if (!snapshot.running.some((o) => o.id === op.id)) return
      toastManager.add({
        id: toastId(op.id),
        type: 'loading',
        title: op.label,
        actionProps: { children: t('op.cancel'), onClick: () => void ipc.opCancel(op.id) },
      })
    }, NOTIFICATION_DELAY),
  )
}

function finished(id: number) {
  window.clearTimeout(notifyTimers.get(id))
  notifyTimers.delete(id)
  if (!snapshot.running.some((o) => o.id === id)) return
  toastManager.close(toastId(id))
  const running = snapshot.running.filter((o) => o.id !== id)
  publish({ running })
  if (running.length > 0) return
  window.clearTimeout(endTimer)
  endTimer = window.setTimeout(() => {
    if (snapshot.running.length === 0) publish({ busy: false })
  }, PROGRESS_END_DELAY)
}

let nextHold = -1

/** Marks a multi-step command (Sync = pull then push) as one running operation from start to
 * end, the way VS Code runs it, so the button, progress and busy state don't blink off in the
 * gaps between its git calls. Returns the release function. */
export function holdOp(repo: string, kind: OpKind, label: string): () => void {
  const id = nextHold--
  started({ id, repo, kind, label })
  let released = false
  return () => {
    if (released) return
    released = true
    finished(id)
  }
}

/** The operations running in the windows' repositories (not background fetches). */
export function useRunningOps(): RunningOp[] {
  return useSyncExternalStore(subscribe, () => snapshot.running)
}

/** Whether VS Code would show Source Control progress now. */
export function useOpsBusy(): boolean {
  return useSyncExternalStore(subscribe, () => snapshot.busy)
}

/** One short line for a git failure: git's own message with URLs and paths cut to the repo or
 * file name (they're what makes it long), without the "fatal:"/"remote:" prefix. */
export function errorText(error: IpcError): string {
  if (error.kind === 'alreadyRunning') return t('error.alreadyRunning', error.message.replace(/ is already running$/, ''))
  const name = (path: string) => path.replace(/\/+$/, '').split(/[/:]/).pop()?.replace(/\.git$/, '') ?? path
  const text = error.message
    .replace(/'?((?:https?|ssh|git):\/\/[^\s']+|[\w.-]+@[\w.-]+:[^\s']+)'?/g, (_, url: string) => name(url))
    .replace(/'(\/[^']+)'/g, (_, path: string) => name(path))
    .replace(/^(?:fatal|error|remote):\s*/i, '')
    .trim()
  return `Git: ${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

/** Listens for operations; mounted once per window that shows them. Renders nothing. */
export function Operations() {
  useLocale()
  const client = useQueryClient()
  const running = useRunningOps()

  useTauriEvent<OpStarted>('op://started', (op) => {
    if (!op.background) started({ id: op.id, repo: op.repo, kind: op.kind, label: op.label })
  })
  useTauriEvent<OpFinished>('op://finished', (op) => {
    finished(op.id)
    // A write finished: re-read now rather than waiting for the file watcher
    void client.invalidateQueries({ queryKey: ['repo', op.repo] })
    if (op.error && op.error.kind !== 'cancelled' && !op.background) {
      toastManager.add({ type: 'error', title: errorText(op.error) })
    }
  })

  const busy = useOpsBusy()
  useEffect(() => setContext('operationInProgress', running.length > 0 || busy), [running.length, busy])
  return null
}
