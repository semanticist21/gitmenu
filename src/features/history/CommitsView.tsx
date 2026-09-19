// GitLens's Commits view: the current branch's sync status against its upstream (with the
// outgoing and incoming commits), then its commits, a page at a time.
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CloudUploadIcon } from 'lucide-react'
import { gl, useLocale } from '@/i18n'
import { git } from '@/lib/git'
import { errorMessage } from '@/lib/ipc'
import { useRepoStatus } from '../scm/api'
import type { ViewProps } from '../views/registry'
import { asyncChildren, type TreeNode, ViewTree } from '../views/ViewTree'
import { usePagedLog } from './api'
import { commitNode, loadMoreNode, messageNode } from './nodes'

export function pluralCommits(n: number) {
  return n === 1 ? gl('1 commit') : gl('{0} commits', n)
}

export function CommitsView({ repo }: ViewProps) {
  const locale = useLocale()
  const root = repo.root
  const { data: status } = useRepoStatus(root)
  const log = usePagedLog(['repo', root, 'log', 'HEAD'], (skip, limit) => git.log(root, { skip, limit }))
  const head = status?.head

  const nodes: TreeNode[] = []
  const upstream = status?.upstream
  const arg = { root }
  if (head?.branch && upstream) {
    const range = (revs: string[], hide: string[], id: string) =>
      asyncChildren({
        queryKey: ['repo', root, 'log', id, revs, hide],
        queryFn: () => git.log(root, { revs, hide, limit: 1000 }),
        build: (page) => page.commits.map((c) => commitNode(root, c, { idPrefix: id, locale, flags: id === 'outgoing' ? ['unpublished'] : [] })),
      })
    if (upstream.ahead === 0 && upstream.behind === 0) {
      nodes.push({ id: 'status', label: gl('Up to date with {0}', upstream.name), icon: <CheckIcon className="text-muted-foreground" />, contextValue: 'gitlens:status-branch:upstream+same', arg })
    }
    if (upstream.ahead > 0) {
      nodes.push({
        id: 'outgoing',
        label: gl('{0} ahead of {1}', pluralCommits(upstream.ahead), upstream.name),
        icon: <ArrowUpIcon className="text-muted-foreground" />,
        contextValue: 'gitlens:status-branch:upstream+ahead',
        arg,
        loadChildren: range(['HEAD'], [upstream.name], 'outgoing'),
      })
    }
    if (upstream.behind > 0) {
      nodes.push({
        id: 'incoming',
        label: gl('{0} behind {1}', pluralCommits(upstream.behind), upstream.name),
        icon: <ArrowDownIcon className="text-muted-foreground" />,
        contextValue: 'gitlens:status-branch:upstream+behind',
        arg,
        loadChildren: range([upstream.name], ['HEAD'], 'incoming'),
      })
    }
  } else if (head?.branch && status && status.remotes.length > 0) {
    nodes.push({
      id: 'status',
      label: gl("{0} hasn't been published to {1}", head.branch, status.remotes.includes('origin') ? 'origin' : status.remotes[0]),
      icon: <CloudUploadIcon className="text-muted-foreground" />,
      contextValue: 'gitlens:status-branch:upstream+none',
      arg,
    })
  }

  if (log.error) nodes.push(messageNode('error', errorMessage(log.error)))
  else if (!log.isPending && log.commits.length === 0) nodes.push(messageNode('empty', gl('No commits could be found.')))
  for (const commit of log.commits) nodes.push(commitNode(root, commit, { idPrefix: 'log', locale, flags: ['current'] }))
  if (log.more) nodes.push(loadMoreNode('log', log.loadMore, log.loadingMore))

  return <ViewTree viewId="gitmenu.views.commits" nodes={nodes} label={gl('Commits')} />
}
