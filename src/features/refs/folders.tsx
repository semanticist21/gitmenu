// GitLens's tree layout for branch names: `feature/login` shows as `login` inside a
// `feature` folder (`gitlens.views.*.branches.layout: tree`).
import { FolderIcon } from 'lucide-react'
import type { TreeNode } from '../views/ViewTree'

export function folderize<T>(items: T[], name: (item: T) => string, leaf: (item: T, label: string) => TreeNode, idPrefix: string): TreeNode[] {
  interface Folder {
    folders: Map<string, Folder>
    leaves: TreeNode[]
  }
  const top: Folder = { folders: new Map(), leaves: [] }
  for (const item of items) {
    const parts = name(item).split('/')
    let folder = top
    for (const part of parts.slice(0, -1)) {
      let next = folder.folders.get(part)
      if (!next) {
        next = { folders: new Map(), leaves: [] }
        folder.folders.set(part, next)
      }
      folder = next
    }
    folder.leaves.push(leaf(item, parts[parts.length - 1]))
  }
  const build = (folder: Folder, path: string): TreeNode[] => [
    ...[...folder.folders.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([part, sub]) => ({
        id: `${idPrefix}/folder:${path}${part}`,
        label: part,
        icon: <FolderIcon className="text-muted-foreground" />,
        children: build(sub, `${path}${part}/`),
      })),
    ...folder.leaves,
  ]
  return build(top, '')
}
