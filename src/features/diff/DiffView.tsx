// Renders a text diff (or one file) the way VS Code's diff editor draws it
// (editor/browser/widget/diffEditor): Menlo 12px on 18px lines; each side's gutter is an 18px
// glyph margin, line numbers at least 5 digits wide and a 10px column holding the +/- sign;
// changed lines get the inserted/removed line color and changed characters the stronger text
// color. Side by side above 900px, inline below. Block actions sit in a 35px gutter between the
// sides and fade in on hover; a 30px overview ruler marks the changes. GitLens's file blame
// draws in front of each line. Rows are virtualized; both sides share one vertical scroll and
// scroll sideways on their own.
import { useVirtualizer } from '@tanstack/react-virtual'
import { type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { Avatar } from '@/features/avatars/Avatar'
import { t, useLocale, vsb } from '@/i18n'
import type { BlameResult, DiffResult } from '@/lib/git'
import { fullDate, relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useSetting } from '@/settings/settings'
import type { TokenLine } from '@/workers/shiki.worker'
import { type CharRange, charChanges } from './chars'
import { useHighlight } from './highlight'
import { collapseRows, type HiddenRow, inlineRows, pairRows } from './model'
import { type LineSelection, splitLines } from './patch'

const ROW = 18
const HIDDEN_ROW = 24
const GLYPH = 18
const DECORATIONS = 10
const FOLDING = 16
const HUNK_GUTTER = 35
const OVERVIEW = 30
const INLINE_BREAKPOINT = 900
const BEYOND_LAST_COLUMN = 4
const MIN_PANE = 100
// GitLens gutter blame: `${message|50?} ${agoOrDate|14-}` is 65 characters, plus 3 of padding
const BLAME_CHARS = 68
const MIN_BLAME_CHARS = 24
const BLAME_MARGIN = 26

export interface GutterAction {
  icon: string
  label: string
  run: () => void
}

type Side = 'left' | 'right'

interface LineRow {
  hidden?: undefined
  kind: 'same' | 'change'
  /** Inline rows show one side's line; side-by-side rows show both */
  side: 'left' | 'right' | 'both'
  left: number | null
  right: number | null
  hunk: number | null
}

type Row = LineRow | HiddenRow

interface Props {
  /** Repository root (for avatars) */
  root: string
  result: DiffResult
  path: string
  leftPath: string
  /** diffEditor.renderSideBySide; narrow editors still render inline */
  sideBySide: boolean
  dark: boolean
  selection: LineSelection
  /** The line last clicked (VS Code's cursor line) */
  anchor: { side: Side; line: number } | null
  onSelectLine: (side: Side, line: number, extend: boolean) => void
  /** Actions for a change block, shown in the gutter between the sides */
  hunkActions?: (hunk: number, inline: boolean) => GutterAction[]
  /** Actions for selected lines, shown instead of the block actions while lines are selected */
  selectionActions?: (inline: boolean) => GutterAction[]
  blame?: BlameResult | null
  /** Scroll to this change (index into hunks) when it changes */
  focusHunk?: number
  collapseUnchanged?: boolean
  /** One file, no comparison (a file at a revision) */
  single?: boolean
}

let measuredChar = 0
/** Advance of a digit in the editor font (editor fontInfo's maxDigitWidth). */
function charWidth() {
  if (!measuredChar) {
    const context = document.createElement('canvas').getContext('2d')
    if (context) {
      context.font = '12px Menlo, Monaco, "Courier New", monospace'
      measuredChar = context.measureText('0').width
    }
    measuredChar ||= 7.224
  }
  return measuredChar
}

const lineNumbersWidth = (lines: number) => Math.round(Math.max(5, String(lines).length) * charWidth())

// Inner changes per hunk, computed when a changed line first renders
const innerCache = new WeakMap<DiffResult, Map<string, [CharRange[], CharRange[]]>>()
function innerChanges(result: DiffResult, key: string, a: string, b: string) {
  let map = innerCache.get(result)
  if (!map) innerCache.set(result, (map = new Map()))
  let value = map.get(key)
  if (!value) map.set(key, (value = charChanges(a, b)))
  return value
}

// GitLens heatmap: 10 hot shades for the last 90 days, 10 cold ones for older lines
const HEAT = [
  '#f66a0a', '#ef6939', '#e96950', '#e26862', '#db6871', '#d3677e', '#cc678a', '#c46696', '#bb66a0', '#b365a9',
  '#a965b3', '#a064bb', '#9664c4', '#8a63cc', '#7e63d3', '#7162db', '#6262e2', '#5062e9', '#3961ef', '#0a60f6',
]
const HOT_DAYS = 90
const nowSeconds = () => Date.now() / 1000

function heatColors(blame: BlameResult): Map<string, string> {
  const threshold = nowSeconds() - HOT_DAYS * 86400
  const times = Object.values(blame.commits).map((c) => c.time)
  const hot = times.filter((time) => time >= threshold).sort((a, b) => b - a)
  const cold = times.filter((time) => time < threshold).sort((a, b) => b - a)
  const bucket = (sorted: number[], time: number) => (sorted.length <= 1 ? 0 : Math.min(9, Math.floor((sorted.indexOf(time) / (sorted.length - 1)) * 9)))
  const colors = new Map<string, string>()
  for (const [id, commit] of Object.entries(blame.commits)) {
    colors.set(id, commit.time >= threshold ? HEAT[bucket(hot, commit.time)] : HEAT[10 + bucket(cold, commit.time)])
  }
  return colors
}

/**
 * Text with syntax colors, the changed character ranges in `strong` and, for insertion points,
 * VS Code's 3px bar.
 */
function Code({ text, tokens, limit, ranges, strong }: { text: string; tokens: TokenLine | undefined; limit: number; ranges: CharRange[]; strong: string }) {
  const segments: [string, string, number][] = tokens ?? [[text, '', 0]]
  const parts: ReactNode[] = []
  let offset = 0
  let r = 0
  const marker = (key: string) => (
    <span key={key} className="inline-block h-[18px] align-top" style={{ borderLeft: `3px solid ${strong}`, marginLeft: -1 }} />
  )
  for (const [i, [content, color, style]] of segments.entries()) {
    if (offset >= limit) break
    const piece = content.slice(0, limit - offset)
    const css: CSSProperties = {
      color: color || undefined,
      fontStyle: style & 1 ? 'italic' : undefined,
      fontWeight: style & 2 ? 600 : undefined,
      textDecoration: style & 4 ? 'underline' : undefined,
    }
    // Split the token where a changed range starts or ends
    let at = 0
    while (at < piece.length) {
      const pos = offset + at
      // Skip ranges behind the cursor (an insertion point exactly here is drawn next)
      while (r < ranges.length && (ranges[r][1] < pos || (ranges[r][1] === pos && ranges[r][0] !== ranges[r][1]))) r++
      const range = ranges[r]
      if (range && range[0] === range[1] && range[0] === pos) {
        parts.push(marker(`m${r}`))
        r++
        continue
      }
      const inRange = range !== undefined && range[0] <= pos && pos < range[1]
      const end = range === undefined ? piece.length : Math.min(piece.length, (inRange ? range[1] : range[0]) - offset)
      parts.push(
        <span key={`${i}:${at}`} style={inRange ? { ...css, backgroundColor: strong } : css}>
          {piece.slice(at, end)}
        </span>,
      )
      at = end
    }
    offset += piece.length
  }
  // An insertion point at the end of the line
  for (; r < ranges.length; r++) if (ranges[r][0] === ranges[r][1] && ranges[r][0] >= offset) parts.push(marker(`m${r}`))
  if (text.length > limit) parts.push('…')
  return <>{parts}</>
}

/** A 12px horizontal scrollbar (VS Code's editor scrollbar: square slider, shown on hover). */
function HScrollbar({ left, width, content, value, onChange }: { left: number; width: number; content: number; value: number; onChange: (value: number) => void }) {
  const drag = useRef<{ x: number; value: number } | null>(null)
  if (content <= width || width <= 0) return null
  const slider = Math.max(20, (width * width) / content)
  const max = content - width
  const position = (value / max) * (width - slider)
  const toValue = (px: number) => Math.min(max, Math.max(0, (px / (width - slider)) * max))
  return (
    <div
      className="absolute bottom-0 z-[11] h-3 opacity-0 transition-opacity duration-[800ms] ease-linear group-hover/editor:opacity-100 group-hover/editor:duration-100"
      style={{ left, width }}
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return
        onChange(toValue(e.nativeEvent.offsetX - slider / 2))
      }}
    >
      <div
        className="absolute inset-y-0 bg-(--vsc-scrollbarSlider-background) hover:bg-(--vsc-scrollbarSlider-hoverBackground) active:bg-(--vsc-scrollbarSlider-activeBackground)"
        style={{ left: position, width: slider }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, value }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          onChange(Math.min(max, Math.max(0, drag.current.value + ((e.clientX - drag.current.x) * max) / (width - slider))))
        }}
        onPointerUp={() => {
          drag.current = null
        }}
      />
    </div>
  )
}

