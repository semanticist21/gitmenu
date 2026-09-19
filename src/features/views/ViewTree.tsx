// The tree used by the GitLens views, drawn like VS Code's custom tree views
// (views.css `.customview-tree`, tree.css, iconlabel.css): 22px rows indented 8px a level, a
// twistie, a 16px icon, the label and its dimmed description on one line with one ellipsis,
// the decoration badge, then inline actions on hover. Children load when a node is first
// expanded (its twistie spins meanwhile); `view/item/context` menus and inline actions are
// keyed by the node's `viewItem`. Keyboard: ↑↓ move, ←→ collapse/expand, Enter opens,
// ⇧F10 opens the context menu.
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { InlineActions } from '@/commands/InlineActions'
import { MenuItems } from '@/commands/MenuItems'
import { Icon } from '@/components/Icon'
import { ContextMenu, ContextMenuPopup, ContextMenuTrigger } from '@/components/ui/context-menu'
import { gl, useLocale } from '@/i18n'
import { cn } from '@/lib/utils'
import { useSetting } from '@/settings/settings'
import { INDENT, ROW_HEIGHT } from '@/theme/metrics'

export interface AsyncChildren<T = unknown> {
  queryKey: unknown[]
  /** `limit` is the page size so far, for paged children (see `more`) */
  queryFn: (limit: number) => Promise<T>
  build: (data: T) => TreeNode[]
  /** Paged children: whether more follow; adds "Load more" that grows the page */
  more?: (data: T) => boolean
}

/** The "Load more" row of a paged list (GitLens's `pageItemLimit`): plain label, no icon. */
export function loadMore(id: string, loading: boolean, onLoad: () => void): TreeNode {
  return {
    id,
    label: loading ? gl('Loading...') : gl('Load more'),
    open: loading ? undefined : onLoad,
  }
}

export interface TreeNode {
  /** Unique within the tree and stable across renders */
  id: string
  label: ReactNode
  /** Accessible name when `label` isn't text */
  ariaLabel?: string
  description?: string
  icon?: ReactNode
  tooltip?: string
  /** `viewItem` for menus; rows without one have no menu */
  contextValue?: string
  /** The argument passed to commands run from this row */
  arg?: unknown
  children?: TreeNode[]
  loadChildren?: AsyncChildren
  /** Expanded until the user collapses it */
  expanded?: boolean
  /** Click and Enter */
  open?: () => void
  /** A message: as the only root nodes it is the view's message (VS Code's tree message),
   * elsewhere a plain row */
  message?: boolean
  /** The decoration badge after the label (status letter, ◎), before the inline actions */
  decoration?: ReactNode
  /** Decoration color (VS Code's `FileDecoration.color`): tints the label and description */
  color?: string
}

// Typed helper so `build` sees the query's data type
export function asyncChildren<T>(children: AsyncChildren<T>): AsyncChildren {
  return children as AsyncChildren
}

interface Row {
  node: TreeNode
  /** 0 for root nodes */
  depth: number
  expandable: boolean
  expanded: boolean
  loading: boolean
  /** Ids of the ancestors, outermost first (one indent guide each) */
  ancestors: string[]
}

/** A list row: hover, selection (active while the list has focus) and the focus outline. The
 * list element carries `group/list`. */
export const treeRowClass = cn(
  'group/row absolute inset-x-0 top-0 flex h-row cursor-default items-center whitespace-nowrap pe-3 leading-row outline-none',
  'hover:not-aria-selected:bg-list-hover aria-selected:bg-list-inactive',
  'group-focus-within/list:aria-selected:bg-list-active group-focus-within/list:aria-selected:text-list-active-foreground',
  'focus:outline-solid focus:outline-1 focus:-outline-offset-1 focus:outline-list-focus-outline aria-selected:focus:outline-list-selection-outline',
)

/** A tree's message in place of rows (views.css `.message`). */
export const viewMessageClass = 'flex select-text py-1 ps-[18px] pe-3'

/** `.label-description`: .9em, .95 opacity in light themes and .7 in dark, 1 when focused or
 * selected; no color of its own. */
export const descriptionClass =
  'ms-[.5em] whitespace-pre text-label-description opacity-95 dark:opacity-70 group-focus/row:opacity-100 group-aria-selected/row:opacity-100'

/** Label and description on one line with a single trailing ellipsis, so the description is
 * cut first. `color` tints both (a decoration color); a selected row in a focused list drops it. */
export function RowLabel({ label, description, color, className }: { label: ReactNode; description?: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cn('min-w-0 flex-1 truncate', color && 'text-(--row-deco) group-focus-within/list:group-aria-selected/row:text-inherit', className)}
      style={color ? ({ '--row-deco': color } as CSSProperties) : undefined}
    >
      <span className="whitespace-pre">{label}</span>
      {description ? <span className={descriptionClass}>{description}</span> : null}
    </span>
  )
}

