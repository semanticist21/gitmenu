// settings.json is owned by Rust; the frontend reads it through the query cache and
// stays in sync through `settings://changed` (edits from the app or from an editor).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import configuration from '@/commands/configuration.json'
import { ipc, useTauriEvent } from '@/lib/ipc'

type Schema = Record<string, { default: unknown }>

const defaults: Record<string, unknown> = Object.fromEntries(
  Object.entries(configuration as Schema).map(([key, schema]) => [key, schema.default]),
)

export const settingsQuery = { queryKey: ['settings'], queryFn: ipc.settingsGet, staleTime: Infinity }

export function useSettingsSync() {
  const client = useQueryClient()
  useTauriEvent<Record<string, unknown>>('settings://changed', (values) => {
    client.setQueryData(settingsQuery.queryKey, values)
  })
}

export function useSetting<T>(key: string): T {
  const { data } = useQuery(settingsQuery)
  const value = data && key in data ? data[key] : defaults[key]
  return value as T
}

export function useSettings(): Record<string, unknown> {
  const { data } = useQuery(settingsQuery)
  return { ...defaults, ...data }
}

export function settingDefault(key: string): unknown {
  return defaults[key]
}

export async function setSetting(key: string, value: unknown) {
  // null removes the key so the default applies again, as in VS Code
  await ipc.settingsSet(key, value === defaults[key] ? null : value)
}
