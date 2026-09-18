// The Commit Graph tab (GitLens's Commit Graph): every branch's commits with lanes, ref
// labels, search, and the selected commit's details. Rows load a page at a time as you scroll.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArchiveIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, CloudIcon, CopyIcon, GitBranchIcon, SearchIcon, TagIcon } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { MenuItems } from '@/commands/MenuItems'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuPopup, ContextMenuTrigger } from '@/components/ui/context-menu'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Toggle } from '@/components/ui/toggle'
import { gl, useLocale } from '@/i18n'
import { git, type GraphQuery, type GraphRef, type GraphRow, type RefInfo } from '@/lib/git'
import { errorMessage, ipc } from '@/lib/ipc'
import { fullDate, relativeTime } from '@/lib/time'
import { useUiState } from '@/lib/uiState'
import { cn } from '@/lib/utils'
import type { DetailTabProps } from '@/routes/detail/DetailApp'
import { Avatar } from '../avatars/Avatar'
import { type CommitArg, fileNode, openFileChange, shortSha, StatusLetter } from '../history/nodes'
import { parseSearch } from '../history/search'
import type { RefArg, StashArg } from '../refs/views'
import { LANE_WIDTH, Lanes, laneColor, ROW_HEIGHT } from './Lanes'

const PAGE = 200
const MAX_LANES_SHOWN = 24

type Options = Pick<GraphQuery, 'scope' | 'remotes' | 'tags' | 'stashes'>
const DEFAULT_OPTIONS: Options = { scope: 'all', remotes: true, tags: true, stashes: true }

export function graphLabel() {
  return gl('Commit Graph')
}

const REF_ICON: Record<GraphRef['kind'], typeof GitBranchIcon> = {
  head: CheckIcon,
  branch: GitBranchIcon,
  remote: CloudIcon,
  tag: TagIcon,
  stash: ArchiveIcon,
}

function refMenu(root: string, row: GraphRow, ref: GraphRef): { context: Record<string, unknown>; arg: unknown } | null {
  if (ref.kind === 'stash') {
    const index = Number(/\{(\d+)\}/.exec(ref.name)?.[1] ?? 0)
    const arg: StashArg = { root, stash: { index, commit: row.id, message: row.subject, time: row.committer.time } }
    return { context: { view: 'gitside.views.graph', viewItem: 'gitlens:stash' }, arg }
  }
  const kind: RefInfo['kind'] = ref.kind === 'remote' ? 'remote' : ref.kind === 'tag' ? 'tag' : 'branch'
  const prefix = { branch: 'refs/heads/', remote: 'refs/remotes/', tag: 'refs/tags/' }[kind]
  const info: RefInfo = { name: `${prefix}${ref.name}`, short: ref.name, kind, commit: row.id, time: row.committer.time, subject: row.subject }
  const viewItem = kind === 'tag' ? 'gitlens:tag' : kind === 'remote' ? 'gitlens:branch+remote' : `gitlens:branch${ref.kind === 'head' ? '+current' : ''}`
  if (ref.name === 'HEAD') return null
  return { context: { view: 'gitside.views.graph', viewItem }, arg: { root, ref: info } satisfies RefArg }
}

function RefBadge({ root, row, gref }: { root: string; row: GraphRow; gref: GraphRef }) {
  const Icon = REF_ICON[gref.kind]
  const badge = (
    <span
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm border px-1 text-[11px] leading-4',
        gref.kind === 'head' && 'font-semibold',
      )}
      style={{ borderColor: laneColor(row.lane), color: gref.kind === 'tag' || gref.kind === 'stash' ? undefined : laneColor(row.lane) }}
      title={gref.name}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{gref.name}</span>
    </span>
  )
  const menu = refMenu(root, row, gref)
  if (!menu) return badge
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<span className="min-w-0" />} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        {badge}
      </ContextMenuTrigger>
      <ContextMenuPopup>
        <MenuItems menu="view/item/context" kind="context" context={menu.context} args={[menu.arg]} />
      </ContextMenuPopup>
    </ContextMenu>
  )
}

