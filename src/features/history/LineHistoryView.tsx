// GitLens's Line History view: commits that changed the lines selected in the detail window
// (`git log -L`).
import { gl, useLocale } from '@/i18n'
import { git } from '@/lib/git'
import { errorMessage } from '@/lib/ipc'
import type { ViewProps } from '../views/registry'
import { useViewDescription } from '../views/description'
import { loadMore, type TreeNode, ViewTree } from '../views/ViewTree'
import { usePagedLog } from './api'
import { commitNode, messageNode } from './nodes'
import { useLineHistoryTarget } from './state'

export function LineHistoryView({ repo }: ViewProps) {
  const locale = useLocale()
  const root = repo.root
  const target = useLineHistoryTarget()
  const active = target && target.root === root ? target : null
  const log = usePagedLog(
    ['repo', root, 'lineHistory', active],
    (skip, limit) => git.lineHistory(active!, skip, limit),
    active !== null,
  )

  // GitLens's LineHistoryNode: `file:lines` (expanded, its folder as the description) holds the
  // commits, and the view description is that label
  const name = active ? (active.path.split('/').pop() ?? active.path) : ''
  const lines = active?.ranges.map(({ start, end }) => start === end ? `${start}` : `${start}-${end}`).join(', ') ?? ''
  useViewDescription('lineHistory', active ? `${name}:${lines}` : undefined)
  const nodes: TreeNode[] = []
  if (!active) nodes.push(messageNode('empty', gl('There are no editors open that can provide line history information.')))
  else {
    const children: TreeNode[] = []
    if (log.error) children.push(messageNode('error', errorMessage(log.error)))
    else if (!log.isPending && log.commits.length === 0) children.push(messageNode('none', gl('No line history could be found.')))
    for (const commit of log.commits) {
      children.push(commitNode(root, { ...commit, path: commit.path ?? active.path, status: 'modified' }, { idPrefix: 'lh', locale, file: true }))
    }
    if (log.more) children.push(loadMore('lh/more', log.loadingMore, log.loadMore))
    const folder = active.path.includes('/') ? active.path.slice(0, active.path.lastIndexOf('/')) : undefined
    nodes.push({
      id: 'file',
      label: `${name}:${lines}`,
      ariaLabel: `${active.path}:${lines}`,
      description: [folder, active.side.kind === 'commit' ? active.side.rev.slice(0, 7) : null].filter(Boolean).join(' ') || undefined,
      tooltip: `${active.path}:${lines}`,
      expanded: true,
      children,
    })
  }
  return <ViewTree viewId="gitmenu.views.lineHistory" nodes={nodes} label={gl('Line History')} />
}
