// Resource groups and files as one virtualized tree (VS Code's SCM list view).
// Keyboard: ↑↓ move, ←→ collapse/expand groups, Enter opens, ⇧F10 opens the context menu.
// Click opens changes; ⌘/⇧-click selects several files for group commands.
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRightIcon } from 'lucide-react'
import { type KeyboardEvent, useMemo, useRef, useState } from 'react'
import { InlineActions } from '@/commands/InlineActions'
import { MenuItems } from '@/commands/MenuItems'
import { executeCommand } from '@/commands/registry'
import { ContextMenu, ContextMenuPopup, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useLocale } from '@/i18n'
import type { FileChange } from '@/lib/git'
import { useUiState } from '@/lib/uiState'
import { cn } from '@/lib/utils'
import { useSetting } from '@/settings/settings'
import type { GroupId, ScmSelection } from '../state'
import { isDeletion, LETTER, statusColor, statusText } from '../status'

export interface Group {
  id: GroupId
  label: string
  changes: FileChange[]
}

type Row =
  | { kind: 'group'; group: Group }
  | { kind: 'folder'; group: Group; path: string; name: string; depth: number }
  | { kind: 'file'; group: Group; change: FileChange; depth: number }

const INDENT = 12

/** VS Code's `scm.defaultViewSortKey`: by file name, by full path, or by status then path. */
function sortChanges(changes: FileChange[], sortKey: string): FileChange[] {
  const name = (c: FileChange) => c.path.slice(c.path.lastIndexOf('/') + 1)
  return [...changes].sort((a, b) => {
    if (sortKey === 'name') return name(a).localeCompare(name(b)) || a.path.localeCompare(b.path)
    if (sortKey === 'status') return LETTER[a.status].localeCompare(LETTER[b.status]) || a.path.localeCompare(b.path)
    return a.path.localeCompare(b.path)
  })
}

