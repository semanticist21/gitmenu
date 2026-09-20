// The Commit Graph tab (GitLens's Commit Graph): every branch's commits with lanes, ref
// labels, search, and the selected commit's details. Rows load a page at a time as you scroll.
// Drawn in VS Code's own styling: a 22px table with column headers, codicon ref labels in the
// lane color, VS Code list selection, and a Commit Details side pane.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MenuItems } from '@/commands/MenuItems'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuPopup, ContextMenuTrigger } from '@/components/ui/context-menu'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { ProgressBar } from '@/components/ui/progress'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { EditorPlaceholder, useDarkMode } from '@/features/diff/DiffTab'
import { gl, useLocale } from '@/i18n'
import { git, type GraphQuery, type GraphRef, type GraphRow, type RefInfo } from '@/lib/git'
import { errorMessage, ipc } from '@/lib/ipc'
import { fullDate, relativeTime } from '@/lib/time'
import { useUiState } from '@/lib/uiState'
import { cn } from '@/lib/utils'
import type { DetailTabProps } from '@/routes/detail/DetailApp'
import { ActionButton, NativeSelect } from '@/routes/detail/EditorChrome'
import { useSetting } from '@/settings/settings'
import { ROW_HEIGHT } from '@/theme/metrics'
import { Avatar } from '../avatars/Avatar'
import { type CommitArg, fileNode, openFileChange, shortSha, StatusLetter } from '../history/nodes'
import { parseSearch } from '../history/search'
import type { RefArg, StashArg } from '../refs/views'
import { LANE_WIDTH, Lanes, laneColor } from './Lanes'

const PAGE = 200
const MAX_LANES_SHOWN = 24

type Options = Pick<GraphQuery, 'scope' | 'remotes' | 'tags' | 'stashes'>
const DEFAULT_OPTIONS: Options = { scope: 'all', remotes: true, tags: true, stashes: true }

export function graphLabel() {
  return gl('Commit Graph')
}

// Codicons of VS Code's graph ref labels (HEAD `target`, remote `cloud`, tag `tag`, stash `git-stash`)
const REF_ICON: Record<GraphRef['kind'], string> = {
  head: 'target',
  branch: 'git-branch',
  remote: 'cloud',
  tag: 'tag',
  stash: 'git-stash',
}

// Column widths (the graph column depends on the lane count; the message takes the rest)
const COLUMNS = { refs: 150, author: 130, date: 130, sha: 72 }

function refMenu(root: string, row: GraphRow, ref: GraphRef): { context: Record<string, unknown>; arg: unknown } | null {
  if (ref.kind === 'stash') {
    const index = Number(/\{(\d+)\}/.exec(ref.name)?.[1] ?? 0)
    const arg: StashArg = { root, stash: { index, commit: row.id, message: row.subject, time: row.committer.time } }
    return { context: { view: 'gitmenu.views.graph', viewItem: 'gitlens:stash' }, arg }
  }
  if (ref.name === 'HEAD') return null
  const kind: RefInfo['kind'] = ref.kind === 'remote' ? 'remote' : ref.kind === 'tag' ? 'tag' : 'branch'
  const prefix = { branch: 'refs/heads/', remote: 'refs/remotes/', tag: 'refs/tags/' }[kind]
  const info: RefInfo = { name: `${prefix}${ref.name}`, short: ref.name, kind, commit: row.id, time: row.committer.time, subject: row.subject }
  const viewItem = kind === 'tag' ? 'gitlens:tag' : kind === 'remote' ? 'gitlens:branch+remote' : `gitlens:branch${ref.kind === 'head' ? '+current' : ''}`
  return { context: { view: 'gitmenu.views.graph', viewItem }, arg: { root, ref: info } satisfies RefArg }
}

/**
 * A ref label (scm.css `.label`): 18px, 10px radius, filled with the lane color and drawn in
 * the panel background; tags and stashes use the badge colors. The first label names its
 * ref; the rest collapse to icons with a count.
 */
