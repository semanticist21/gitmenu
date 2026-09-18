import { useQuery, useQueryClient } from '@tanstack/react-query'
import { git, type RepoStatus } from '@/lib/git'
import { useTauriEvent } from '@/lib/ipc'

export function statusQuery(root: string) {
  return { queryKey: ['repo', root, 'status'], queryFn: () => git.status(root), staleTime: Infinity }
}

/** Status of one repository, re-read when its files change or a write finishes. */
export function useRepoStatus(root: string) {
  return useQuery(statusQuery(root))
}

/** Re-reads repositories the watcher reports as changed (active project only). */
export function useRepoChangeSync() {
  const client = useQueryClient()
  useTauriEvent<string>('repo://changed', (root) => {
    void client.invalidateQueries({ queryKey: ['repo', root] })
  })
}

export function allChanges(status: RepoStatus | undefined) {
  if (!status) return []
  return [...status.merge, ...status.index, ...status.workingTree, ...status.untracked]
}