/** The diff overview ruler: removed ranges on the left half, inserted on the right, the viewport on top. */
function OverviewRuler({
  marks,
  total,
  scrollTop,
  viewport,
  onScroll,
}: {
  marks: { side: Side; top: number; height: number }[]
  total: number
  scrollTop: number
  viewport: number
  onScroll: (top: number) => void
}) {
  const [height, setHeight] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(() => setHeight(el.clientHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const scale = total > 0 ? height / total : 0
  const slider = Math.max(20, viewport * scale)
  const scrollTo = (e: ReactPointerEvent<HTMLDivElement>) => {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top
    onScroll(Math.max(0, (y - slider / 2) / scale))
  }
  return (
    <div
      ref={ref}
      aria-hidden
      className="absolute inset-y-0 right-0 z-[9] bg-black/[.03] dark:bg-white/[.01]"
      style={{ width: OVERVIEW }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        scrollTo(e)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) scrollTo(e)
      }}
    >
      {marks.map((mark, i) => (
        <div
          key={i}
          className={cn('absolute', mark.side === 'left' ? 'left-0 bg-(--diff-overview-removed)' : 'right-0 bg-(--diff-overview-added)')}
          style={{ top: mark.top * scale, height: Math.max(2, mark.height * scale), width: OVERVIEW / 2 }}
        />
      ))}
      {total > viewport && (
        <div
          className="absolute inset-x-0 z-10 bg-(--vsc-scrollbarSlider-background) hover:bg-(--vsc-scrollbarSlider-hoverBackground) active:bg-(--vsc-scrollbarSlider-activeBackground)"
          style={{ top: scrollTop * scale, height: slider }}
        />
      )}
    </div>
  )
}

