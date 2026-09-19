// The detail window: one window, tabs for diffs, Graph, Settings and Keyboard Shortcuts.
// Opening something already open switches to its tab. Tabs survive closing the window.
import { emit } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { PinIcon, PinOffIcon, XIcon } from 'lucide-react'
import { type ComponentType, useEffect, useState } from 'react'
import { setContext } from '@/commands/context'
import { registerHandler } from '@/commands/registry'
import { Button } from '@/components/ui/button'
import { ACTIVE_FILE_EVENT } from '@/features/history/state'
import { useOpSync, useRepoChangeSync } from '@/features/scm/api'
import { t, useLocale } from '@/i18n'
import { ipc, useTauriEvent } from '@/lib/ipc'
import { useUiState } from '@/lib/uiState'
import { cn } from '@/lib/utils'

export interface DetailTabProps {
  route: string
  params: URLSearchParams
}

interface TabKind {
  label: (params: URLSearchParams) => string
  component: ComponentType<DetailTabProps>
}

const kinds = new Map<string, TabKind>()

/** Registers a tab kind for routes `/detail/<kind>?…`. */
export function registerDetailTab(kind: string, tab: TabKind) {
  kinds.set(kind, tab)
}

function parse(route: string) {
  const [path, query = ''] = route.split('?')
  return { kind: path.replace(/^\/detail\/?/, ''), params: new URLSearchParams(query) }
}

function initialRoute() {
  return decodeURIComponent(window.location.hash.replace(/^#/, '')) || '/detail/settings'
}

export function DetailApp() {
  useLocale()
  useRepoChangeSync()
  useOpSync()
  const [tabs, setTabs, loaded] = useUiState<string[]>('detail.tabs', [])
  const [active, setActive] = useUiState<string | null>('detail.active', null)
  const [onTop, setOnTop] = useState(false)

  const open = (route: string) => {
    setTabs(tabs.includes(route) ? tabs : [...tabs, route])
    setActive(route)
  }

  useEffect(() => {
    if (!loaded) return
    open(initialRoute())
    // Only on first load: later routes arrive through detail://navigate
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  useTauriEvent<string>('detail://navigate', open)

  const close = (route: string) => {
    const next = tabs.filter((r) => r !== route)
    setTabs(next)
    if (active === route) setActive(next[next.length - 1] ?? null)
    if (next.length === 0) void getCurrentWindow().close()
  }

  useEffect(() => {
    setContext('gitmenu.window', 'detail')
    const disposers = [
      registerHandler('workbench.action.openSettings', () => open('/detail/settings')),
      registerHandler('workbench.action.openGlobalKeybindings', () => open('/detail/keyboard-shortcuts')),
      registerHandler('workbench.action.closeActiveEditor', () => active && close(active)),
    ]
    return () => disposers.forEach((d) => d())
  })

  const current = active ? parse(active) : null
  const Current = current ? kinds.get(current.kind)?.component : undefined

  // The panel's File History follows the file of the active tab
  const activeRoot = current?.params.get('repo')
  const activePath = current && (current.kind === 'diff' || current.kind === 'file') ? current.params.get('path') : null
  useEffect(() => {
    if (activeRoot && activePath) void emit(ACTIVE_FILE_EVENT, { root: activeRoot, path: activePath })
  }, [activeRoot, activePath])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Title bar is overlaid: leave room for the traffic lights and let the strip drag the window */}
      <header data-tauri-drag-region className="flex h-10 shrink-0 items-end gap-0.5 border-b ps-20 pe-2">
        <div role="tablist" className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto [scrollbar-width:none]">
          {tabs.map((route) => {
            const { kind, params } = parse(route)
            const label = kinds.get(kind)?.label(params) ?? kind
            return (
              <div
                key={route}
                className={cn(
                  'group flex h-8 max-w-56 shrink-0 items-center gap-1 rounded-t-md border border-b-0 ps-3 pe-1 text-[13px]',
                  route === active ? 'bg-background' : 'border-transparent text-muted-foreground hover:bg-accent/50',
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={route === active}
                  className="truncate outline-none"
                  onClick={() => setActive(route)}
                  onAuxClick={(e) => e.button === 1 && close(route)}
                  title={label}
                >
                  {label}
                </button>
                <button
                  type="button"
                  aria-label={t('prompt.cancel')}
                  className="rounded-sm p-0.5 opacity-60 hover:bg-accent hover:opacity-100"
                  onClick={() => close(route)}
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
            )
          })}
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          className="mb-1.5"
          aria-pressed={onTop}
          aria-label={onTop ? t('detail.unpin') : t('detail.pin')}
          title={onTop ? t('detail.unpin') : t('detail.pin')}
          onClick={() => {
            setOnTop(!onTop)
            void ipc.detailSetAlwaysOnTop(!onTop)
          }}
        >
          {onTop ? <PinOffIcon /> : <PinIcon />}
        </Button>
      </header>
      <main className="min-h-0 flex-1">{current && Current && <Current route={active!} params={current.params} />}</main>
    </div>
  )
}
