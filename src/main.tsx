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
import { ToastProvider } from '@/components/ui/toast'
import { setLocale } from '@/i18n'
import { router } from '@/routes/router'
import { settingsQuery, useSettings, useSettingsSync } from '@/settings/settings'
import { useTheme } from '@/theme/theme'
import '@/features'
import './index.css'

contribute(appContribution)
installFocusTracking()

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
})

function Shell() {
  useSettingsSync()
  useKeybindingsSync()
  useTheme()
  useCommandHotkeys()
  const settings = useSettings()
  const { isFetched } = useQuery(settingsQuery)
  const language = String(settings['gitside.language'] ?? 'auto')

  useEffect(() => setSettingsContext(settings), [settings])
  useEffect(() => {
    if (isFetched) void setLocale(language)
  }, [isFetched, language])

  return (
    <>
      <RouterProvider router={router} />
      <CommandPalette />
    </>
  )
}

// Load the language before the first paint so the UI never flashes English
void queryClient
  .fetchQuery(settingsQuery)
  .then((values) => setLocale(String(values['gitside.language'] ?? 'auto')))
  .catch(() => setLocale('auto'))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <HotkeysProvider>
            <ToastProvider>
              <Shell />
            </ToastProvider>
          </HotkeysProvider>
        </QueryClientProvider>
      </StrictMode>,
    )
  })
