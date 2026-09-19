// GitLens's File History view: commits that changed one file, following renames. It follows
// the file shown in the detail window unless pinned; "Open File History" picks a file.
import { useEffect } from 'react'
import { setContext } from '@/commands/context'
import { registerHandler } from '@/commands/registry'
import { gl, useLocale } from '@/i18n'
import { git } from '@/lib/git'
import { toastManager } from '@/components/ui/toast'
import { errorMessage, ipc } from '@/lib/ipc'
import type { ViewProps } from '../views/registry'
import { loadMore, type TreeNode, ViewTree } from '../views/ViewTree'
import { usePagedLog } from './api'
import { commitNode, messageNode } from './nodes'
import { useFileHistoryTarget } from './state'

export async function pickRepoFile(root: string): Promise<string | null> {
  const picked = await ipc.pickFile(root, gl('Open File History'))
  if (!picked) return null
  if (!picked.startsWith(`${root}/`)) {
    toastManager.add({ type: 'info', title: gl('The file must be inside the repository') })
    return null
  }
  return picked.slice(root.length + 1)
}

export function FileHistoryView({ repo }: ViewProps) {
  const locale = useLocale()
  const root = repo.root
  const { target, setTarget, pinned, setPinned } = useFileHistoryTarget()
  const path = target && target.root === root ? target.path : null
  const log = usePagedLog(['repo', root, 'fileHistory', path], (skip, limit) => git.log(root, { path, skip, limit }), path !== null)

  useEffect(() => setContext('gitmenu:views:fileHistory:pinned', pinned), [pinned])
  useEffect(() => {
    const disposers = [
      registerHandler('gitlens.views.fileHistory.pick', async () => {
        const picked = await pickRepoFile(root)
        if (picked) {
          setTarget({ root, path: picked })
          setPinned(true)
        }
      }),
      registerHandler('gitlens.views.fileHistory.setEditorFollowingOff', () => setPinned(true)),
      registerHandler('gitlens.views.fileHistory.setEditorFollowingOn', () => setPinned(false)),
    ]
    return () => disposers.forEach((d) => d())
  }, [root, setTarget, setPinned])

  const nodes: TreeNode[] = []
  if (!path) nodes.push(messageNode('empty', gl('There are no editors open that can provide file history information.')))
  else {
    nodes.push({ id: 'file', label: path.split('/').pop() ?? path, description: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : undefined, tooltip: path, message: false })
    if (log.error) nodes.push(messageNode('error', errorMessage(log.error)))
    else if (!log.isPending && log.commits.length === 0) nodes.push(messageNode('none', gl('No file history could be found.')))
    for (const commit of log.commits) nodes.push(commitNode(root, commit, { idPrefix: 'fh', locale, file: true }))
    if (log.more) nodes.push(loadMore('fh/more', log.loadingMore, log.loadMore))
  }
  return <ViewTree viewId="gitmenu.views.fileHistory" nodes={nodes} label={gl('File History')} />
}
