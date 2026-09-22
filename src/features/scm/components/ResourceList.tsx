// Resource groups and files as one virtualized tree, drawn like VS Code's SCM tree (scm.css,
// scmViewPane.ts): the commit input and action button scroll with it as its first rows; group
// rows show the name, inline actions on hover and the count badge; file rows show a file icon
// aligned with the twisties, the name and dimmed folder on one line (struck through when
// deleted), inline actions on hover and the colored status letter.
// Keyboard: ↑↓ move, ←→ collapse/expand groups, Enter opens, ⇧F10 opens the context menu.
// Click opens changes; ⌘/⇧-click selects several files for group commands.
import { useVirtualizer } from '@tanstack/react-virtual'
import { type CSSProperties, type KeyboardEvent, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { InlineActions } from '@/commands/InlineActions'
import { MenuItems } from '@/commands/MenuItems'
import { executeCommand } from '@/commands/registry'
import { FileIcon } from '@/features/fileIcons/FileIcon'
import { Badge } from '@/components/ui/badge'
import { ContextMenu, ContextMenuPopup, ContextMenuTrigger } from '@/components/ui/context-menu'
import { IndentGuides, RowLabel, treeRowClass, Twistie } from '@/features/views/ViewTree'
import { useLocale } from '@/i18n'
import type { FileChange } from '@/lib/git'
import { useUiState } from '@/lib/uiState'
import { cn } from '@/lib/utils'
import { useSetting } from '@/settings/settings'
import { INDENT, ROW_HEIGHT } from '@/theme/metrics'
import type { GroupId, ScmSelection } from '../state'
import { isDeletion, LETTER, statusColor, statusText } from '../status'

export interface Group {
  id: GroupId
  label: string
  changes: FileChange[]
}

/** `depth` counts from the group row (1), as VS Code's tree does. */
type Row =
  | { kind: 'group'; group: Group; depth: 1; ancestors: string[] }
  | { kind: 'folder'; group: Group; path: string; name: string; depth: number; ancestors: string[] }
  | { kind: 'file'; group: Group; change: FileChange; depth: number; ancestors: string[] }

/** VS Code's `scm.defaultViewSortKey`: by file name, by full path, or by status then path. */
function sortChanges(changes: FileChange[], sortKey: string): FileChange[] {
  const name = (c: FileChange) => c.path.slice(c.path.lastIndexOf('/') + 1)
  return [...changes].sort((a, b) => {
    if (sortKey === 'name') return name(a).localeCompare(name(b)) || a.path.localeCompare(b.path)
    if (sortKey === 'status') return LETTER[a.status].localeCompare(LETTER[b.status]) || a.path.localeCompare(b.path)
    return a.path.localeCompare(b.path)
  })
}

const groupKey = (group: Group) => `g:${group.id}`

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
  const walk = (node: Node, prefix: string, depth: number, ancestors: string[]) => {
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
      out.push({ kind: 'folder', group, path, name, depth, ancestors })
      if (!collapsedFolders.includes(`${group.id}:${path}`)) walk(current, `${path}/`, depth + 1, [...ancestors, `f:${group.id}:${path}`])
    }
    for (const change of node.files) out.push({ kind: 'file', group, change, depth, ancestors })
  }
  walk(top, '', 2, [groupKey(group)])
  return out
}

function key(group: GroupId, change: FileChange) {
  return `${group}:${change.path}`
}

function rowId(row: Row) {
  if (row.kind === 'group') return groupKey(row.group)
  if (row.kind === 'folder') return `f:${row.group.id}:${row.path}`
  return key(row.group.id, row.change)
}

function splitPath(path: string) {
  const i = path.lastIndexOf('/')
  return i === -1 ? { name: path, dir: '' } : { name: path.slice(i + 1), dir: path.slice(0, i) }
}

/** A compressed folder chain, `a/b/c`, with VS Code's dimmed separators (`.label-separator`). */
function FolderName({ name }: { name: string }) {
  const parts = name.split('/')
  return parts.map((part, i) => (
    <span key={i}>
      {i > 0 && <span className="mx-0.5 opacity-50">/</span>}
      {part}
    </span>
  ))
}

