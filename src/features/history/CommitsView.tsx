// GitLens's Commits view for one repository: the branch's rows at the root (GitLens splats the
// repository node and shows "main • 1↓ 2↑" as the view description): incoming and outgoing
// commits, a comparison against the upstream, the "— on main • fetched …" separator, then the
// commits a page at a time. Unpublished commits are marked, like GitLens.
import { Icon } from '@/components/Icon'
import { gl, useLocale } from '@/i18n'
import { git } from '@/lib/git'
import { errorMessage } from '@/lib/ipc'
import { relativeTime } from '@/lib/time'
import { useRepoStatus } from '../scm/api'
import { useViewDescription } from '../views/description'
import type { ViewProps } from '../views/registry'
import { asyncChildren, loadMore, type TreeNode, ViewTree } from '../views/ViewTree'
import { usePagedLog } from './api'
import { commitNode, messageNode } from './nodes'
import type { SearchCompareItem } from './SearchCompareView'

export function pluralCommits(n: number) {
  return n === 1 ? gl('1 commit') : gl('{0} commits', n)
}

export function CommitsView({ repo }: ViewProps) {
  const locale = useLocale()
  const root = repo.root
  const { data: status } = useRepoStatus(root)
  const log = usePagedLog(['repo', root, 'log', 'HEAD'], (skip, limit) => git.log(root, { skip, limit }))
  const head = status?.head
  const upstream = status?.upstream ?? null
  const arg = { root }

  const range = (revs: string[], hide: string[], id: string, flags: string[]) =>
    asyncChildren({
      queryKey: ['repo', root, 'log', id, revs, hide],
      queryFn: () => git.log(root, { revs, hide, limit: 1000 }),
      build: (page) => page.commits.map((c) => commitNode(root, c, { idPrefix: id, locale, flags })),
    })

  const children: TreeNode[] = []
  if (head?.branch && upstream) {
    // GitLens lists Incoming before Outgoing
    if (upstream.behind > 0) {
      children.push({
        id: 'incoming',
        label: gl('Incoming'),
        description: gl('{0} to pull from {1}', pluralCommits(upstream.behind), upstream.remote),
        icon: <Icon name="cloud-download" className="text-gitlens-unpulled" />,
        contextValue: 'gitlens:status-branch:upstream+behind',
        arg,
        loadChildren: range([upstream.name], ['HEAD'], 'incoming', []),
      })
    }
    if (upstream.ahead > 0) {
      children.push({
        id: 'outgoing',
        label: gl('Outgoing'),
        description: gl('{0} to push to {1}', pluralCommits(upstream.ahead), upstream.remote),
        icon: <Icon name="cloud-upload" className="text-gitlens-unpublished" />,
        contextValue: 'gitlens:status-branch:upstream+ahead',
        arg,
        loadChildren: range(['HEAD'], [upstream.name], 'outgoing', ['unpublished']),
      })
    }
    const compare: SearchCompareItem = { id: `compare:${head.branch}..${upstream.name}`, kind: 'compare', base: head.branch, head: upstream.name }
    children.push({
      id: 'compare',
      label: gl('Compare {0} with {1}', head.branch, upstream.name),
      icon: <Icon name="git-compare" />,
      arg: { root, item: compare },
      loadChildren: asyncChildren({
        queryKey: ['repo', root, 'compare', head.branch, upstream.name],
        queryFn: () => git.compare(root, head.branch!, upstream.name),
        build: (cmp) => [
          { id: 'compare/behind', label: gl('Behind'), description: pluralCommits(cmp.behind), loadChildren: cmp.behind ? range([upstream.name], ['HEAD'], 'compare/behind', []) : undefined },
          { id: 'compare/ahead', label: gl('Ahead'), description: pluralCommits(cmp.ahead), loadChildren: cmp.ahead ? range(['HEAD'], [upstream.name], 'compare/ahead', ['unpublished']) : undefined },
        ],
      }),
    })
  }
  if (head?.branch) {
    // GitLens's CommitsCurrentBranchNode: an empty label with the description
    // "—  on main • fetched 2 minutes ago", no icon
    const fetched = status?.fetchedAt ? gl('fetched {0}', relativeTime(status.fetchedAt, locale)) : null
    const published = upstream ? null : status && status.remotes.length > 0 ? gl("hasn't been published to {0}", status.remotes.includes('origin') ? 'origin' : status.remotes[0]) : null
    const context = published ?? fetched
    children.push({
      id: 'branch-status',
      label: '',
      description: `\u2014\u00a0\u00a0 ${gl('on {0}', head.branch)}${context ? ` \u00a0\u2022\u00a0 ${context}` : ''}`,
    })
  }

  if (log.error) children.push(messageNode('error', errorMessage(log.error)))
  else if (!log.isPending && log.commits.length === 0) children.push(messageNode('empty', gl('No commits could be found.')))
  for (const commit of log.commits) {
    const unpublished = upstream ? log.commits.indexOf(commit) < upstream.ahead : false
    children.push(commitNode(root, commit, { idPrefix: 'log', locale, flags: unpublished ? ['current', 'unpublished'] : ['current'] }))
  }
  if (log.more) children.push(loadMore('log/more', log.loadingMore, log.loadMore))

  // The view description: the branch, then behind↓ ahead↑ when not in sync
  const tracking = upstream && (upstream.ahead || upstream.behind) ? `${upstream.behind}↓ ${upstream.ahead}↑` : null
  const branchLabel = head ? (head.branch ?? gl('detached')) : null
  useViewDescription('commits', branchLabel ? [branchLabel, tracking].filter(Boolean).join(' \u2022 ') : undefined)

  return <ViewTree viewId="gitmenu.views.commits" nodes={head ? children : []} label={gl('Commits')} />
}