function RefLabel({ root, row, refs, named, dark }: { root: string; row: GraphRow; refs: GraphRef[]; named: boolean; dark: boolean }) {
  const ref = refs[0]
  const colored = ref.kind !== 'tag' && ref.kind !== 'stash'
  const label = (
    <span
      className={cn(
        'flex h-[18px] min-w-0 shrink-0 items-center rounded-label text-small leading-[18px]',
        ref.kind === 'head' && 'font-semibold',
        colored ? 'text-background' : 'bg-badge text-foreground',
      )}
      style={colored ? { backgroundColor: laneColor(row.lane, dark) } : undefined}
      title={refs.map((r) => r.name).join('\n')}
    >
      {refs.length > 1 && <span className="ps-1">{refs.length}</span>}
      <Icon name={REF_ICON[ref.kind]} className={ref.kind === 'branch' ? 'p-[3px] text-small' : 'p-px'} />
      {named && <span className="max-w-[100px] truncate pe-1">{ref.name}</span>}
    </span>
  )
  const menu = refMenu(root, row, ref)
  if (!menu) return label
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<span className="flex min-w-0" />} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        {label}
      </ContextMenuTrigger>
      <ContextMenuPopup>
        <MenuItems menu="view/item/context" kind="context" context={menu.context} args={[menu.arg]} />
      </ContextMenuPopup>
    </ContextMenu>
  )
}

function RefLabels({ root, row, dark }: { root: string; row: GraphRow; dark: boolean }) {
  if (row.refs.length === 0) return null
  const [first, ...rest] = row.refs
  // The rest group by kind, as VS Code groups labels by color and icon
  const groups = new Map<string, GraphRef[]>()
  for (const ref of rest) groups.set(ref.kind, [...(groups.get(ref.kind) ?? []), ref])
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden">
      <RefLabel root={root} row={row} refs={[first]} named dark={dark} />
      {[...groups.values()].map((refs) => (
        <RefLabel key={refs[0].kind} root={root} row={row} refs={refs} named={false} dark={dark} />
      ))}
    </div>
  )
}