/** The decoration badge: the status letter, 11px semibold at .75 opacity, in the git color
 * (inherited on a selected row of a focused list). */
function StatusBadge({ letter, color }: { letter: string; color: string }) {
  return (
    <span
      className="my-auto ms-[5px] me-[3px] inline-flex h-4 min-w-4 shrink-0 items-center justify-center font-semibold text-(--deco) text-caption leading-none opacity-75 group-focus-within/list:group-aria-selected/row:text-inherit"
      style={{ '--deco': color } as CSSProperties}
    >
      {letter}
    </span>
  )
}

export function ResourceList({ root, groups, header }: { root: string; groups: Group[]; header?: ReactNode }) {
  useLocale()
  const openDiffOnClick = useSetting<boolean>('git.openDiffOnClick')
  const viewMode = useSetting<string>('scm.defaultViewMode')
  const sortKey = useSetting<string>('scm.defaultViewSortKey')
  const [collapsed, setCollapsed] = useUiState<string[]>('scm.collapsedGroups', [])
  const [collapsedFolders, setCollapsedFolders] = useUiState<string[]>('scm.collapsedFolders', [])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [focusIndex, setFocusIndex] = useState(0)
  const [interacted, setInteracted] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [headerHeight, setHeaderHeight] = useState(0)

  // The rows start below the input and action button, which scroll with them
  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el) return
    const measure = () => setHeaderHeight(el.offsetHeight)
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    measure()
    return () => observer.disconnect()
  }, [])

  const { rows, folderFiles } = useMemo(() => {
    const list: Row[] = []
    // Every folder path to the changes under it, built once with the rows: a folder row needs
    // them for its menu and inline actions, and scanning the group per rendered row would be
    // O(visible folders x changes) on every scroll frame
    const under = new Map<string, FileChange[]>()
    for (const group of groups) {
      if (group.changes.length === 0 && group.id !== 'workingTree') continue
      list.push({ kind: 'group', group, depth: 1, ancestors: [] })
      if (collapsed.includes(group.id)) continue
      const changes = sortChanges(group.changes, sortKey)
      if (viewMode !== 'tree') {
        for (const change of changes) list.push({ kind: 'file', group, change, depth: 2, ancestors: [groupKey(group)] })
        continue
      }
      list.push(...treeRows(group, changes, collapsedFolders))
      for (const change of group.changes) {
        const parts = change.path.split('/')
        let path = ''
        for (let i = 0; i < parts.length - 1; i += 1) {
          path = path ? `${path}/${parts[i]}` : parts[i]
          const files = under.get(`${group.id}:${path}`)
          if (files) files.push(change)
          else under.set(`${group.id}:${path}`, [change])
        }
      }
    }
    return { rows: list, folderFiles: under }
  }, [groups, collapsed, collapsedFolders, viewMode, sortKey])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    scrollMargin: headerHeight,
  })

  const toggleGroup = (id: GroupId) =>
    setCollapsed(collapsed.includes(id) ? collapsed.filter((g) => g !== id) : [...collapsed, id])
  const folderKey = (row: Extract<Row, { kind: 'folder' }>) => `${row.group.id}:${row.path}`
  const toggleFolder = (row: Extract<Row, { kind: 'folder' }>) => {
    const k = folderKey(row)
    setCollapsedFolders(collapsedFolders.includes(k) ? collapsedFolders.filter((f) => f !== k) : [...collapsedFolders, k])
  }
  /** Files under a folder row (for its context menu and inline actions), in the group's order. */
  const folderChanges = (row: Extract<Row, { kind: 'folder' }>) => folderFiles.get(folderKey(row)) ?? []

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
    setInteracted(true)
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
    setInteracted(true)
    virtualizer.scrollToIndex(next)
    requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus())
  }

  const onKeyDown = (event: KeyboardEvent) => {
    // Only the rows navigate; inline action buttons keep their keys
    if ((event.target as HTMLElement).getAttribute('role') !== 'treeitem') return
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

  // The active indent guide: the focused folder or group when open, else the focused row's parent
  const focused = interacted ? rows[focusIndex] : undefined
  const focusedOpen =
    focused?.kind === 'group' ? !collapsed.includes(focused.group.id) : focused?.kind === 'folder' ? !collapsedFolders.includes(folderKey(focused)) : false
  const activeGuide = focused ? (focusedOpen ? rowId(focused) : (focused.ancestors.at(-1) ?? null)) : null
  const tree = viewMode === 'tree'

  return (
    <div ref={scrollRef} className="h-full overflow-auto">
      <div ref={headerRef}>{header}</div>
      <div
        role="tree"
        aria-multiselectable
        className="group/list relative w-full outline-none"
        style={{ height: virtualizer.getTotalSize() }}
        data-context={JSON.stringify({ listFocus: true, focusedView: 'workbench.scm' })}
        onKeyDown={onKeyDown}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          const style = { transform: `translateY(${item.start - headerHeight}px)` }
          const indent = row.depth * INDENT
          const common = {
            'data-index': item.index,
            tabIndex: item.index === focusIndex ? 0 : -1,
            className: treeRowClass,
            style,
            onFocus: () => setFocusIndex(item.index),
            onClick: (e: React.MouseEvent) => click(item.index, row, e),
          }
          if (row.kind === 'group') {
            const context = { scmProvider: 'git', scmResourceGroup: row.group.id }
            const expanded = !collapsed.includes(row.group.id)
            return (
              <ContextMenu key={groupKey(row.group)}>
                <ContextMenuTrigger
                  render={
                    <div
                      role="treeitem"
                      aria-level={1}
                      aria-expanded={expanded}
                      aria-label={`${row.group.label}, ${row.group.changes.length}`}
                      {...common}
                    />
                  }
                >
                  <Twistie indent={indent} state={expanded ? 'expanded' : 'collapsed'} />
                  <span className="min-w-0 flex-1 truncate">{row.group.label}</span>
                  <InlineActions menu="scm/resourceGroup/context" context={context} args={[groupSelection(row.group)]} />
                  <Badge className="ms-1.5">{row.group.changes.length}</Badge>
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
                    <div role="treeitem" aria-level={row.depth} aria-expanded={expanded} aria-label={row.name} {...common} />
                  }
                >
                  <IndentGuides ancestors={row.ancestors} active={activeGuide} />
                  <Twistie indent={indent} state={expanded ? 'expanded' : 'collapsed'} />
                  <RowLabel label={<FolderName name={row.name} />} />
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
          const context = { scmProvider: 'git', scmResourceGroup: group.id, scmResourceState: 'worktree' }
          const deleted = isDeletion(change.status)
          const tooltip = `${change.originalPath ? `${change.originalPath} → ` : ''}${change.path} • ${statusText(change.status)}`
          return (
            <ContextMenu key={k}>
              <ContextMenuTrigger
                render={
                  <div
                    role="treeitem"
                    aria-level={row.depth}
                    aria-selected={selected.has(k)}
                    aria-label={`${name}, ${statusText(change.status)}`}
                    data-selected={selected.has(k) || undefined}
                    title={tooltip}
                    {...common}
                  />
                }
              >
                <IndentGuides ancestors={row.ancestors} active={activeGuide} />
                {/* File icons align with the twisties, so a file has no twistie of its own */}
                <Twistie indent={indent} state="hidden" />
                <FileIcon path={change.path} className="me-1.5 opacity-70 group-aria-selected/row:opacity-100" />
                {/* The name is not tinted (`fileDecorations.colors: false`); only the letter is */}
                <RowLabel label={name} description={tree ? undefined : dir} className={cn(deleted && 'line-through')} />
                <InlineActions menu="scm/resourceState/context" context={context} args={[selectionFor(group, change)]} />
                <StatusBadge letter={LETTER[change.status]} color={statusColor(change.status)} />
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
