// Renders a text diff side by side or inline, virtualized, with syntax colors, block actions
// in the gutter, selectable lines (click a line number, ⇧-click to extend), and optional blame.
import { useVirtualizer } from '@tanstack/react-virtual'
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { t, useLocale, vsb } from '@/i18n'
import type { BlameResult, DiffResult } from '@/lib/git'
import { cn } from '@/lib/utils'
import { useSetting } from '@/settings/settings'
import type { TokenLine } from '@/workers/shiki.worker'
import { useHighlight } from './highlight'
import { inlineRows, pairRows } from './model'
import { type LineSelection, splitLines } from './patch'

const ROW = 19
const CHAR = 7.23
const GUTTER = 48

interface Props {
  result: DiffResult
  path: string
  leftPath: string
  sideBySide: boolean
  dark: boolean
  selection: LineSelection
  onSelectLine: (side: 'left' | 'right', line: number, extend: boolean) => void
  /** Buttons for a change block, shown on its first row */
  blockActions?: (hunk: number) => ReactNode
  blame?: BlameResult | null
  /** Scroll to this change (index into hunks) when it changes */
  focusHunk?: number
  /** One file, no comparison (file at a revision): hides the left gutter */
  single?: boolean
}

function relativeTime(seconds: number, locale: string) {
  const diff = seconds - Date.now() / 1000
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, size] of units) if (Math.abs(diff) >= size) return format.format(Math.round(diff / size), unit)
  return format.format(0, 'minute')
}

function Code({ text, tokens, limit }: { text: string | undefined; tokens: TokenLine | undefined; limit: number }) {
  if (text === undefined) return null
  if (!tokens) return <>{text.length > limit ? `${text.slice(0, limit)}…` : text}</>
  let used = 0
  const parts: ReactNode[] = []
  for (const [i, [content, color, style]] of tokens.entries()) {
    if (used >= limit) {
      parts.push('…')
      break
    }
    const piece = content.slice(0, limit - used)
    used += piece.length
    parts.push(
      <span
        key={i}
        style={{
          color: color || undefined,
          fontStyle: style & 1 ? 'italic' : undefined,
          fontWeight: style & 2 ? 600 : undefined,
          textDecoration: style & 4 ? 'underline' : undefined,
        }}
      >
        {piece}
      </span>,
    )
  }
  return <>{parts}</>
}

