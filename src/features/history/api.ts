// Paged history queries. Pages grow with "Load more" and are re-read with the repository.
import { useInfiniteQuery } from '@tanstack/react-query'
import type { CommitInfo, LogPage } from '@/lib/git'
import { useSetting } from '@/settings/settings'

export function usePagedLog(queryKey: unknown[], fetchPage: (skip: number, limit: number) => Promise<LogPage>, enabled = true) {
  const limit = useSetting<number>('gitside.views.pageItemLimit')
  const query = useInfiniteQuery({
    queryKey: [...queryKey, limit],
    queryFn: ({ pageParam }) => fetchPage(pageParam, limit),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.more ? pages.reduce((n, p) => n + p.commits.length, 0) : undefined),
    staleTime: Infinity,
    enabled,
  })
  const commits: CommitInfo[] = query.data?.pages.flatMap((p) => p.commits) ?? []
  return {
    commits,
    more: query.hasNextPage,
    loadMore: () => void query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
    isPending: query.isPending && enabled,
    error: query.error,
  }
}
