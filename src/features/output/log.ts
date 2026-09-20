// The Git output log as lines: VS Code's Git channel format, the list the tab keeps in memory
// and the block of lines that gets tokenized. Lines, not one string, so the tab can render the
// ones on screen without splitting the whole log again.
import type { GitLogEntry } from '@/lib/ipc'

/** Commands kept on screen; `KEEP` in src-tauri/src/output.rs keeps the same number in Rust. */
export const KEEP = 500

/**
 * Lines tokenized at once: the rows on screen, rounded out to whole blocks. Scrolling inside a
 * block asks for nothing, and a new command re-tokenizes its block instead of the whole log.
 */
export const BLOCK = 200

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** The log channel's timestamp: `2026-09-19 19:40:12.123` */
function stamp(ms: number) {
  const d = new Date(ms)
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

const command = (entry: GitLogEntry) => `> git ${entry.args.join(' ')} [${entry.durationMs}ms]${entry.cancelled ? ' (cancelled)' : ''}`

/** VS Code's Git channel logs a command when it exits: `<time> [info] > git pull [812ms]`, then its stderr */
export function logLines(entries: GitLogEntry[]): string[] {
  const lines: string[] = []
  for (const entry of entries) {
    const time = stamp(entry.time + entry.durationMs)
    lines.push(`${time} [info] ${command(entry)}`)
    const stderr = entry.stderr.trimEnd()
    if (stderr) lines.push(...`${time} [info] ${stderr}`.split('\n'))
  }
  return lines
}

/** Show Command Output: `> git <args>` and its stderr, per command of the operation */
export function commandLines(entries: GitLogEntry[]): string[] {
  return entries.flatMap((entry, i) => [
    ...(i > 0 ? [''] : []),
    `> git ${entry.args.join(' ')}`,
    ...entry.stderr.trimEnd().split('\n'),
  ])
}

/**
 * The log after a `git-log://entry`: the entry the event carried, appended. The event already
 * holds everything the log shows, so a new command costs one entry, not a refetch.
 */
export function appendEntry(prev: GitLogEntry[] | undefined, entry: GitLogEntry): GitLogEntry[] {
  const next = [...(prev ?? []), entry]
  return next.length > KEEP ? next.slice(next.length - KEEP) : next
}

/** The lines to tokenize for the rows in `range`, as `[start, end)` block bounds. */
export function highlightRange(range: { startIndex: number; endIndex: number } | null, count: number): [number, number] {
  if (count === 0) return [0, 0]
  const first = Math.min(Math.max(range?.startIndex ?? 0, 0), count - 1)
  const last = Math.min(Math.max(range?.endIndex ?? 0, first), count - 1)
  return [Math.floor(first / BLOCK) * BLOCK, Math.min(count, (Math.floor(last / BLOCK) + 1) * BLOCK)]
}