export function DiffView({
  root,
  result,
  path,
  leftPath,
  sideBySide: sideBySideSetting,
  dark,
  selection,
  anchor,
  onSelectLine,
  hunkActions,
  selectionActions,
  blame,
  focusHunk,
  collapseUnchanged = false,
  single = false,
}: Props) {
  const locale = useLocale()
  const limit = useSetting<number>('editor.stopRenderingLineAfter')
  const left = useMemo(() => splitLines(result.left.text ?? ''), [result.left.text])
  const right = useMemo(() => splitLines(result.right.text ?? ''), [result.right.text])
  const leftTokens = useHighlight(single ? null : result.left.text, leftPath, dark)
  const rightTokens = useHighlight(result.right.text, path, dark)
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ root: 0, width: 0, height: 0 })
  const [ratio, setRatio] = useState(0.5)
  const [sashActive, setSashActive] = useState(false)
  const [scrollX, setScrollX] = useState<Record<Side, number>>({ left: 0, right: 0 })
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  const char = charWidth()

  useLayoutEffect(() => {
    const root = rootRef.current
    const scroller = scrollRef.current
    if (!root || !scroller) return
    const observer = new ResizeObserver(() => setSize({ root: root.clientWidth, width: scroller.clientWidth, height: scroller.clientHeight }))
    observer.observe(root)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  const sideBySide = !single && sideBySideSetting && size.root > INLINE_BREAKPOINT
  const showOverview = !single
  const showGutter = !single && hunkActions !== undefined

  // Display rows, folded when "Collapse Unchanged Regions" is on
  const rows = useMemo<Row[]>(() => {
    const base: LineRow[] = sideBySide
      ? pairRows(left.length, right.length, result.hunks).map((r) => ({ kind: r.kind, side: 'both', left: r.left, right: r.right, hunk: r.hunk }))
      : inlineRows(single ? 0 : left.length, right.length, single ? [] : result.hunks).map((r) => ({
          kind: r.side === 'both' ? 'same' : 'change',
          side: r.side,
          left: single ? null : r.left,
          right: r.right,
          hunk: r.hunk,
        }))
    return collapseUnchanged && !single ? collapseRows(base, (r) => r.kind === 'same', expanded) : base
  }, [sideBySide, single, left.length, right.length, result.hunks, collapseUnchanged, expanded])

  // Pixel offset of every row (folded regions are 24px), the rows of each hunk, and the row of each line
  const layout = useMemo(() => {
    const offsets = new Float64Array(rows.length + 1)
    const hunks = new Map<number, [number, number]>()
    const rowOfLeft = new Map<number, number>()
    const rowOfRight = new Map<number, number>()
    rows.forEach((row, i) => {
      offsets[i + 1] = offsets[i] + (row.hidden !== undefined ? HIDDEN_ROW : ROW)
      if (row.hidden !== undefined) return
      if (row.left !== null) rowOfLeft.set(row.left, i)
      if (row.right !== null) rowOfRight.set(row.right, i)
      if (row.hunk !== null) {
        const range = hunks.get(row.hunk)
        hunks.set(row.hunk, range ? [range[0], i + 1] : [i, i + 1])
      }
    })
    return { offsets, hunks, rowOfLeft, rowOfRight }
  }, [rows])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.hidden !== undefined ? HIDDEN_ROW : ROW),
    // editor.scrollBeyondLastLine: the last line can scroll to the top
    paddingEnd: Math.max(0, size.height - ROW),
    overscan: 20,
  })

  useLayoutEffect(() => {
    virtualizer.measure()
  }, [rows, virtualizer])

  useLayoutEffect(() => {
    if (focusHunk === undefined) return
    const range = layout.hunks.get(focusHunk)
    if (range) virtualizer.scrollToIndex(range[0], { align: 'center' })
  }, [focusHunk, layout, virtualizer])

  // Geometry
  const lnLeft = lineNumbersWidth(left.length)
  const lnRight = lineNumbersWidth(right.length)
  const width = size.width
  const gutterSpace = showGutter ? HUNK_GUTTER : 0
  const sashLeft = sideBySide ? Math.round(Math.min(width - MIN_PANE, Math.max(MIN_PANE + gutterSpace, width * ratio))) : 0
  const panes = sideBySide
    ? {
        left: { x: 0, width: sashLeft - gutterSpace, gutter: GLYPH + lnLeft + DECORATIONS },
        right: { x: sashLeft, width: width - sashLeft, gutter: GLYPH + lnRight + DECORATIONS },
      }
    : {
        left: null,
        right: {
          x: gutterSpace,
          width: width - gutterSpace,
          gutter: single ? GLYPH + lnRight + DECORATIONS + FOLDING : GLYPH + lnLeft + lnRight + DECORATIONS,
        },
      }
  // GitLens's blame gutter is 68 characters; in a narrow pane (side by side) it takes at most
  // 40% of the pane's text area so the code stays visible
  const paneText = Math.max(0, panes.right.width - panes.right.gutter)
  const blameWidth = Math.round(Math.max(MIN_BLAME_CHARS * char, Math.min(BLAME_CHARS * char, paneText * 0.4)) + 6)
  const blameSpace = blame ? blameWidth + BLAME_MARGIN : 0
  const gutterX = sideBySide ? sashLeft - gutterSpace : 0
  const longest = (lines: string[]) => Math.min(limit, lines.reduce((max, line) => Math.max(max, line.length), 0))
  const contentWidth = {
    left: sideBySide ? (longest(left) + BEYOND_LAST_COLUMN) * char : 0,
    right: blameSpace + (Math.max(longest(right), sideBySide ? 0 : longest(left)) + BEYOND_LAST_COLUMN) * char,
  }
  const viewportWidth = {
    left: panes.left ? Math.max(0, panes.left.width - panes.left.gutter) : 0,
    right: Math.max(0, panes.right.width - panes.right.gutter),
  }
  const maxScroll = (side: Side) => Math.max(0, contentWidth[side] - viewportWidth[side])
  // Content can shrink under a scrolled side (blame turned off): draw it clamped
  const sx = { left: Math.min(scrollX.left, maxScroll('left')), right: Math.min(scrollX.right, maxScroll('right')) }
  const setX = (side: Side, value: number) =>
    setScrollX((current) => {
      const next = Math.min(maxScroll(side), Math.max(0, value))
      return current[side] === next ? current : { ...current, [side]: next }
    })

  // A sideways wheel (or ⇧wheel) scrolls the side under the pointer; vertical scrolling stays native
  const wheel = useRef({ sideBySide, panes, setX, scrollX: sx })
  useLayoutEffect(() => {
    wheel.current = { sideBySide, panes, setX, scrollX: sx }
  })
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const onWheel = (event: WheelEvent) => {
      const horizontal = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
      if (!horizontal) return
      const { sideBySide, panes, setX, scrollX } = wheel.current
      const x = event.clientX - scroller.getBoundingClientRect().left
      const side: Side = sideBySide && panes.left && x < panes.left.width ? 'left' : 'right'
      const delta = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX
      event.preventDefault()
      setX(side, scrollX[side] + delta)
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => scroller.removeEventListener('wheel', onWheel)
  }, [])

  // Blame per right-side line: its commit and whether it starts a block
  const blameAt = useMemo(() => {
    const map = new Map<number, { commit: string | null; first: boolean }>()
    for (const range of blame?.ranges ?? []) {
      for (let i = 0; i < range.len; i++) map.set(range.start + i, { commit: range.commit, first: i === 0 })
    }
    return map
  }, [blame])
  const heat = useMemo(() => (blame ? heatColors(blame) : new Map<string, string>()), [blame])
  // GitLens highlights every line of the commit under the cursor
  const anchorCommit = blame && anchor?.side === 'right' ? blameAt.get(anchor.line)?.commit : undefined

  // The change under the cursor keeps its block actions visible (VS Code's current diff)
  const currentHunk = useMemo(() => {
    if (focusHunk !== undefined) return focusHunk
    if (!anchor) return undefined
    const row = (anchor.side === 'left' ? layout.rowOfLeft : layout.rowOfRight).get(anchor.line)
    return row === undefined ? undefined : ((rows[row] as LineRow | undefined)?.hunk ?? undefined)
  }, [focusHunk, anchor, layout, rows])

  const scrollTop = virtualizer.scrollOffset ?? 0
  const items = virtualizer.getVirtualItems()
  const totalHeight = virtualizer.getTotalSize()
  const inline = !sideBySide

  // ---- rendering pieces ----

  const selectionClass =
    'bg-[#e5ebf1] dark:bg-[#3a3d41] group-focus-within/editor:bg-[#add6ff] dark:group-focus-within/editor:bg-[#264f78]'

  const lineNumber = (side: Side, line: number | null, columnWidth: number) => {
    if (line === null) return <span className="shrink-0" style={{ width: columnWidth }} />
    const active = selection[side].has(line) || (anchor?.side === side && anchor.line === line)
    return (
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('diff.selectLine', line + 1)}
        aria-pressed={selection[side].has(line)}
        className={cn(
          'h-full shrink-0 cursor-default text-end tabular-nums outline-none',
          active ? 'text-(--vsc-editorLineNumber-activeForeground)' : 'text-(--vsc-editorLineNumber-foreground)',
        )}
        style={{ width: columnWidth }}
        // Clicking a line number focuses the editor, not the button (the selection turns active)
        onMouseDown={(e) => {
          e.preventDefault()
          scrollRef.current?.focus({ preventScroll: true })
        }}
        onClick={(e) => onSelectLine(side, line, e.shiftKey)}
      >
        {line + 1}
      </button>
    )
  }

  const sign = (kind: 'added' | 'removed' | null) => (
    <span className="flex shrink-0 items-center justify-center opacity-70" style={{ width: DECORATIONS }}>
      {kind && <Icon name={kind === 'added' ? 'add' : 'remove'} className="text-[11px]" />}
    </span>
  )

  const blameCell = (line: number | null, lineKind: 'blame' | 'spacer') => {
    if (!blame) return null
    if (lineKind === 'spacer' || line === null) return <span className="shrink-0" style={{ width: blameSpace }} />
    const info = blameAt.get(line)
    const commit = info?.commit ? blame.commits[info.commit] : undefined
    return (
      <span
        className={cn(
          'relative flex h-full shrink-0 items-center overflow-hidden border-r-2 bg-[#0000000c] ps-[18px] dark:bg-[#ffffff13]',
          commit ? 'text-[#747474] dark:text-[#bebebe]' : 'text-[#00bcf299]',
          info?.first && 'shadow-[inset_0_1px_0_rgba(0,0,0,.2)]',
          info?.commit && info.commit === anchorCommit && 'bg-[#00bcf233] dark:bg-[#00bcf233]',
        )}
        style={{ width: blameWidth, marginRight: BLAME_MARGIN, borderRightColor: info?.commit ? heat.get(info.commit) : 'transparent' }}
        title={commit ? `${commit.author}, ${relativeTime(commit.time, locale)} (${fullDate(commit.time, locale)})\n\n${commit.summary}\n${commit.id.slice(0, 8)}` : undefined}
      >
        {info?.first &&
          (commit ? (
            <>
              <Avatar root={root} name={commit.author} email={commit.email} sha={commit.id} className="absolute top-px left-px size-4 rounded-none" />
              <span className="min-w-0 flex-1 truncate">{commit.summary}</span>
              <span className="ms-[1ch] shrink-0" style={{ width: '14ch' }}>
                {relativeTime(commit.time, locale)}
              </span>
            </>
          ) : (
            <span className="truncate">{vsb('Not Committed Yet')}</span>
          ))}
      </span>
    )
  }

  /** The code area of one side of a row: backgrounds, the cursor-line box, blame and text. */
  const codeArea = (
    side: Side,
    line: number | null,
    opts: { kind: 'same' | 'added' | 'removed' | 'filler'; ranges: CharRange[]; whole: boolean; blame: 'blame' | 'spacer' | 'none'; gutter: number; unchanged: boolean },
  ) => {
    const lines = side === 'left' ? left : right
    const tokens = line === null ? undefined : (side === 'left' ? leftTokens : rightTokens)?.[line]
    const strong = opts.kind === 'removed' ? 'var(--diff-removed-strong)' : 'var(--diff-added-strong)'
    const selected = line !== null && selection[side].has(line)
    const isAnchor = line !== null && anchor?.side === side && anchor.line === line
    const sameCommit = line !== null && side === 'right' && anchorCommit && blameAt.get(line)?.commit === anchorCommit
    const scrollVar = sideBySide && side === 'left' ? '--sx-left' : '--sx-right'
    return (
      <div
        className={cn(
          'absolute inset-y-0 right-0 overflow-hidden',
          opts.kind === 'filler' && 'diff-filler',
          opts.unchanged && 'bg-(--diff-unchanged-code)',
          sameCommit && 'bg-[#00bcf233]',
        )}
        style={{
          left: opts.gutter,
          backgroundImage: opts.whole && (opts.kind === 'added' || opts.kind === 'removed') ? `linear-gradient(${strong}, ${strong})` : undefined,
        }}
      >
        {isAnchor && <span className="pointer-events-none absolute inset-0 border-2 border-(--vsc-editor-lineHighlightBorder)" />}
        {line !== null && (
          <div className="relative flex h-full w-max items-center whitespace-pre" style={{ transform: `translateX(calc(var(${scrollVar}) * -1))` }}>
            {opts.blame !== 'none' && blameCell(line, opts.blame)}
            <span className={cn('select-text', selected && selectionClass, selected && 'pe-1')}>
              <Code text={lines[line] ?? ''} tokens={tokens} limit={limit} ranges={opts.whole ? [] : opts.ranges} strong={strong} />
            </span>
          </div>
        )}
      </div>
    )
  }

  /** Changed ranges of a line pair in a hunk (lines without a partner are changed as a whole). */
  const pairRanges = (hunk: number, side: Side, line: number): { ranges: CharRange[]; whole: boolean } => {
    const h = result.hunks[hunk]
    const index = side === 'left' ? line - h.leftStart : line - h.rightStart
    if (index >= Math.min(h.leftCount, h.rightCount)) return { ranges: [], whole: true }
    const [l, r] = innerChanges(result, `${hunk}:${index}`, left[h.leftStart + index] ?? '', right[h.rightStart + index] ?? '')
    return { ranges: side === 'left' ? l : r, whole: false }
  }

  const hiddenRow = (row: HiddenRow, pane: { x: number; width: number; gutter: number }) => (
    <div
      className="absolute inset-y-0 flex items-center bg-(--diff-unchanged-region) text-[13px] leading-[14px] shadow-[inset_0_-5px_5px_-7px_#737373bf,inset_0_5px_5px_-7px_#737373bf] dark:shadow-[inset_0_-5px_5px_-7px_#000,inset_0_5px_5px_-7px_#000]"
      style={{ left: pane.x, width: pane.width }}
      onDoubleClick={() => setExpanded(new Set([...expanded, row.from]))}
    >
      <span className="flex shrink-0 justify-center" style={{ width: pane.gutter }}>
        <button
          type="button"
          aria-label="Show Unchanged Region"
          className="flex cursor-pointer rounded-[4px] text-inherit hover:text-(--vsc-textLink-activeForeground)"
          onClick={() => setExpanded(new Set([...expanded, row.from]))}
        >
          <Icon name="unfold" />
        </button>
      </span>
      <span className="min-w-0 flex-1 truncate text-center font-sans">{`${row.hidden} hidden lines`}</span>
    </div>
  )

  const renderRow = (row: Row): ReactNode => {
    if (row.hidden !== undefined) {
      return (
        <>
          {panes.left && hiddenRow(row, panes.left)}
          {hiddenRow(row, panes.right)}
        </>
      )
    }
    const unchanged = collapseUnchanged && row.kind === 'same'
    if (sideBySide && panes.left) {
      const change = row.kind === 'change' && row.hunk !== null
      const leftInfo = change && row.left !== null ? pairRanges(row.hunk!, 'left', row.left) : { ranges: [], whole: false }
      const rightInfo = change && row.right !== null ? pairRanges(row.hunk!, 'right', row.right) : { ranges: [], whole: false }
      const leftKind = !change ? 'same' : row.left === null ? 'filler' : 'removed'
      const rightKind = !change ? 'same' : row.right === null ? 'filler' : 'added'
      return (
        <>
          <div
            className={cn('absolute inset-y-0', leftKind === 'removed' && 'bg-(--diff-removed)')}
            style={{ left: panes.left.x, width: panes.left.width }}
          >
            <div className="absolute inset-y-0 left-0 flex" style={{ width: panes.left.gutter }}>
              <span className="shrink-0" style={{ width: GLYPH }} />
              {lineNumber('left', row.left, lnLeft)}
              {sign(leftKind === 'removed' ? 'removed' : null)}
            </div>
            {codeArea('left', row.left, { kind: leftKind, ...leftInfo, blame: 'none', gutter: panes.left.gutter, unchanged })}
          </div>
          <div
            className={cn('absolute inset-y-0', rightKind === 'added' && 'bg-(--diff-added)')}
            style={{ left: panes.right.x, width: panes.right.width }}
          >
            <div className="absolute inset-y-0 left-0 flex" style={{ width: panes.right.gutter }}>
              <span className="shrink-0" style={{ width: GLYPH }} />
              {lineNumber('right', row.right, lnRight)}
              {sign(rightKind === 'added' ? 'added' : null)}
            </div>
            {codeArea('right', row.right, { kind: rightKind, ...rightInfo, blame: 'blame', gutter: panes.right.gutter, unchanged })}
          </div>
        </>
      )
    }
    // Inline (and the single-file view): old and new line numbers, the sign, then the line
    const side: Side = row.side === 'left' ? 'left' : 'right'
    const line = side === 'left' ? row.left : row.right
    const kind = row.side === 'left' ? 'removed' : row.side === 'right' ? 'added' : 'same'
    const info = kind !== 'same' && row.hunk !== null && line !== null ? pairRanges(row.hunk, side, line) : { ranges: [], whole: false }
    const pane = panes.right
    return (
      <div
        className={cn('absolute inset-y-0', kind === 'removed' && 'bg-(--diff-removed)', kind === 'added' && 'bg-(--diff-added)')}
        style={{ left: pane.x, width: pane.width }}
      >
        <div className="absolute inset-y-0 left-0 flex" style={{ width: pane.gutter }}>
          <span className="shrink-0" style={{ width: GLYPH }} />
          {!single && lineNumber('left', row.side === 'right' ? null : row.left, lnLeft)}
          {lineNumber('right', row.side === 'left' ? null : row.right, lnRight)}
          {!single && sign(kind === 'same' ? null : kind)}
        </div>
        {codeArea(side, line, { kind, ...info, blame: side === 'left' ? 'spacer' : 'blame', gutter: pane.gutter, unchanged })}
      </div>
    )
  }

  // ---- block actions in the gutter (gutterFeature.ts) ----

  const selectedRows = useMemo(() => {
    const found: number[] = []
    for (const line of selection.left) {
      const row = layout.rowOfLeft.get(line)
      if (row !== undefined) found.push(row)
    }
    for (const line of selection.right) {
      const row = layout.rowOfRight.get(line)
      if (row !== undefined) found.push(row)
    }
    return found.length ? ([Math.min(...found), Math.max(...found) + 1] as [number, number]) : null
  }, [selection, layout])

  const gutterItems: { key: string; range: [number, number]; actions: GutterAction[]; always: boolean }[] = []
  if (showGutter) {
    const first = items[0]?.index ?? 0
    const last = items[items.length - 1]?.index ?? 0
    const actions = selectedRows && selectionActions ? selectionActions(inline) : []
    if (selectedRows && actions.length) {
      gutterItems.push({ key: 'selection', range: selectedRows, actions, always: true })
    } else {
      for (const [hunk, range] of layout.hunks) {
        if (range[1] < first || range[0] > last) continue
        gutterItems.push({ key: `h${hunk}`, range, actions: hunkActions!(hunk, inline), always: hunk === currentHunk })
      }
    }
  }

  const gutterItem = ({ key, range, actions, always }: (typeof gutterItems)[number]) => {
    const top = layout.offsets[range[0]]
    const itemHeight = layout.offsets[range[1]] - top
    const buttonsHeight = actions.length * ROW
    // Centered on the change, kept inside the viewport and the change when there is room
    let buttonsTop = top + itemHeight / 2 - buttonsHeight / 2
    const margin = buttonsHeight
    const viewStart = scrollTop + margin
    const viewEnd = scrollTop + size.height - margin - buttonsHeight
    const itemStart = top + margin
    const itemEnd = top + itemHeight - buttonsHeight - margin
    if (viewStart < viewEnd && itemStart < itemEnd) buttonsTop = Math.min(itemEnd, Math.max(itemStart, Math.min(viewEnd, Math.max(viewStart, buttonsTop))))
    // Never above the first line
    buttonsTop = Math.max(0, buttonsTop)
    return (
      <div
        key={key}
        className={cn(
          'absolute left-0',
          always ? 'opacity-100' : 'opacity-0 transition-opacity duration-700 group-hover/gutter:opacity-100 group-hover/gutter:duration-100 group-hover/gutter:ease-in-out',
        )}
        style={{ top, height: itemHeight, width: HUNK_GUTTER }}
      >
        <div className="absolute inset-y-0 left-1/2 w-px border-(--vsc-menu-separatorBackground) border-l-2" />
        <div className="absolute flex w-full justify-center" style={{ top: buttonsTop - top }}>
          <div className="flex flex-col rounded-[4px] bg-(--vsc-editor-background)">
            {actions.map((action) => (
              // The gutter's hover shows at once, to the right (WorkbenchHoverDelegate with instantHover)
              <Tooltip key={action.label}>
                <TooltipTrigger
                  delay={0}
                  render={
                    <button
                      type="button"
                      aria-label={action.label}
                      className="flex h-[18px] w-5 cursor-pointer items-center justify-center rounded-[4px] text-inherit hover:bg-(--vsc-toolbar-hoverBackground)"
                      onClick={action.run}
                    />
                  }
                >
                  <Icon name={action.icon} />
                </TooltipTrigger>
                <TooltipPopup side="right">{action.label}</TooltipPopup>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ---- overview ruler marks ----

  const marks = useMemo(() => {
    const found: { side: Side; top: number; height: number }[] = []
    for (const [hunk, [start]] of layout.hunks) {
      const h = result.hunks[hunk]
      const top = layout.offsets[start]
      if (h.leftCount) found.push({ side: 'left', top, height: h.leftCount * ROW })
      if (h.rightCount) found.push({ side: 'right', top: sideBySide ? top : top + h.leftCount * ROW, height: h.rightCount * ROW })
    }
    return found
  }, [layout, result.hunks, sideBySide])

  const sash = sideBySide && panes.left && (
    <div
      role="separator"
      aria-orientation="vertical"
      className={cn(
        'absolute inset-y-0 z-[35] w-1 cursor-ew-resize transition-[background-color] duration-100 ease-out hover:bg-(--vsc-sash-hoverBorder) hover:delay-300',
        sashActive && 'bg-(--vsc-sash-hoverBorder)',
      )}
      style={{ left: gutterX - 2 }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setSashActive(true)
      }}
      onPointerMove={(e) => {
        if (!sashActive || !width) return
        const x = e.clientX - (scrollRef.current?.getBoundingClientRect().left ?? 0) + gutterSpace
        setRatio(Math.min(1, Math.max(0, x / width)))
      }}
      onPointerUp={() => setSashActive(false)}
      onDoubleClick={() => setRatio(0.5)}
    />
  )

  return (
    <div
      ref={rootRef}
      className="group/editor relative h-full overflow-hidden bg-(--vsc-editor-background) font-editor text-(--vsc-editor-foreground) text-[12px] leading-[18px] [font-feature-settings:'liga'_0,'calt'_0]"
      data-context={JSON.stringify({ gitmenuDiffFocus: true })}
    >
      <div
        ref={scrollRef}
        className="absolute inset-y-0 left-0 overflow-y-auto overflow-x-hidden outline-none [&::-webkit-scrollbar]:w-3.5"
        style={{ right: showOverview ? OVERVIEW : 0 }}
        tabIndex={0}
        role="document"
        aria-label={path}
      >
        <div
          className="relative w-full"
          style={{ height: totalHeight, '--sx-left': `${sx.left}px`, '--sx-right': `${sx.right}px` } as CSSProperties}
        >
          {items.map((item) => (
            <div key={item.key} className="absolute inset-x-0 top-0 whitespace-pre" style={{ transform: `translateY(${item.start}px)`, height: item.size }}>
              {renderRow(rows[item.index])}
            </div>
          ))}
          {showGutter && (
            <div className="group/gutter absolute top-0 font-sans" style={{ left: gutterX, width: HUNK_GUTTER, height: totalHeight }}>
              {gutterItems.map(gutterItem)}
            </div>
          )}
        </div>
      </div>
      {/* Shadows: under the top edge once scrolled, at a side's left edge once scrolled sideways, and between the sides */}
      {scrollTop > 0 && <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px] shadow-[inset_0_6px_6px_-6px_var(--vsc-scrollbar-shadow)]" />}
      {panes.left && sx.left > 0 && (
        <div className="pointer-events-none absolute inset-y-0 z-10 w-[3px] shadow-[inset_6px_0_6px_-6px_var(--vsc-scrollbar-shadow)]" style={{ left: panes.left.gutter }} />
      )}
      {sx.right > 0 && (
        <div className="pointer-events-none absolute inset-y-0 z-10 w-[3px] shadow-[inset_6px_0_6px_-6px_var(--vsc-scrollbar-shadow)]" style={{ left: panes.right.x + panes.right.gutter }} />
      )}
      {sideBySide && panes.left && (
        <>
          <div className="pointer-events-none absolute inset-y-0 left-0 shadow-[6px_0_5px_-5px_var(--vsc-scrollbar-shadow)]" style={{ width: panes.left.width }} />
          <div
            className="pointer-events-none absolute inset-y-0 shadow-[-6px_0_5px_-5px_var(--vsc-scrollbar-shadow)]"
            style={{ left: panes.right.x, width: panes.right.width }}
          />
        </>
      )}
      {panes.left && (
        <HScrollbar left={panes.left.gutter} width={viewportWidth.left} content={contentWidth.left} value={sx.left} onChange={(v) => setX('left', v)} />
      )}
      <HScrollbar
        left={panes.right.x + panes.right.gutter}
        width={viewportWidth.right}
        content={contentWidth.right}
        value={sx.right}
        onChange={(v) => setX('right', v)}
      />
      {sash}
      {showOverview && (
        <OverviewRuler
          marks={marks}
          total={totalHeight}
          scrollTop={scrollTop}
          viewport={size.height}
          onScroll={(top) => scrollRef.current?.scrollTo({ top })}
        />
      )}
    </div>
  )
}
