import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ipc, type ProjectInfo, useTauriEvent } from '@/lib/ipc'

export const projectsQuery = { queryKey: ['projects'], queryFn: ipc.projectsList, staleTime: Infinity }

export function useProjects() {
  const client = useQueryClient()
  const { data } = useQuery(projectsQuery)
  useTauriEvent<ProjectInfo[]>('projects://changed', () => {
    void client.invalidateQueries({ queryKey: projectsQuery.queryKey })
  })
  const [projects, activeId] = data ?? [[], null]
  const active = projects.find((p) => p.id === activeId) ?? null
  return { projects, active, loaded: data !== undefined }
}

export async function openProjectPicker(title: string) {
  const path = await ipc.pickFolder(title)
  if (path) await ipc.projectOpen(path)
}

/** The repository selected in a multi-repository project (VS Code's Repositories view). */
export function useSelectedRepo(project: ProjectInfo | null) {
  const client = useQueryClient()
  const key = project ? `selectedRepo:${project.id}` : ''
  const { data } = useQuery({
    queryKey: ['uiState', key],
    queryFn: () => ipc.uiStateGet<string>(key),
    enabled: Boolean(project),
    staleTime: Infinity,
  })
  const repo = project?.repos.find((r) => r.root === data) ?? project?.repos[0] ?? null
  const select = (root: string) => {
    client.setQueryData(['uiState', key], root)
    void ipc.uiStateSet(key, root)
  }
  return [repo, select] as const
}
