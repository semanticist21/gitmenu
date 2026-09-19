// The Git output, like VS Code's Output view on its Git channel: each git command the app ran,
// how long it took and what git wrote to stderr, colored by VS Code's log grammar. With `op`,
// only that operation's commands, the way an error's Show Command Output shows them.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useRef } from 'react'
import { useDarkMode } from '@/features/diff/DiffTab'
import { useHighlight } from '@/features/diff/highlight'
import { t } from '@/i18n'
import { type GitLogEntry, ipc, useTauriEvent } from '@/lib/ipc'
import type { DetailTabProps } from '@/routes/detail/DetailApp'
import { ActionButton, EditorActions } from '@/routes/detail/EditorChrome'

const QUERY_KEY = ['gitLog']

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** The log channel's timestamp: `2026-09-19 19:40:12.123` */
function stamp(ms: number) {
  const d = new Date(ms)
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

const command = (entry: GitLogEntry) =>
  `> git ${entry.args.join(' ')} [${entry.durationMs}ms]${entry.code === null ? ' (cancelled)' : ''}`

/** VS Code's Git channel: `<time> [info] > git pull [812ms]`, then git's stderr as written */
export function logText(entries: GitLogEntry[]): string {
  const lines: string[] = []
  for (const entry of entries) {
    lines.push(`${stamp(entry.time)} [info] ${command(entry)}`)
    const stderr = entry.stderr.trimEnd()
    if (stderr) lines.push(`${stamp(entry.time + entry.durationMs)} [info] ${stderr}`)
  }
  return lines.join('\n')
}

/** Show Command Output: `> git <args>` and its stderr, per command of the operation */
export function commandText(entries: GitLogEntry[]): string {
  return entries.map((entry) => `> git ${entry.args.join(' ')}\n${entry.stderr.trimEnd()}`).join('\n\n')
}

export function outputLabel(params: URLSearchParams) {
  return params.get('title') ?? t('detail.output')
}

export function OutputTab({ params }: DetailTabProps) {
  const client = useQueryClient()
  const dark = useDarkMode()
  const op = params.get('op')
  const { data: entries = [] } = useQuery({ queryKey: QUERY_KEY, queryFn: ipc.gitLogEntries, staleTime: Infinity })
  useTauriEvent<GitLogEntry>('git-log://entry', (entry) => {
    client.setQueryData<GitLogEntry[]>(QUERY_KEY, (prev) => [...(prev ?? []), entry])
  })
  const shown = op ? entries.filter((entry) => String(entry.op) === op) : entries
  const text = op ? commandText(shown) : logText(shown)
  const tokens = useHighlight(text, 'git.log', dark)

  // The log follows new output while scrolled to the end, like the Output view's auto
  // scrolling; one command's output opens at its top, like the document VS Code opens
  const scrollRef = useRef<HTMLDivElement>(null)
  const atEnd = useRef(!op)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && atEnd.current) el.scrollTop = el.scrollHeight
  }, [text, tokens])

  return (
    <>
      {!op && (
        <EditorActions>
          <ActionButton
            icon="clear-all"
            label={t('output.clear')}
            onClick={() => {
              void ipc.gitLogClear()
              client.setQueryData<GitLogEntry[]>(QUERY_KEY, [])
            }}
          />
        </EditorActions>
      )}
      <div
        ref={scrollRef}
        role="log"
        aria-label={outputLabel(params)}
        tabIndex={0}
        className="h-full overflow-auto bg-(--vsc-editor-background) py-1 ps-5 pe-3.5 font-mono text-(--vsc-editor-foreground) text-[12px] leading-[18px] select-text"
        onScroll={(e) => {
          const el = e.currentTarget
          atEnd.current = !op && el.scrollTop + el.clientHeight >= el.scrollHeight - 4
        }}
      >
        {text.split('\n').map((line, i) => (
          <div key={i} className="min-h-[18px] wrap-break-word whitespace-pre-wrap">
            {tokens?.[i]
              ? tokens[i].map(([content, color, style], j) => (
                  <span
                    key={j}
                    style={{ color: color || undefined, fontStyle: style & 1 ? 'italic' : undefined, fontWeight: style & 2 ? 600 : undefined }}
                  >
                    {content}
                  </span>
                ))
              : line}
          </div>
        ))}
      </div>
    </>
  )
}
