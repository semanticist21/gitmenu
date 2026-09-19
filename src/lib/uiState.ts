// Persisted UI state (view layout, selections) stored by Rust in state.json.
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { ipc } from './ipc'

/** Reads a UI state value outside React (commands). */
export async function readUiState<T>(client: QueryClient, key: string): Promise<T | null> {
  const cached = client.getQueryData<T | null>(['uiState', key])
  if (cached !== undefined) return cached
  const value = (await ipc.uiStateGet<T>(key)) ?? null
  client.setQueryData(['uiState', key], value)
  return value
}

/** Writes a UI state value outside React; components using it update. */
export function writeUiState<T>(client: QueryClient, key: string, value: T) {
  client.setQueryData(['uiState', key], value)
  void ipc.uiStateSet(key, value)
}

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