/** The twistie: `indent` px of padding, then a 16px glyph slot and 6px. `hidden` keeps only the
 * indent (VS Code hides twisties of leaves when file icons align with them). */
export function Twistie({ indent, state }: { indent: number; state: 'leaf' | 'collapsed' | 'expanded' | 'loading' | 'hidden' }) {
  if (state === 'hidden') return <span aria-hidden className="h-full shrink-0" style={{ width: indent }} />
  return (
    <span data-twistie aria-hidden className="flex h-full shrink-0 items-center justify-center pe-1.5" style={{ width: indent + 22, paddingInlineStart: indent }}>
      {state !== 'leaf' && (
        <Icon
          name={state === 'loading' ? 'loading' : state === 'expanded' ? 'chevron-down' : 'chevron-right'}
          spin={state === 'loading'}
          className="translate-x-[3px]"
        />
      )}
    </span>
  )
}

/** Indent guides (one per ancestor, 8px apart from x=16): shown while the list is hovered, the
 * active one (the focused node's parent) always. */
export function IndentGuides({ ancestors, active }: { ancestors: string[]; active: string | null }) {
  if (ancestors.length === 0) return null
  return (
    <span aria-hidden className="pointer-events-none absolute inset-y-0 start-4 flex">
      {ancestors.map((id) => (
        <span
          key={id}
          className={cn(
            'h-full w-indent shrink-0 border-s',
            id === active
              ? 'border-indent-guide'
              : 'border-indent-guide-inactive opacity-0 transition-opacity duration-fade ease-linear group-hover/list:opacity-100 motion-reduce:transition-none',
          )}
        />
      ))}
    </span>
  )
}

/** VS Code shows a loading twistie only once children take this long */
const SLOW_LOADING_MS = 800