export function DiffView({ result, path, leftPath, sideBySide, dark, selection, onSelectLine, blockActions, blame, focusHunk, single }: Props) {
  const locale = useLocale()
  const limit = useSetting<number>('editor.stopRenderingLineAfter')
  const left = useMemo(() => splitLines(result.left.text ?? ''), [result.left.text])
  const right = useMemo(() => splitLines(result.right.text ?? ''), [result.right.text])
  const leftTokens = useHighlight(result.left.text, leftPath, dark)
  const rightTokens = useHighlight(result.right.text, path, dark)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const pairs = useMemo(() => (sideBySide ? pairRows(left.length, right.length, result.hunks) : []), [sideBySide, left.length, right.length, result.hunks])
  const inline = useMemo(() => (sideBySide ? [] : inlineRows(left.length, right.length, result.hunks)), [sideBySide, left.length, right.length, result.hunks])
  const count = sideBySide ? pairs.length : inline.length

  // Blame per right-side line: the range start line shows author and date
  const blameAt = useMemo(() => {
    const map = new Map<number, { commit: string | null; first: boolean }>()
    for (const range of blame?.ranges ?? []) {
      for (let i = 0; i < range.len; i++) map.set(range.start + i, { commit: range.commit, first: i === 0 })
    }
    return map
  }, [blame])
  const blameWidth = blame ? 190 : 0

  const longest = (lines: string[]) => Math.min(limit, lines.reduce((max, l) => Math.max(max, l.length), 0))
  const sideWidth = (lines: string[]) => Math.max(sideBySide ? (width - blameWidth) / 2 : width - blameWidth, GUTTER + longest(lines) * CHAR + 24)
  const leftWidth = sideBySide ? sideWidth(left) : 0
  const rightWidth = sideBySide ? sideWidth(right) : Math.max(sideWidth(left), sideWidth(right)) + GUTTER

  const virtualizer = useVirtualizer({ count, getScrollElement: () => scrollRef.current, estimateSize: () => ROW, overscan: 30 })

  useLayoutEffect(() => {
    if (focusHunk === undefined) return
    const index = sideBySide ? pairs.findIndex((r) => r.hunk === focusHunk) : inline.findIndex((r) => r.hunk === focusHunk)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'center' })
  }, [focusHunk, sideBySide, pairs, inline, virtualizer])

  const lineNumber = (side: 'left' | 'right', line: number | null, extra = '') => {
    if (line === null) return <span className={cn('w-12 shrink-0 select-none', extra)} />
    const selected = selection[side].has(line)
    return (
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('diff.selectLine', line + 1)}
        aria-pressed={selected}
        className={cn(
          'w-12 shrink-0 select-none pe-2 text-end text-muted-foreground/70 tabular-nums hover:text-foreground',
          selected && 'bg-primary/20 text-foreground',
          extra,
        )}
        onClick={(e) => onSelectLine(side, line, e.shiftKey)}
      >
        {line + 1}
      </button>
    )
  }

  const blameCell = (line: number | null) => {
    if (!blame) return null
    const info = line === null ? undefined : blameAt.get(line)
    const commit = info?.commit ? blame.commits[info.commit] : undefined
    return (
      <div
        className="sticky start-0 z-[1] flex shrink-0 items-center gap-1 overflow-hidden border-e bg-background px-2 font-sans text-[11px] text-muted-foreground"
        style={{ width: blameWidth }}
        title={commit ? `${commit.author} · ${commit.id.slice(0, 8)}\n${commit.summary}` : undefined}
      >
        {info?.first &&
          (commit ? (
            <>
              <span className="min-w-0 flex-1 truncate">{commit.author}</span>
              <span className="shrink-0">{relativeTime(commit.time, locale)}</span>
            </>
          ) : (
            <span className="truncate italic">{vsb('Not Committed Yet')}</span>
          ))}
      </div>
    )
  }

  const changeBg = (kind: 'removed' | 'added', selected: boolean) =>
    kind === 'removed'
      ? selected
        ? 'bg-[var(--diff-removed-strong)]'
        : 'bg-[var(--diff-removed)]'
      : selected
        ? 'bg-[var(--diff-added-strong)]'
        : 'bg-[var(--diff-added)]'

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-auto font-mono text-[12px] leading-[19px]"
      data-context={JSON.stringify({ gitsideDiffFocus: true })}
      tabIndex={0}
      role="document"
      aria-label={path}
    >
      <div className="relative" style={{ height: virtualizer.getTotalSize(), width: blameWidth + leftWidth + rightWidth }}>
        {virtualizer.getVirtualItems().map((item) => {
          const style = { transform: `translateY(${item.start}px)`, height: ROW }
          if (sideBySide) {
            const row = pairs[item.index]
            const leftSel = row.left !== null && selection.left.has(row.left)
            const rightSel = row.right !== null && selection.right.has(row.right)
            return (
              <div key={item.key} className="absolute inset-x-0 top-0 flex whitespace-pre" style={style}>
                {blameCell(row.right)}
                <div
                  className={cn(
                    'relative flex shrink-0 border-e',
                    row.kind === 'change' && (row.left !== null ? changeBg('removed', leftSel) : 'diff-filler'),
                  )}
                  style={{ width: leftWidth }}
                >
                  {lineNumber('left', row.left)}
                  <span className="min-w-0 ps-1">
                    <Code text={row.left === null ? undefined : left[row.left]} tokens={row.left === null ? undefined : leftTokens?.[row.left]} limit={limit} />
                  </span>
                </div>
                <div
                  className={cn('relative flex shrink-0', row.kind === 'change' && (row.right !== null ? changeBg('added', rightSel) : 'diff-filler'))}
                  style={{ width: rightWidth }}
                >
                  {lineNumber('right', row.right)}
                  <span className="min-w-0 ps-1">
                    <Code text={row.right === null ? undefined : right[row.right]} tokens={row.right === null ? undefined : rightTokens?.[row.right]} limit={limit} />
                  </span>
                  {row.hunkStart && blockActions && row.hunk !== null && (
                    <div className="sticky end-2 ms-auto flex items-center gap-0.5 self-start font-sans">{blockActions(row.hunk)}</div>
                  )}
                </div>
              </div>
            )
          }
          const row = inline[item.index]
          const selected = row.side === 'left' ? row.left !== null && selection.left.has(row.left) : row.right !== null && selection.right.has(row.right)
          const text = row.side === 'left' ? left[row.left!] : right[row.right!]
          const tokens = row.side === 'left' ? leftTokens?.[row.left!] : rightTokens?.[row.right!]
          return (
            <div
              key={item.key}
              className={cn(
                'absolute inset-x-0 top-0 flex whitespace-pre',
                row.side === 'left' && changeBg('removed', selected),
                row.side === 'right' && changeBg('added', selected),
              )}
              style={style}
            >
              {blameCell(row.right)}
              {!single && lineNumber('left', row.side === 'right' ? null : row.left)}
              {lineNumber('right', row.side === 'left' ? null : row.right)}
              {!single && (
                <span className="w-4 shrink-0 select-none text-center text-muted-foreground">
                  {row.side === 'left' ? '−' : row.side === 'right' ? '+' : ''}
                </span>
              )}
              <span className="min-w-0">
                <Code text={text} tokens={tokens} limit={limit} />
              </span>
              {row.hunkStart && blockActions && row.hunk !== null && (
                <div className="sticky end-2 ms-auto flex items-center gap-0.5 font-sans">{blockActions(row.hunk)}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
