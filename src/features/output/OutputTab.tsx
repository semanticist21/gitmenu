// The Git output, like VS Code's Output view on its Git channel: each git command the app ran,
// how long it took and what git wrote to stderr, colored by VS Code's log grammar. With
// `failure`, one failed operation's commands, the way an error's Show Command Output shows them.
// The lines are virtualized and only the ones on screen are tokenized, so a new command costs
// one appended entry however long the log is.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useDarkMode } from '@/features/diff/DiffTab'
import { useHighlight } from '@/features/diff/highlight'
import { t } from '@/i18n'
import { type GitLogEntry, ipc, useTauriEvent } from '@/lib/ipc'
import type { DetailTabProps } from '@/routes/detail/DetailApp'
import { ActionButton, EditorActions } from '@/routes/detail/EditorChrome'
import { CODE_LINE_HEIGHT } from '@/theme/metrics'
import type { TokenLine } from '@/workers/shiki.worker'
import { appendEntry, commandLines, highlightRange, logLines } from './log'

const LOG_KEY = ['gitLog']

/** The log's padding above the first line and below the last, so the virtualizer owns the height */
const PADDING = 4

const NO_LINES: string[] = []

export function outputLabel(params: URLSearchParams) {
  return params.get('title') ?? t('detail.output')
}

function useLogLines(failure: string | null, legacy: boolean): string[] {
  const client = useQueryClient()
  // The log is read fresh on every mount, so it never shows a copy from while the tab was closed
  const log = useQuery({ queryKey: LOG_KEY, queryFn: ipc.gitLogEntries, staleTime: 0, refetchOnMount: 'always', enabled: !failure && !legacy })
  const fetching = log.isFetching
  // The event carries the whole entry, so the log grows by it; invalidating instead refetched
  // every entry and rebuilt every line on each git command, background fetches included
  useTauriEvent<GitLogEntry>('git-log://entry', (entry) => {
    if (failure || legacy) return
    // A read already in flight answers from a snapshot taken before this entry
    if (fetching) void client.invalidateQueries({ queryKey: LOG_KEY })
    else client.setQueryData<GitLogEntry[]>(LOG_KEY, (prev) => appendEntry(prev, entry))
  })
  // A failure's output never changes
  const kept = useQuery({
    queryKey: ['gitLogFailure', failure],
    queryFn: () => ipc.gitLogFailure(failure ?? ''),
    staleTime: Infinity,
    enabled: Boolean(failure),
  })
  const lines = useMemo(() => (log.data ? logLines(log.data) : null), [log.data])
  const keptLines = useMemo(() => (kept.data ? commandLines(kept.data) : null), [kept.data])
  // Tabs from before failures were kept by key point at nothing
  if (legacy) return [t('output.gone')]
  if (failure) return kept.isPending ? NO_LINES : (keptLines ?? [t('output.gone')])
  return lines ?? NO_LINES
}

export function OutputTab({ params }: DetailTabProps) {
  const client = useQueryClient()
  const dark = useDarkMode()
  const failure = params.get('failure')
  const legacy = params.has('op')
  const lines = useLogLines(failure, legacy)

  // The log follows new output while scrolled to the end, like the Output view's auto
  // scrolling; one operation's output opens at its top, like the document VS Code opens
  const single = Boolean(failure) || legacy
  const scrollRef = useRef<HTMLDivElement>(null)
  const atEnd = useRef(!single)
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CODE_LINE_HEIGHT,
    overscan: 12,
    paddingStart: PADDING,
    paddingEnd: PADDING,
  })
  const total = virtualizer.getTotalSize()
  useLayoutEffect(() => {
    // The virtualizer's total size is the scroll height, so following the end reads no layout
    const el = scrollRef.current
    if (el && atEnd.current) el.scrollTop = total
  }, [total])

  // Only the block of lines on screen is tokenized: the whole log went through the same Shiki
  // worker the diff tabs use, once per command
  const [start, end] = highlightRange(virtualizer.range, lines.length)
  const shown = useMemo(() => lines.slice(start, end).join('\n'), [lines, start, end])
  const tokens = useHighlight(shown, 'git.log', dark)
  // The tokens of the block stay on screen while the next ones are made, so appending a line
  // does not blink the log plain
  const last = useRef<{ key: string; tokens: TokenLine[] } | null>(null)
  const key = `${start}\0${dark}`
  useEffect(() => {
    if (tokens) last.current = { key, tokens }
  }, [key, tokens])
  const colored = tokens ?? (last.current?.key === key ? last.current.tokens : null)

  // Long lines scroll sideways rather than wrap, like the Output view with word wrap off; the
  // widest line sets the width, in characters of the editor's monospace font
  const width = useMemo(() => lines.reduce((max, line) => Math.max(max, line.length), 0), [lines])

  return (
    <>
      {!single && (
        <EditorActions>
          <ActionButton
            icon="clear-all"
            label={t('output.clear')}
            onClick={() => {
              void ipc.gitLogClear()
              client.setQueryData<GitLogEntry[]>(LOG_KEY, [])
            }}
          />
        </EditorActions>
      )}
      <div
        ref={scrollRef}
        role="log"
        aria-label={outputLabel(params)}
        tabIndex={0}
        className="h-full overflow-auto bg-editor ps-5 pe-3.5 font-editor text-editor-foreground text-code select-text"
        onScroll={(e) => {
          const el = e.currentTarget
          atEnd.current = !single && el.scrollTop + el.clientHeight >= el.scrollHeight - PADDING
        }}
      >
        <div className="relative min-w-full" style={{ height: total, width: `${width}ch` }}>
          {virtualizer.getVirtualItems().map((item) => (
            <div key={item.key} className="absolute inset-x-0 whitespace-pre" style={{ top: item.start, height: item.size }}>
              {colored?.[item.index - start]
                ? colored[item.index - start].map(([content, color, style], j) => (
                    <span
                      key={j}
                      style={{ color: color || undefined, fontStyle: style & 1 ? 'italic' : undefined, fontWeight: style & 2 ? 600 : undefined }}
                    >
                      {content}
                    </span>
                  ))
                : lines[item.index]}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
