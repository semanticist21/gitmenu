// Persisted UI state (view layout, selections) stored by Rust in state.json.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { ipc } from './ipc'

export function useUiState<T>(key: string, fallback: T): [T, (value: T) => void, boolean] {
  const client = useQueryClient()
  const queryKey = ['uiState', key]
  const { data, isFetched } = useQuery({
    queryKey,
    queryFn: async () => (await ipc.uiStateGet<T>(key)) ?? null,
    staleTime: Infinity,
  })
  const set = useCallback(
    (value: T) => {
      client.setQueryData(['uiState', key], value)
      void ipc.uiStateSet(key, value)
    },
    [client, key],
  )
  return [(data ?? fallback) as T, set, isFetched]
}
