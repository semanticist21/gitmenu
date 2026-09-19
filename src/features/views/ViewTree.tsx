// The tree used by the GitLens views: virtualized rows, children loaded when a node is first
// expanded, `view/item/context` menus and inline actions keyed by the node's `viewItem`.
// Keyboard: ↑↓ move, ←→ collapse/expand, Enter opens, ⇧F10 opens the context menu.
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRightIcon, EllipsisIcon, LoaderIcon } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react'
import { InlineActions } from '@/commands/InlineActions'
import { MenuItems } from '@/commands/MenuItems'
import { ContextMenu, ContextMenuPopup, ContextMenuTrigger } from '@/components/ui/context-menu'
import { gl, useLocale } from '@/i18n'
import { cn } from '@/lib/utils'
import { useSetting } from '@/settings/settings'

export interface AsyncChildren<T = unknown> {
  queryKey: unknown[]
  /** `limit` is the page size so far, for paged children (see `more`) */
  queryFn: (limit: number) => Promise<T>
  build: (data: T) => TreeNode[]
  /** Paged children: whether more follow; adds "Load more" that grows the page */
  more?: (data: T) => boolean
}

/** The "Load more" row of a paged list (GitLens's `pageItemLimit`). */
export function loadMore(id: string, loading: boolean, onLoad: () => void): TreeNode {
  return {
    id,
    label: loading ? gl('Loading...') : gl('Load more'),
    icon: <EllipsisIcon className="text-muted-foreground" />,
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
  /** A dimmed, non-interactive line (empty states, errors) */
  message?: boolean
  /** Rendered after the description (badges, counts) */
  decoration?: ReactNode
}

// Typed helper so `build` sees the query's data type
export function asyncChildren<T>(children: AsyncChildren<T>): AsyncChildren {
  return children as AsyncChildren
}

interface Row {
  node: TreeNode
  depth: number
  expandable: boolean
  expanded: boolean
  loading?: boolean
}

const ROW_HEIGHT = 22
const INDENT = 8

export function ViewTree({ viewId, nodes, label }: { viewId: string; nodes: TreeNode[]; label: string }) {
  useLocale()
  const client = useQueryClient()
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map())
  const [focusIndex, setFocusIndex] = useState(0)
  const [limits, setLimits] = useState<Map<string, number>>(new Map())
  const shown = useRef(new Map<string, unknown>())
  const pageSize = useSetting<number>('gitmenu.views.pageItemLimit')
  const scrollRef = useRef<HTMLDivElement>(null)

  const isExpanded = (node: TreeNode) => toggled.get(node.id) ?? node.expanded ?? false

  // Flatten with whatever children are cached; the queries below fill in the rest
  const rows: Row[] = []
  const pending: { queryKey: unknown[]; queryFn: () => Promise<unknown> }[] = []
  const walk = (list: TreeNode[], depth: number) => {
    for (const node of list) {
      const expandable = Boolean(node.children || node.loadChildren)
      const expanded = expandable && isExpanded(node)
      rows.push({ node, depth, expandable, expanded })
      if (!expanded) continue
      if (node.children) walk(node.children, depth + 1)
      else if (node.loadChildren) {
        const source = node.loadChildren
        const limit = limits.get(node.id) ?? pageSize
        const queryKey = source.more ? [...source.queryKey, limit] : source.queryKey
        pending.push({ queryKey, queryFn: () => source.queryFn(limit) })
        // While a bigger page loads, keep showing the smaller one
        const data = client.getQueryData(queryKey) ?? (source.more ? shown.current.get(node.id) : undefined)
        if (data === undefined) {
          rows.push({ node: { id: `${node.id}:loading`, label: '' }, depth: depth + 1, expandable: false, expanded: false, loading: true })
          continue
        }
        if (source.more) shown.current.set(node.id, data)
        walk(source.build(data), depth + 1)
        if (source.more?.(data)) {
          const loading = client.getQueryData(queryKey) === undefined
          walk([loadMore(`${node.id}/more`, loading, () => setLimits(new Map(limits).set(node.id, limit + pageSize)))], depth + 1)
        }
      }
    }
  }
  walk(nodes, 0)
  useQueries({ queries: pending.map((p) => ({ ...p, staleTime: Infinity })) })

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

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

  return (
    <div
      ref={scrollRef}
      role="tree"
      aria-label={label}
      className="h-full overflow-auto outline-none"
      data-context={JSON.stringify({ listFocus: true })}
      onKeyDown={onKeyDown}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          const { node } = row
          const style = { transform: `translateY(${item.start}px)`, height: ROW_HEIGHT, paddingInlineStart: 4 + row.depth * INDENT }
          if (row.loading || node.message) {
            return (
              <div key={node.id} role="treeitem" aria-level={row.depth + 1} className="absolute inset-x-0 top-0 flex items-center gap-1.5 text-muted-foreground text-xs" style={style}>
                <span className="w-3.5 shrink-0" />
                {row.loading ? <LoaderIcon className="size-3.5 animate-spin" /> : node.icon}
                <span className="truncate">{node.label}</span>
              </div>
            )
          }
          const context = { view: viewId, viewItem: node.contextValue ?? '' }
          const args = [node.arg]
          const content = (
            <>
              {row.expandable ? (
                <ChevronRightIcon className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', row.expanded && 'rotate-90')} />
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              {node.icon && <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">{node.icon}</span>}
              <span className="min-w-0 shrink truncate">{node.label}</span>
              {node.description && <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">{node.description}</span>}
              {!node.description && <span className="flex-1" />}
              {node.contextValue && <InlineActions menu="view/item/context" context={context} args={args} />}
              {node.decoration}
            </>
          )
          const props = {
            role: 'treeitem',
            'aria-level': row.depth + 1,
            'aria-expanded': row.expandable ? row.expanded : undefined,
            'aria-label': node.ariaLabel,
            'data-index': item.index,
            tabIndex: item.index === focusIndex ? 0 : -1,
            title: node.tooltip,
            className:
              'group/row absolute inset-x-0 top-0 flex cursor-default items-center gap-1.5 pe-1 text-[13px] outline-none hover:bg-accent/50 focus-visible:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
            style,
            onFocus: () => setFocusIndex(item.index),
            onClick: (e: React.MouseEvent) => {
              setFocusIndex(item.index)
              // The twistie toggles even on rows that open something
              const onTwistie = row.expandable && (e.target as HTMLElement).closest('svg') && e.clientX < (e.currentTarget.getBoundingClientRect().left + 4 + row.depth * INDENT + 18)
              if (onTwistie) toggle(row)
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