function Details({ root, row }: { root: string; row: GraphRow }) {
  const locale = useLocale()
  const { data, error } = useQuery({ queryKey: ['repo', root, 'commit', row.id], queryFn: () => git.commitDetails(root, row.id), staleTime: Infinity })
  const parent = row.parents[0] ?? null
  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-s" aria-label={gl('Commit Details')}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Avatar root={root} name={row.author.name} email={row.author.email} sha={row.id} className="size-6 text-[9px]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{row.author.name}</div>
          <div className="truncate text-muted-foreground text-xs" title={fullDate(row.author.time, locale)}>
            {row.author.email} · {relativeTime(row.author.time, locale)}
          </div>
        </div>
        <Button size="xs" variant="ghost" className="font-mono" title={gl('Copy SHA')} onClick={() => void ipc.clipboardWrite(row.id)}>
          <CopyIcon />
          {shortSha(row.id)}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <p className="whitespace-pre-wrap break-words px-3 py-2 text-[13px]">{data?.message ?? row.subject}</p>
        {error && <p className="px-3 text-destructive-foreground text-xs">{errorMessage(error)}</p>}
        {data && (
          <>
            <div className="px-3 pt-2 pb-1 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
              {data.files.length === 1 ? gl('1 file changed') : gl('{0} files changed', data.files.length)}
            </div>
            <ul>
              {data.files.map((file) => {
                const node = fileNode(root, row.id, parent, file, row.id)
                return (
                  <li key={file.path}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 px-3 py-0.5 text-start text-[13px] hover:bg-accent/50"
                      title={node.tooltip}
                      onClick={() => openFileChange({ root, sha: row.id, parent, file })}
                    >
                      <span className="min-w-0 shrink truncate">{node.label}</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">{node.description}</span>
                      <StatusLetter status={file.status} />
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </aside>
  )
}

export function GraphTab({ params }: DetailTabProps) {
  const locale = useLocale()
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
  const graphWidth = lanes * LANE_WIDTH + 8
  const matches = useMemo(() => new Set(results?.ids ?? []), [results])

  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_HEIGHT, overscan: 20 })
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
    }
  }

  const selectedRow = rows.find((r) => r.id === selected)
  let body: ReactNode
  if (query.isPending) body = <div className="flex h-full items-center justify-center"><Spinner /></div>
  else if (query.error) body = <p className="p-4 text-destructive-foreground text-sm">{errorMessage(query.error)}</p>
  else if (rows.length === 0) body = <p className="p-4 text-muted-foreground text-sm">{gl('No commits could be found.')}</p>
  else
    body = (
      <div ref={scrollRef} role="grid" aria-label={graphLabel()} aria-rowcount={query.data?.pages[0]?.total} tabIndex={0} className="h-full overflow-auto outline-none" onKeyDown={onKeyDown}>
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => {
            const row = rows[item.index]
            const isSelected = row.id === selected
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
                        'absolute inset-x-0 top-0 flex cursor-default items-center text-[13px] hover:bg-accent/40',
                        isSelected && 'bg-accent',
                        matches.has(row.id) && !isSelected && 'bg-primary/10',
                        !row.current && 'text-muted-foreground',
                      )}
                      style={{ transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
                      onClick={() => setSelected(row.id)}
                    />
                  }
                >
                  <div role="gridcell" className="flex w-44 shrink-0 items-center gap-1 overflow-hidden px-2">
                    {row.refs.slice(0, 1).map((ref) => (
                      <RefBadge key={ref.name} root={root} row={row} gref={ref} />
                    ))}
                    {row.refs.length > 1 && (
                      <span className="shrink-0 text-[11px] text-muted-foreground" title={row.refs.map((r) => r.name).join('\n')}>
                        +{row.refs.length - 1}
                      </span>
                    )}
                  </div>
                  <div role="gridcell" className="shrink-0 overflow-hidden ps-1" style={{ width: graphWidth }}>
                    <Lanes row={row} width={graphWidth} selected={isSelected} />
                  </div>
                  <div role="gridcell" className="min-w-0 flex-1 truncate px-2" title={row.subject}>
                    {row.subject}
                  </div>
                  <div role="gridcell" className="flex w-40 shrink-0 items-center gap-1.5 truncate px-2 text-xs" title={`${row.author.name} <${row.author.email}>`}>
                    <Avatar root={root} name={row.author.name} email={row.author.email} sha={row.id} />
                    <span className="truncate">{row.author.name}</span>
                  </div>
                  <div role="gridcell" className="w-32 shrink-0 truncate px-2 text-muted-foreground text-xs" title={fullDate(row.author.time, locale)}>
                    {relativeTime(row.author.time, locale)}
                  </div>
                  <div role="gridcell" className="w-20 shrink-0 px-2 font-mono text-muted-foreground text-xs">
                    {shortSha(row.id)}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuPopup>
                  <MenuItems
                    menu="view/item/context"
                    kind="context"
                    context={{ view: 'gitside.views.graph', viewItem: row.stash ? 'gitlens:stash' : `gitlens:commit${row.current ? '+current' : ''}` }}
                    args={[arg]}
                  />
                </ContextMenuPopup>
              </ContextMenu>
            )
          })}
        </div>
      </div>
    )

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <Select value={options.scope} onValueChange={(scope) => setOptions({ ...options, scope: scope as Options['scope'] })}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue>{options.scope === 'all' ? gl('All Branches') : gl('Current Branch')}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="all">{gl('All Branches')}</SelectItem>
            <SelectItem value="current">{gl('Current Branch')}</SelectItem>
          </SelectPopup>
        </Select>
        {(['remotes', 'tags', 'stashes'] as const).map((key) => (
          <Toggle key={key} size="sm" variant="outline" pressed={options[key]} onPressedChange={(on) => setOptions({ ...options, [key]: on })}>
            {{ remotes: gl('Remote Branches'), tags: gl('Tags'), stashes: gl('Stashes') }[key]}
          </Toggle>
        ))}
        <form
          className="ms-auto flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            void runSearch()
          }}
        >
          <InputGroup className="w-72">
            <InputGroupInput
              placeholder={gl('Search commits (↵ to search)')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={gl('Search Commits')}
            />
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
          </InputGroup>
          {results && (
            <span className="min-w-14 text-center text-muted-foreground text-xs tabular-nums">
              {results.ids.length ? `${results.index + 1} / ${results.ids.length}` : gl('No results')}
            </span>
          )}
          <Button type="button" size="icon-sm" variant="ghost" aria-label={gl('Previous Match')} disabled={!results?.ids.length} onClick={() => step(-1)}>
            <ChevronUpIcon />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label={gl('Next Match')} disabled={!results?.ids.length} onClick={() => step(1)}>
            <ChevronDownIcon />
          </Button>
        </form>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 border-b text-[11px] font-medium text-muted-foreground" role="row">
            <div className="w-44 shrink-0 px-2 py-1">{gl('Branch / Tag')}</div>
            <div className="shrink-0 ps-1 py-1" style={{ width: graphWidth }}>
              {gl('Graph')}
            </div>
            <div className="min-w-0 flex-1 px-2 py-1">{gl('Commit Message')}</div>
            <div className="w-40 shrink-0 px-2 py-1">{gl('Author')}</div>
            <div className="w-32 shrink-0 px-2 py-1">{gl('Commit Date / Time')}</div>
            <div className="w-20 shrink-0 px-2 py-1">{gl('SHA')}</div>
          </div>
          <div className="min-h-0 flex-1">{body}</div>
        </div>
        {selectedRow && <Details root={root} row={selectedRow} />}
      </div>
    </div>
  )
}