export function ViewTree({ viewId, nodes, label }: { viewId: string; nodes: TreeNode[]; label: string }) {
  useLocale()
  const client = useQueryClient()
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map())
  const [focusIndex, setFocusIndex] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [limits, setLimits] = useState<Map<string, number>>(new Map())
  const shown = useRef(new Map<string, unknown>())
  const pageSize = useSetting<number>('gitmenu.views.pageItemLimit')
  const scrollRef = useRef<HTMLDivElement>(null)
  // Nodes whose children have been loading for 800ms: only these spin (asyncDataTree.ts)
  const [slow, setSlow] = useState<ReadonlySet<string>>(new Set())

  const isExpanded = (node: TreeNode) => toggled.get(node.id) ?? node.expanded ?? false

  // Flatten with whatever children are cached; the queries below fill in the rest
  const rows: Row[] = []
  const pending: { queryKey: unknown[]; queryFn: () => Promise<unknown> }[] = []
  const walk = (list: TreeNode[], depth: number, ancestors: string[]) => {
    for (const node of list) {
      const expandable = Boolean(node.children || node.loadChildren)
      const expanded = expandable && isExpanded(node)
      const row: Row = { node, depth, expandable, expanded, loading: false, ancestors }
      rows.push(row)
      if (!expanded) continue
      const inner = [...ancestors, node.id]
      if (node.children) walk(node.children, depth + 1, inner)
      else if (node.loadChildren) {
        const source = node.loadChildren
        const limit = limits.get(node.id) ?? pageSize
        const queryKey = source.more ? [...source.queryKey, limit] : source.queryKey
        pending.push({ queryKey, queryFn: () => source.queryFn(limit) })
        // While a bigger page loads, keep showing the smaller one
        const data = client.getQueryData(queryKey) ?? (source.more ? shown.current.get(node.id) : undefined)
        if (data === undefined) {
          // VS Code spins the twistie of a node whose children are loading
          row.loading = true
          continue
        }
        if (source.more) shown.current.set(node.id, data)
        walk(source.build(data), depth + 1, inner)
        if (source.more?.(data)) {
          const loading = client.getQueryData(queryKey) === undefined
          walk([loadMore(`${node.id}/more`, loading, () => setLimits(new Map(limits).set(node.id, limit + pageSize)))], depth + 1, inner)
        }
      }
    }
  }
  walk(nodes, 0, [])
  useQueries({ queries: pending.map((p) => ({ ...p, staleTime: Infinity })) })

  const loadingIds = rows.filter((r) => r.loading).map((r) => r.node.id).join('\n')
  useEffect(() => {
    const ids = loadingIds ? loadingIds.split('\n') : []
    if (ids.length === 0) return
    const timer = window.setTimeout(() => setSlow(new Set(ids)), SLOW_LOADING_MS)
    return () => {
      window.clearTimeout(timer)
      setSlow((prev) => (prev.size ? new Set() : prev))
    }
  }, [loadingIds])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  // An empty view shows its message instead of rows (`view.message`, views.css `.message`)
  if (nodes.length > 0 && nodes.every((n) => n.message)) {
    return (
      <div className="h-full overflow-auto">
        {nodes.map((node) => (
          <p key={node.id} className={viewMessageClass}>
            {node.label}
          </p>
        ))}
      </div>
    )
  }

  const toggle = (row: Row, expanded = !row.expanded) => {
    if (!row.expandable) return
    setToggled(new Map(toggled).set(row.node.id, expanded))
  }

  const activate = (row: Row) => {
    if (row.node.open) row.node.open()
    else toggle(row)
  }

  const focusRow = (index: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, index))
    setFocusIndex(next)
    if (rows[next]) setSelectedId(rows[next].node.id)
    virtualizer.scrollToIndex(next)
    requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus())
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const row = rows[focusIndex]
    if (!row) return
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        focusRow(focusIndex + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        focusRow(focusIndex - 1)
        break
      case 'ArrowRight':
        event.preventDefault()
        if (row.expandable && !row.expanded) toggle(row, true)
        else if (row.expanded) focusRow(focusIndex + 1)
        break
      case 'ArrowLeft': {
        event.preventDefault()
        if (row.expanded) toggle(row, false)
        else {
          const parent = rows.slice(0, focusIndex).findLastIndex((r) => r.depth < row.depth)
          if (parent >= 0) focusRow(parent)
        }
        break
      }
      case 'Enter':
        event.preventDefault()
        activate(row)
        break
      case 'F10':
      case 'ContextMenu':
        if (event.key === 'ContextMenu' || event.shiftKey) {
          event.preventDefault()
          const el = event.target as HTMLElement
          const rect = el.getBoundingClientRect()
          el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: rect.left + 24, clientY: rect.bottom, button: 2 }))
        }
        break
    }
  }

  // The active indent guide belongs to the selected node when it is open, else to its parent
  const selectedRow = rows.find((r) => r.node.id === selectedId)
  const activeGuide = selectedRow ? (selectedRow.expanded ? selectedRow.node.id : (selectedRow.ancestors.at(-1) ?? null)) : null

  return (
    <div
      ref={scrollRef}
      role="tree"
      aria-label={label}
      className="group/list h-full overflow-auto outline-none"
      data-context={JSON.stringify({ listFocus: true })}
      onKeyDown={onKeyDown}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          const { node } = row
          const selected = node.id === selectedId
          const context = { view: viewId, viewItem: node.contextValue ?? '' }
          const args = [node.arg]
          const twistie = row.loading && slow.has(node.id) ? 'loading' : row.expandable ? (row.expanded ? 'expanded' : 'collapsed') : 'leaf'
          const content = (
            <>
              <IndentGuides ancestors={row.ancestors} active={activeGuide} />
              <Twistie indent={(row.depth + 1) * INDENT} state={twistie} />
              {node.icon ? <span className="me-1.5 flex size-icon shrink-0 items-center justify-center empty:hidden">{node.icon}</span> : null}
              <RowLabel label={node.label} description={node.description} color={node.color} />
              {node.decoration}
              {node.contextValue && <InlineActions menu="view/item/context" context={context} args={args} />}
            </>
          )
          const props = {
            role: 'treeitem',
            'aria-level': row.depth + 1,
            'aria-expanded': row.expandable ? row.expanded : undefined,
            'aria-selected': selected,
            'aria-label': node.ariaLabel,
            'data-index': item.index,
            'data-selected': selected || undefined,
            tabIndex: item.index === focusIndex ? 0 : -1,
            title: node.tooltip,
            className: treeRowClass,
            style: { transform: `translateY(${item.start}px)` },
            onFocus: () => setFocusIndex(item.index),
            onClick: (e: React.MouseEvent) => {
              setFocusIndex(item.index)
              setSelectedId(node.id)
              // The twistie toggles even on rows that open something
              if (row.expandable && (e.target as HTMLElement).closest('[data-twistie]')) toggle(row)
              else activate(row)
            },
          }
          if (!node.contextValue) return <div key={node.id} {...props}>{content}</div>
          return (
            <ContextMenu key={node.id}>
              <ContextMenuTrigger render={<div {...props} />}>{content}</ContextMenuTrigger>
              <ContextMenuPopup>
                <MenuItems menu="view/item/context" kind="context" context={context} args={args} />
              </ContextMenuPopup>
            </ContextMenu>
          )
        })}
      </div>
    </div>
  )
}
