import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { CommandPalette } from '@/commands/CommandPalette'
import { installFocusTracking, setSettingsContext } from '@/commands/context'
import { appContribution } from '@/commands/contributes/app'
import { useCommandHotkeys, useKeybindingsSync } from '@/commands/keybindings'
import { contribute } from '@/commands/registry'
import { DialogHost } from '@/components/dialogs/dialogs'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ToastProvider } from '@/components/ui/toast'
import { setScmQueryClient } from '@/features/scm/state'
import { setLocale } from '@/i18n'
import { router } from '@/routes/router'
import { settingsQuery, useSettings, useSettingsSync } from '@/settings/settings'
import { useTheme } from '@/theme/theme'
import '@/features'
import './index.css'

if (import.meta.env.VITE_MOCK === '1') (await import('@/dev/mock')).installMocks()

contribute(appContribution)
installFocusTracking()

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
})
setScmQueryClient(queryClient)

function Shell() {
  useSettingsSync()
  useKeybindingsSync()
  useTheme()
  useCommandHotkeys()
  const settings = useSettings()
  const { isFetched } = useQuery(settingsQuery)
  const language = String(settings['gitmenu.language'] ?? 'auto')

  useEffect(() => setSettingsContext(settings), [settings])
  useEffect(() => {
    if (isFetched) void setLocale(language)
  }, [isFetched, language])

  return (
    <>
      <RouterProvider router={router} />
      <CommandPalette />
      <DialogHost />
    </>
  )
}

// Load the language before the first paint so the UI never flashes English
void queryClient
  .fetchQuery(settingsQuery)
  .then((values) => setLocale(String(values['gitmenu.language'] ?? 'auto')))
  .catch(() => setLocale('auto'))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <HotkeysProvider>
            <ToastProvider>
              <ErrorBoundary>
                <Shell />
              </ErrorBoundary>
            </ToastProvider>
          </HotkeysProvider>
        </QueryClientProvider>
      </StrictMode>,
    )
  })
