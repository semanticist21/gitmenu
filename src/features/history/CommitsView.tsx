// GitLens's Commits view: the current branch as the root ("main • 0↓ 3↑"), with its
// outgoing/incoming commits and a comparison against the upstream, then its commits a page
// at a time. Unpublished commits are marked, like GitLens.
import { ArrowDownIcon, CloudUploadIcon, GitBranchIcon, GitCompareIcon, MinusIcon } from 'lucide-react'
import { gl, useLocale } from '@/i18n'
import { git } from '@/lib/git'
import { errorMessage } from '@/lib/ipc'
import { relativeTime } from '@/lib/time'
import { useRepoStatus } from '../scm/api'
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
    if (upstream.ahead > 0) {
      children.push({
        id: 'outgoing',
        label: gl('Outgoing'),
        description: gl('{0} to push to {1}', pluralCommits(upstream.ahead), upstream.remote),
        icon: <CloudUploadIcon className="text-[var(--git-added)]" />,
        contextValue: 'gitlens:status-branch:upstream+ahead',
        arg,
        loadChildren: range(['HEAD'], [upstream.name], 'outgoing', ['unpublished']),
      })
    }
    if (upstream.behind > 0) {
      children.push({
        id: 'incoming',
        label: gl('Incoming'),
        description: gl('{0} to pull from {1}', pluralCommits(upstream.behind), upstream.remote),
        icon: <ArrowDownIcon className="text-[var(--git-modified)]" />,
        contextValue: 'gitlens:status-branch:upstream+behind',
        arg,
        loadChildren: range([upstream.name], ['HEAD'], 'incoming', []),
      })
    }
    const compare: SearchCompareItem = { id: `compare:${head.branch}..${upstream.name}`, kind: 'compare', base: head.branch, head: upstream.name }
    children.push({
      id: 'compare',
      label: gl('Compare {0} with {1}', head.branch, upstream.name),
      icon: <GitCompareIcon className="text-muted-foreground" />,
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
    const fetched = status?.fetchedAt ? gl('fetched {0}', relativeTime(status.fetchedAt, locale)) : null
    const published = upstream ? null : status && status.remotes.length > 0 ? gl("hasn't been published to {0}", status.remotes.includes('origin') ? 'origin' : status.remotes[0]) : null
    children.push({
      id: 'branch-status',
      label: [gl('on {0}', head.branch), published ?? fetched].filter(Boolean).join(' • '),
      icon: <MinusIcon className="text-muted-foreground" />,
      message: true,
    })
  }

  if (log.error) children.push(messageNode('error', errorMessage(log.error)))
  else if (!log.isPending && log.commits.length === 0) children.push(messageNode('empty', gl('No commits could be found.')))
  for (const commit of log.commits) {
    const unpublished = upstream ? log.commits.indexOf(commit) < upstream.ahead : false
    children.push(commitNode(root, commit, { idPrefix: 'log', locale, flags: unpublished ? ['current', 'unpublished'] : ['current'] }))
  }
  if (log.more) children.push(loadMore('log/more', log.loadingMore, log.loadMore))

  const counts = upstream ? `${upstream.behind}↓ ${upstream.ahead}↑` : undefined
  const nodes: TreeNode[] = head
    ? [
        {
          id: 'branch',
          label: head.branch ?? gl('detached'),
          description: counts,
          icon: <GitBranchIcon className="text-muted-foreground" />,
          contextValue: `gitlens:branch+current${upstream ? '+tracking' : ''}`,
          arg: { root, ref: { name: `refs/heads/${head.branch ?? 'HEAD'}`, short: head.branch ?? 'HEAD', kind: 'branch', commit: head.commit, time: null, subject: null } },
          expanded: true,
          children,
        },
      ]
    : []
  return <ViewTree viewId="gitmenu.views.commits" nodes={nodes} label={gl('Commits')} />
}
