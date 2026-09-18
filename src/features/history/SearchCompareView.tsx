// GitLens's Search & Compare view: commit searches and branch/tag/commit comparisons, kept
// per repository until dismissed.
import { GitCompareIcon, SearchIcon } from 'lucide-react'
import { type QuickPickItem, showQuickPick } from '@/components/dialogs/dialogs'
import { gl, useLocale } from '@/i18n'
import { git, type RefInfo } from '@/lib/git'
import { useUiState } from '@/lib/uiState'
import type { ViewProps } from '../views/registry'
import { asyncChildren, type TreeNode, ViewTree } from '../views/ViewTree'
import { pluralCommits } from './CommitsView'
import { commitNode, fileNode, messageNode, shortSha } from './nodes'
import { parseSearch } from './search'

/** GitLens's `advanced.maxSearchItems` and `advanced.maxListItems` */
const MAX_ITEMS = 200

export type SearchCompareItem =
  | { id: string; kind: 'search'; query: string }
  | { id: string; kind: 'compare'; base: string; head: string }

/** The argument for commands on a result row. */
export interface ResultArg {
  root: string
  item: SearchCompareItem
}

const refLabel = (ref: string) => (/^[0-9a-f]{40}$/.test(ref) ? shortSha(ref) : ref)

export async function pickReference(root: string, placeholder: string, exclude?: string): Promise<string | undefined> {
  const refs = await git.refs(root)
  const kindLabel = (r: RefInfo) => (r.kind === 'branch' ? gl('Branch') : r.kind === 'remote' ? gl('Remote Branch') : gl('Tag'))
  const items: QuickPickItem<string>[] = [
    { label: 'HEAD', description: gl('Current'), value: 'HEAD' },
    ...refs
      .filter((r) => r.short !== exclude)
      .sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
      .map((r) => ({ label: r.short, description: `${kindLabel(r)} · ${r.commit?.slice(0, 7) ?? ''}`, detail: r.subject ?? undefined, value: r.short })),
  ]
  return showQuickPick(items, { placeholder })
}

export function SearchCompareView({ repo }: ViewProps) {
  const locale = useLocale()
  const root = repo.root
  const [items] = useUiState<SearchCompareItem[]>(`searchCompare.${root}`, [])

  const nodes: TreeNode[] = items.map((item) => {
    const arg: ResultArg = { root, item }
    if (item.kind === 'search') {
      const search = parseSearch(item.query)
      return {
        id: item.id,
        label: gl('Results for {0}', `"${item.query}"`),
        icon: <SearchIcon className="text-muted-foreground" />,
        contextValue: 'gitlens:search:results',
        arg,
        expanded: true,
        loadChildren: asyncChildren({
          queryKey: ['repo', root, 'search', item.query],
          queryFn: () => git.log(root, { search, limit: MAX_ITEMS }),
          build: (page) =>
            page.commits.length === 0
              ? [messageNode(`${item.id}/none`, gl('No results found'))]
              : page.commits.map((c) => commitNode(root, c, { idPrefix: item.id, locale })),
        }),
      }
    }
    return {
      id: item.id,
      label: gl('Comparing {0} with {1}', refLabel(item.head), refLabel(item.base)),
      icon: <GitCompareIcon className="text-muted-foreground" />,
      contextValue: 'gitlens:compare:results',
      arg,
      expanded: true,
      loadChildren: asyncChildren({
        queryKey: ['repo', root, 'compare', item.base, item.head],
        queryFn: () => git.compare(root, item.base, item.head),
        build: (cmp) => {
          const list = (id: string, revs: string[], hide: string[]) =>
            asyncChildren({
              queryKey: ['repo', root, 'log', 'compare', revs, hide],
              queryFn: () => git.log(root, { revs, hide, limit: MAX_ITEMS }),
              build: (page) => page.commits.map((c) => commitNode(root, c, { idPrefix: `${item.id}/${id}`, locale })),
            })
          const from = cmp.mergeBase ?? cmp.base
          return [
            {
              id: `${item.id}/behind`,
              label: gl('Behind'),
              description: pluralCommits(cmp.behind),
              loadChildren: cmp.behind ? list('behind', [cmp.base], [cmp.head]) : undefined,
            },
            {
              id: `${item.id}/ahead`,
              label: gl('Ahead'),
              description: pluralCommits(cmp.ahead),
              loadChildren: cmp.ahead ? list('ahead', [cmp.head], [cmp.base]) : undefined,
            },
            {
              id: `${item.id}/files`,
              label: cmp.files.length === 1 ? gl('1 file changed') : gl('{0} files changed', cmp.files.length),
              children: cmp.files.length ? cmp.files.map((f) => fileNode(root, cmp.head, from, f, `${item.id}/files`)) : undefined,
            },
          ]
        },
      }),
    }
  })
  if (nodes.length === 0) nodes.push(messageNode('empty', gl('Search for commits or compare references using the buttons above.')))
  return <ViewTree viewId="gitside.views.searchCompare" nodes={nodes} label={gl('Search & Compare')} />
}