/** The Commit Details pane: author, SHA, message and the changed files as a VS Code tree. */
function Details({ root, row }: { root: string; row: GraphRow }) {
  const locale = useLocale()
  const { data, error } = useQuery({ queryKey: ['repo', root, 'commit', row.id], queryFn: () => git.commitDetails(root, row.id), staleTime: Infinity })
  const parent = row.parents[0] ?? null
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [headerHeight, setHeaderHeight] = useState(0)
  const files = data?.files

  // The file rows start below the commit's author, SHA and message, which scroll with them
  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el) return
    const measure = () => setHeaderHeight(el.offsetHeight)
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    measure()
    return () => observer.disconnect()
  }, [])

  // A commit can touch tens of thousands of files (an import, a vendor drop, a format sweep),
  // so the list is virtualized like every other list in the app
  const virtualizer = useVirtualizer({
    count: files?.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    scrollMargin: headerHeight,
  })

  return (
    <aside
      className="flex w-80 shrink-0 flex-col overflow-hidden border-sidebar-border border-l bg-sidebar text-sidebar-foreground"
      aria-label={gl('Commit Details')}
    >
      <div className="flex h-pane-header shrink-0 items-center truncate ps-5 pe-2 font-bold text-caption text-section-header-foreground uppercase">
        {gl('Commit Details')}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div ref={headerRef}>
          <div className="flex items-center gap-2 px-3 pt-2">
            <Avatar root={root} name={row.author.name} email={row.author.email} sha={row.id} className="size-8 text-caption" />
            <div className="min-w-0 flex-1 leading-[18px]">
              <div className="truncate font-semibold">{row.author.name}</div>
              <div className="truncate text-small opacity-95 dark:opacity-70" title={fullDate(row.author.time, locale)}>
                {relativeTime(row.author.time, locale)} ({fullDate(row.author.time, locale)})
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 px-3 pt-2">
            <Button size="small" variant="secondary" className="font-mono" onClick={() => void ipc.clipboardWrite(row.id)}>
              <Icon name="git-commit" />
              {shortSha(row.id)}
            </Button>
            <ActionButton icon="copy" label={gl('Copy SHA')} small onClick={() => void ipc.clipboardWrite(row.id)} />
          </div>
          <p className="select-text whitespace-pre-wrap break-words px-3 py-2">{data?.message ?? row.subject}</p>
          {error && <p className="select-text px-3 text-error">{errorMessage(error)}</p>}
          {files && (
            <div className="flex h-pane-header items-center border-section-header-border border-t ps-5 font-bold text-caption uppercase">
              {files.length === 1 ? gl('1 file changed') : gl('{0} files changed', files.length)}
            </div>
          )}
        </div>
        {files && (
          <div role="tree" aria-label={gl('{0} files changed', files.length)} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const file = files[item.index]
              const node = fileNode(root, row.id, parent, file, row.id)
              return (
                <div
                  key={file.path}
                  role="treeitem"
                  tabIndex={-1}
                  className="absolute inset-x-0 top-0 flex h-row cursor-default items-center ps-2 pe-3 leading-row outline-none hover:bg-list-hover focus:bg-list-active focus:text-list-active-foreground focus:outline-solid focus:outline-1 focus:-outline-offset-1 focus:outline-list-focus-outline"
                  style={{ transform: `translateY(${item.start - headerHeight}px)` }}
                  title={node.tooltip}
                  onClick={() => openFileChange({ root, sha: row.id, parent, file })}
                  onKeyDown={(e) => e.key === 'Enter' && openFileChange({ root, sha: row.id, parent, file })}
                >
                  <Icon name="file" className="me-1.5" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="whitespace-pre">{node.label}</span>
                    {node.description && <span className="ms-[.5em] whitespace-pre text-label-description opacity-95 dark:opacity-70">{node.description}</span>}
                  </span>
                  <span className="ms-[5px] me-[3px] inline-flex">
                    <StatusLetter status={file.status} />
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}

export function GraphTab({ params }: DetailTabProps) {
  const locale = useLocale()
  const dark = useDarkMode()
  const avatars = useSetting<boolean>('gitmenu.avatars.enabled')
  const root = params.get('repo') ?? ''
  const [options, setOptions] = useUiState<Options>('graph.options', DEFAULT_OPTIONS)
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<{ ids: string[]; index: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const query = useInfiniteQuery({
    queryKey: ['repo', root, 'graph', options],
    queryFn: ({ pageParam }) => git.graph(root, { ...options, skip: pageParam, limit: PAGE }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.more ? pages.reduce((n, p) => n + p.rows.length, 0) : undefined),
    staleTime: Infinity,
  })
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.rows) ?? [], [query.data])
  const lanes = Math.min(query.data?.pages[0]?.lanes ?? 1, MAX_LANES_SHOWN)
  const graphWidth = Math.max(64, lanes * LANE_WIDTH + 8)
  const matches = useMemo(() => new Set(results?.ids ?? []), [results])

  // The column headers scroll sideways with the rows and stick to the top (22px above the list)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    scrollMargin: ROW_HEIGHT,
    overscan: 20,
  })
  const items = virtualizer.getVirtualItems()
  const lastIndex = items[items.length - 1]?.index ?? 0

  // Load the next page before the user reaches the end
  useEffect(() => {
    if (lastIndex > rows.length - 50 && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
  }, [lastIndex, rows.length, query])

  const select = (index: number) => {
    const row = rows[index]
    if (!row) return
    setSelected(row.id)
    virtualizer.scrollToIndex(index, { align: 'auto' })
  }

  const jumpTo = async (id: string) => {
    let index = rows.findIndex((r) => r.id === id)
    // Results can be further down than what's loaded
    while (index === -1 && query.hasNextPage) {
      const next = await query.fetchNextPage()
      index = (next.data?.pages.flatMap((p) => p.rows) ?? []).findIndex((r) => r.id === id)
      if (!next.hasNextPage) break
    }
    if (index >= 0) {
      setSelected(id)
      requestAnimationFrame(() => virtualizer.scrollToIndex(index, { align: 'center' }))
    }
  }

  const runSearch = async () => {
    const text = search.trim()
    if (!text) {
      setResults(null)
      return
    }
    const refs = await git.refs(root)
    const revs = ['HEAD', ...refs.filter((r) => r.kind === 'branch' || (options.remotes && r.kind === 'remote') || (options.tags && r.kind === 'tag')).map((r) => r.name)]
    const page = await git.log(root, { revs: options.scope === 'all' ? revs : ['HEAD'], search: parseSearch(text), limit: 500 })
    const ids = page.commits.map((c) => c.id)
    setResults({ ids, index: 0 })
    if (ids[0]) void jumpTo(ids[0])
  }

  const step = (delta: number) => {
    if (!results || results.ids.length === 0) return
    const index = (results.index + delta + results.ids.length) % results.ids.length
    setResults({ ...results, index })
    void jumpTo(results.ids[index])
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const index = rows.findIndex((r) => r.id === selected)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      select(index + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      select(Math.max(0, index - 1))
    } else if (event.key === 'Escape' && selected) {
      event.preventDefault()
      setSelected(null)
    }
  }

  // Column borders show while the table is hovered (table.css: 0.2s)
  const columnBorder =
    'border-l border-transparent first:border-l-0 group-hover/grid:border-table-column-border transition-[border-color] duration-columns ease-columns motion-reduce:transition-none'
  const header = cn('flex h-full shrink-0 items-center overflow-hidden truncate ps-2.5', columnBorder)
  const columnHeaders = (
    <div className="sticky top-0 z-10 flex h-row min-w-[640px] border-tab-strip-border border-b bg-editor font-semibold text-small" role="row">
      <div role="columnheader" className={header} style={{ width: COLUMNS.refs }}>
        {gl('Branch / Tag')}
      </div>
      <div role="columnheader" className={header} style={{ width: graphWidth }}>
        {gl('Graph')}
      </div>
      <div role="columnheader" className={cn(header, 'min-w-0 flex-1 shrink')}>
        {gl('Commit Message')}
      </div>
      <div role="columnheader" className={header} style={{ width: COLUMNS.author }}>
        {gl('Author')}
      </div>
      <div role="columnheader" className={header} style={{ width: COLUMNS.date }}>
        {gl('Commit Date / Time')}
      </div>
      <div role="columnheader" className={header} style={{ width: COLUMNS.sha }}>
        {gl('SHA')}
      </div>
    </div>
  )

  const selectedRow = rows.find((r) => r.id === selected)
  const cell = cn('flex h-full shrink-0 items-center overflow-hidden ps-2.5', columnBorder)
  let body: ReactNode
  if (query.isPending) body = <ProgressBar className="absolute inset-x-0 top-0 z-10" />
  else if (query.error) body = <EditorPlaceholder icon="error" message={errorMessage(query.error)} />
  else if (rows.length === 0) body = <EditorPlaceholder icon="info" message={gl('No commits could be found.')} />
  else
    body = (
      <div
        ref={scrollRef}
        role="grid"
        aria-label={graphLabel()}
        aria-rowcount={query.data?.pages[0]?.total}
        tabIndex={0}
        className="group/grid h-full overflow-auto outline-none [&::-webkit-scrollbar]:size-3.5"
        onKeyDown={onKeyDown}
      >
        {columnHeaders}
        <div className="relative min-w-[640px]" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => {
            const row = rows[item.index]
            const isSelected = row.id === selected
            const isHead = row.refs.some((r) => r.kind === 'head')
            const arg: CommitArg = { root, commit: row }
            return (
              <ContextMenu key={row.id}>
                <ContextMenuTrigger
                  render={
                    <div
                      role="row"
                      aria-rowindex={item.index + 1}
                      aria-selected={isSelected}
                      className={cn(
                        'absolute inset-x-0 top-0 flex cursor-default items-center text-ui',
                        isSelected
                          ? 'bg-list-inactive group-focus/grid:bg-list-active group-focus/grid:text-list-active-foreground group-focus/grid:outline-solid group-focus/grid:outline-1 group-focus/grid:-outline-offset-1 group-focus/grid:outline-list-selection-outline'
                          : matches.has(row.id)
                            ? 'bg-find-match'
                            : 'hover:bg-list-hover',
                      )}
                      style={{ transform: `translateY(${item.start - ROW_HEIGHT}px)`, height: ROW_HEIGHT }}
                      onClick={() => setSelected(row.id)}
                    />
                  }
                >
                  <div role="gridcell" className={cn(cell, 'pe-1')} style={{ width: COLUMNS.refs }}>
                    <RefLabels root={root} row={row} dark={dark} />
                  </div>
                  <div role="gridcell" className={cn('h-full shrink-0 overflow-hidden ps-1', columnBorder)} style={{ width: graphWidth }}>
                    <Lanes root={root} row={row} width={graphWidth} dark={dark} avatars={avatars} />
                  </div>
                  <div role="gridcell" className={cn(cell, 'min-w-0 flex-1 shrink pe-2')} title={row.subject}>
                    <span className={cn('truncate', isHead && 'font-semibold')}>{row.subject}</span>
                  </div>
                  <div role="gridcell" className={cell} style={{ width: COLUMNS.author }} title={`${row.author.name} <${row.author.email}>`}>
                    <span className="truncate">{row.author.name}</span>
                  </div>
                  <div role="gridcell" className={cell} style={{ width: COLUMNS.date }} title={fullDate(row.author.time, locale)}>
                    <span className="truncate">{relativeTime(row.author.time, locale)}</span>
                  </div>
                  <div role="gridcell" className={cn(cell, 'font-mono text-small')} style={{ width: COLUMNS.sha }}>
                    {shortSha(row.id)}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuPopup>
                  <MenuItems
                    menu="view/item/context"
                    kind="context"
                    context={{ view: 'gitmenu.views.graph', viewItem: row.stash ? 'gitlens:stash' : `gitlens:commit${row.current ? '+current' : ''}` }}
                    args={[arg]}
                  />
                </ContextMenuPopup>
              </ContextMenu>
            )
          })}
        </div>
      </div>
    )

  const filters = { remotes: gl('Remote Branches'), tags: gl('Tags'), stashes: gl('Stashes') }
  return (
    <div className="flex h-full flex-col">
      {/* The graph's toolbar: branch scope, filters, then the commit search (a find widget) */}
      <div className="flex h-[35px] shrink-0 items-center gap-1 border-tab-strip-border border-b px-2">
        <NativeSelect
          compact
          aria-label={gl('All Branches')}
          className="w-36"
          value={options.scope}
          options={[
            { value: 'all', label: gl('All Branches') },
            { value: 'current', label: gl('Current Branch') },
          ]}
          onChange={(scope) => setOptions({ ...options, scope: scope as Options['scope'] })}
        />
        <Menu>
          <Tooltip>
            <TooltipTrigger render={<MenuTrigger render={<Button size="icon" variant="action" aria-label={gl('Graph Filtering')} />} />}>
              <Icon name="filter" />
            </TooltipTrigger>
            <TooltipPopup>{gl('Graph Filtering')}</TooltipPopup>
          </Tooltip>
          <MenuPopup>
            {(['remotes', 'tags', 'stashes'] as const).map((key) => (
              <MenuCheckboxItem key={key} closeOnClick={false} checked={options[key]} onCheckedChange={(on) => setOptions({ ...options, [key]: on })}>
                {filters[key]}
              </MenuCheckboxItem>
            ))}
          </MenuPopup>
        </Menu>
        <form
          className="ms-auto flex min-w-0 items-center gap-0.5"
          onSubmit={(e) => {
            e.preventDefault()
            void runSearch()
          }}
        >
          <InputGroup className="w-72 min-w-0">
            <InputGroupInput
              placeholder={gl('Search commits (↵ to search)')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={gl('Search Commits')}
            />
            {search && (
              <InputGroupAddon align="inline-end">
                <button
                  type="button"
                  aria-label={gl('Clear Results')}
                  className="flex cursor-pointer rounded-inset text-inherit hover:bg-input-option-hover"
                  onClick={() => {
                    setSearch('')
                    setResults(null)
                  }}
                >
                  <Icon name="close" />
                </button>
              </InputGroupAddon>
            )}
          </InputGroup>
          {results && (
            <span className="min-w-14 shrink-0 px-1 text-center text-small tabular-nums">
              {results.ids.length ? `${results.index + 1} / ${results.ids.length}` : gl('No results')}
            </span>
          )}
          <ActionButton icon="arrow-up" label={gl('Previous Match')} small disabled={!results?.ids.length} onClick={() => step(-1)} />
          <ActionButton icon="arrow-down" label={gl('Next Match')} small disabled={!results?.ids.length} onClick={() => step(1)} />
        </form>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">{body}</div>
        </div>
        {selectedRow && <Details root={root} row={selectedRow} />}
      </div>
    </div>
  )
}