/** Tree view rows for one group: folders (with VS Code's compact `a/b` chains), then files. */
function treeRows(group: Group, changes: FileChange[], collapsedFolders: string[]): Row[] {
  interface Node {
    folders: Map<string, Node>
    files: FileChange[]
  }
  const top: Node = { folders: new Map(), files: [] }
  for (const change of changes) {
    let node = top
    for (const part of change.path.split('/').slice(0, -1)) {
      let next = node.folders.get(part)
      if (!next) {
        next = { folders: new Map(), files: [] }
        node.folders.set(part, next)
      }
      node = next
    }
    node.files.push(change)
  }
  const out: Row[] = []
  const walk = (node: Node, prefix: string, depth: number) => {
    for (const [part, sub] of [...node.folders.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      // Collapse single-child folder chains into one row, like VS Code's compact folders
      let name = part
      let current = sub
      let path = `${prefix}${part}`
      while (current.files.length === 0 && current.folders.size === 1) {
        const [[only, next]] = current.folders.entries()
        name = `${name}/${only}`
        path = `${path}/${only}`
        current = next
      }
      out.push({ kind: 'folder', group, path, name, depth })
      if (!collapsedFolders.includes(`${group.id}:${path}`)) walk(current, `${path}/`, depth + 1)
    }
    for (const change of node.files) out.push({ kind: 'file', group, change, depth })
  }
  walk(top, '', 1)
  return out
}

const ROW_HEIGHT = 22

function key(group: GroupId, change: FileChange) {
  return `${group}:${change.path}`
}

function splitPath(path: string) {
  const i = path.lastIndexOf('/')
  return i === -1 ? { name: path, dir: '' } : { name: path.slice(i + 1), dir: path.slice(0, i) }
}

export function ResourceList({ root, groups }: { root: string; groups: Group[] }) {
  useLocale()
  const openDiffOnClick = useSetting<boolean>('git.openDiffOnClick')
  const viewMode = useSetting<string>('scm.defaultViewMode')
  const sortKey = useSetting<string>('scm.defaultViewSortKey')
  const [collapsed, setCollapsed] = useUiState<string[]>('scm.collapsedGroups', [])
  const [collapsedFolders, setCollapsedFolders] = useUiState<string[]>('scm.collapsedFolders', [])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [focusIndex, setFocusIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = []
    for (const group of groups) {
      if (group.changes.length === 0 && group.id !== 'workingTree') continue
      list.push({ kind: 'group', group })
      if (collapsed.includes(group.id)) continue
      const changes = sortChanges(group.changes, sortKey)
      if (viewMode === 'tree') list.push(...treeRows(group, changes, collapsedFolders))
      else for (const change of changes) list.push({ kind: 'file', group, change, depth: 1 })
    }
    return list
  }, [groups, collapsed, collapsedFolders, viewMode, sortKey])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const toggleGroup = (id: GroupId) =>
    setCollapsed(collapsed.includes(id) ? collapsed.filter((g) => g !== id) : [...collapsed, id])
  const folderKey = (row: Extract<Row, { kind: 'folder' }>) => `${row.group.id}:${row.path}`
  const toggleFolder = (row: Extract<Row, { kind: 'folder' }>) => {
    const k = folderKey(row)
    setCollapsedFolders(collapsedFolders.includes(k) ? collapsedFolders.filter((f) => f !== k) : [...collapsedFolders, k])
  }
  /** Files under a folder row (for its context menu and inline actions). */
  const folderChanges = (row: Extract<Row, { kind: 'folder' }>) => row.group.changes.filter((c) => c.path.startsWith(`${row.path}/`))

  /** The clicked file plus every other selected file of its group, like VS Code. */
  const selectionFor = (group: Group, change: FileChange): ScmSelection => {
    const k = key(group.id, change)
    const changes = selected.has(k) ? group.changes.filter((c) => selected.has(key(group.id, c))) : [change]
    return { root, group: group.id, changes }
  }

  const groupSelection = (group: Group): ScmSelection => ({ root, group: group.id, changes: group.changes })

  const open = (group: Group, change: FileChange) => {
    const selection = { root, group: group.id, changes: [change] }
    void executeCommand(openDiffOnClick ? 'git.openChange' : 'git.openFile', selection)
  }

  const click = (index: number, row: Row, event: React.MouseEvent) => {
    setFocusIndex(index)
    if (row.kind === 'group') {
      toggleGroup(row.group.id)
      return
    }
    if (row.kind === 'folder') {
      toggleFolder(row)
      return
    }
    const k = key(row.group.id, row.change)
    if (event.metaKey) {
      const next = new Set(selected)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      setSelected(next)
      setAnchor(k)
      return
    }
    if (event.shiftKey && anchor) {
      const keys = rows.filter((r): r is Extract<Row, { kind: 'file' }> => r.kind === 'file').map((r) => key(r.group.id, r.change))
      const [a, b] = [keys.indexOf(anchor), keys.indexOf(k)].sort((x, y) => x - y)
      setSelected(new Set(keys.slice(a, b + 1)))
      return
    }
    setSelected(new Set([k]))
    setAnchor(k)
    open(row.group, row.change)
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
        if (row.kind === 'group' && collapsed.includes(row.group.id)) toggleGroup(row.group.id)
        else if (row.kind === 'folder' && collapsedFolders.includes(folderKey(row))) toggleFolder(row)
        break
      case 'ArrowLeft':
        if (row.kind === 'group' && !collapsed.includes(row.group.id)) toggleGroup(row.group.id)
        else if (row.kind === 'folder' && !collapsedFolders.includes(folderKey(row))) toggleFolder(row)
        else if (row.kind !== 'group') {
          const depth = row.depth
          focusRow(rows.slice(0, focusIndex).findLastIndex((r) => r.kind === 'group' || (r.kind === 'folder' && r.depth < depth)))
        }
        break
      case 'Enter':
        event.preventDefault()
        if (row.kind === 'group') toggleGroup(row.group.id)
        else if (row.kind === 'folder') toggleFolder(row)
        else open(row.group, row.change)
        break
      case ' ':
        event.preventDefault()
        if (row.kind === 'file') {
          const k = key(row.group.id, row.change)
          const next = new Set(selected)
          if (next.has(k)) next.delete(k)
          else next.add(k)
          setSelected(next)
        }
        break
      case 'F10':
      case 'ContextMenu':
        if (event.key === 'ContextMenu' || event.shiftKey) {
          event.preventDefault()
          const el = event.target as HTMLElement
          const rect = el.getBoundingClientRect()
          el.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, clientX: rect.left + 24, clientY: rect.bottom, button: 2 }),
          )
        }
        break
    }
  }

  return (
    <div
      ref={scrollRef}
      role="tree"
      aria-multiselectable
      className="h-full overflow-auto outline-none"
      data-context={JSON.stringify({ listFocus: true, focusedView: 'workbench.scm' })}
      onKeyDown={onKeyDown}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          const style = { transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }
          const common = {
            'data-index': item.index,
            tabIndex: item.index === focusIndex ? 0 : -1,
            onFocus: () => setFocusIndex(item.index),
            onClick: (e: React.MouseEvent) => click(item.index, row, e),
          }
          if (row.kind === 'group') {
            const context = { scmProvider: 'git', scmResourceGroup: row.group.id }
            const expanded = !collapsed.includes(row.group.id)
            return (
              <ContextMenu key={`g:${row.group.id}`}>
                <ContextMenuTrigger
                  render={
                    <div
                      role="treeitem"
                      aria-level={1}
                      aria-expanded={expanded}
                      aria-label={`${row.group.label}, ${row.group.changes.length}`}
                      className="group/row absolute inset-x-0 top-0 flex cursor-default items-center gap-1 ps-1 pe-1 text-[13px] font-medium outline-none hover:bg-accent/50 focus-visible:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
                      style={style}
                      {...common}
                    />
                  }
                >
                  <ChevronRightIcon className={cn('size-3.5 shrink-0 transition-transform', expanded && 'rotate-90')} />
                  <span className="min-w-0 flex-1 truncate">{row.group.label}</span>
                  <InlineActions menu="scm/resourceGroup/context" context={context} args={[groupSelection(row.group)]} />
                  <span className="min-w-5 shrink-0 rounded-full bg-muted px-1.5 text-center text-[11px] text-muted-foreground tabular-nums">
                    {row.group.changes.length}
                  </span>
                </ContextMenuTrigger>
                <ContextMenuPopup>
                  <MenuItems menu="scm/resourceGroup/context" kind="context" context={context} args={[groupSelection(row.group)]} />
                </ContextMenuPopup>
              </ContextMenu>
            )
          }
          if (row.kind === 'folder') {
            const expanded = !collapsedFolders.includes(folderKey(row))
            const context = { scmProvider: 'git', scmResourceGroup: row.group.id, scmResourceFolder: true }
            const selection: ScmSelection = { root, group: row.group.id, changes: folderChanges(row) }
            return (
              <ContextMenu key={`f:${folderKey(row)}`}>
                <ContextMenuTrigger
                  render={
                    <div
                      role="treeitem"
                      aria-level={row.depth + 1}
                      aria-expanded={expanded}
                      aria-label={row.name}
                      className="group/row absolute inset-x-0 top-0 flex cursor-default items-center gap-1 pe-1 text-[13px] outline-none hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
                      style={{ ...style, paddingInlineStart: 4 + row.depth * INDENT }}
                      {...common}
                    />
                  }
                >
                  <ChevronRightIcon className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  <InlineActions menu="scm/resourceFolder/context" context={context} args={[selection]} />
                </ContextMenuTrigger>
                <ContextMenuPopup>
                  <MenuItems menu="scm/resourceFolder/context" kind="context" context={context} args={[selection]} />
                </ContextMenuPopup>
              </ContextMenu>
            )
          }
          const { change, group } = row
          const k = key(group.id, change)
          const { name, dir } = splitPath(change.path)
          const tree = viewMode === 'tree'
          const context = { scmProvider: 'git', scmResourceGroup: group.id, scmResourceState: 'worktree' }
          const deleted = isDeletion(change.status)
          const tooltip = `${change.originalPath ? `${change.originalPath} → ` : ''}${change.path} • ${statusText(change.status)}`
          return (
            <ContextMenu key={k}>
              <ContextMenuTrigger
                render={
                  <div
                    role="treeitem"
                    aria-level={row.depth + 1}
                    aria-selected={selected.has(k)}
                    aria-label={`${name}, ${statusText(change.status)}`}
                    data-selected={selected.has(k)}
                    title={tooltip}
                    className={cn(
                      'group/row absolute inset-x-0 top-0 flex cursor-default items-center gap-1.5 pe-1 text-[13px] outline-none hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
                      selected.has(k) && 'bg-accent',
                    )}
                    style={{ ...style, paddingInlineStart: (tree ? 22 : 20) + (row.depth - 1) * INDENT }}
                    {...common}
                  />
                }
              >
                <span className={cn('min-w-0 max-w-full shrink-0 truncate', deleted && 'line-through opacity-70')} style={{ color: statusColor(change.status) }}>
                  {name}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
                  {change.originalPath ? `${change.originalPath} → ${dir}` : tree ? '' : dir}
                </span>
                <InlineActions menu="scm/resourceState/context" context={context} args={[selectionFor(group, change)]} />
                <span className="w-3 shrink-0 text-center font-mono text-[11px] font-semibold" style={{ color: statusColor(change.status) }}>
                  {LETTER[change.status]}
                </span>
              </ContextMenuTrigger>
              <ContextMenuPopup>
                <MenuItems menu="scm/resourceState/context" kind="context" context={context} args={[selectionFor(group, change)]} />
              </ContextMenuPopup>
            </ContextMenu>
          )
        })}
      </div>
    </div>
  )
}
