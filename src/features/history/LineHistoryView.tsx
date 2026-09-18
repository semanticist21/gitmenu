// GitLens's Line History view: commits that changed the lines selected in the detail window
// (`git log -L`).
import { gl, useLocale } from '@/i18n'
import { git } from '@/lib/git'
import { errorMessage } from '@/lib/ipc'
import type { ViewProps } from '../views/registry'
import { type TreeNode, ViewTree } from '../views/ViewTree'
import { usePagedLog } from './api'
import { commitNode, loadMoreNode, messageNode } from './nodes'
import { useLineHistoryTarget } from './state'

export function LineHistoryView({ repo }: ViewProps) {
  const locale = useLocale()
  const root = repo.root
  const target = useLineHistoryTarget()
  const active = target && target.root === root ? target : null
  const log = usePagedLog(
    ['repo', root, 'lineHistory', active?.path, active?.start, active?.end, active?.rev],
    (skip, limit) => git.lineHistory(root, active!.path, active!.start, active!.end, active!.rev, skip, limit),
    active !== null,
  )

  const nodes: TreeNode[] = []
  if (!active) nodes.push(messageNode('empty', gl('There are no editors open that can provide line history information.')))
  else {
    const name = active.path.split('/').pop() ?? active.path
    const lines = active.start === active.end ? `${active.start}` : `${active.start}-${active.end}`
    nodes.push({ id: 'file', label: `${name}:${lines}`, description: active.rev ? active.rev.slice(0, 7) : undefined, tooltip: `${active.path}:${lines}` })
    if (log.error) nodes.push(messageNode('error', errorMessage(log.error)))
    else if (!log.isPending && log.commits.length === 0) nodes.push(messageNode('none', gl('No line history could be found.')))
    for (const commit of log.commits) {
      nodes.push(commitNode(root, { ...commit, path: active.path, status: 'modified' }, { idPrefix: 'lh', locale, file: true }))
    }
    if (log.more) nodes.push(loadMoreNode('lh', log.loadMore, log.loadingMore))
  }
  return <ViewTree viewId="gitside.views.lineHistory" nodes={nodes} label={gl('Line History')} />
}
