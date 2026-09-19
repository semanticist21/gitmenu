// The detail window: one window, tabs for diffs, Graph, Settings and Keyboard Shortcuts.
// Opening something already open switches to its tab. Tabs survive closing the window.
// The tab strip is VS Code's editor title (multieditortabscontrol.css): 35px tabs, the active
// one with a 1px top border, close buttons shown on the active or hovered tab, and the active
// tab's title actions at the right end.
import { emit } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { type ComponentType, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { setContext } from '@/commands/context'
import { registerHandler } from '@/commands/registry'
import { Icon } from '@/components/Icon'
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { GraphIcon } from '@/features/graph/glicons'
import { ACTIVE_FILE_EVENT } from '@/features/history/state'
import { useOpSync, useRepoChangeSync } from '@/features/scm/api'
import { t, useLocale, vsb } from '@/i18n'
import { ipc, useTauriEvent } from '@/lib/ipc'
import { useUiState } from '@/lib/uiState'
import { ScrollableTabs } from '@/components/ScrollableTabs'
import { cn } from '@/lib/utils'
import { ActionButton, EditorActionsSlot } from './EditorChrome'

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

/** The editor's label icon: file editors show `file`, the others their editor's codicon. */
function TabIcon({ kind }: { kind: string }) {
  if (kind === 'graph') return <GraphIcon className="me-1.5" />
  const name = { changes: 'diff-multiple', settings: 'settings', 'keyboard-shortcuts': 'keyboard' }[kind] ?? 'file'
  return <Icon name={name} className="me-1.5" />
}

/** VS Code's long tab title for the hover: the file's full path, else the label. */
function tabTitle(params: URLSearchParams, label: string) {
  const path = params.get('path')
  const repo = params.get('repo')
  if (!path || !repo) return label
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  return `${repo}${dir ? `/${dir}` : ''}/${label}`
}

/** Whether the window has focus (the active tab's top border dims when it doesn't). */
function useWindowFocused() {
  const [focused, setFocused] = useState(() => document.hasFocus())
  useEffect(() => {
    const on = () => setFocused(true)
    const off = () => setFocused(false)
    window.addEventListener('focus', on)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('focus', on)
      window.removeEventListener('blur', off)
    }
  }, [])
  return focused
}

export function DetailApp() {
  useLocale()
  useRepoChangeSync()
  useOpSync()
  const [tabs, setTabs, loaded] = useUiState<string[]>('detail.tabs', [])
  const [active, setActive] = useUiState<string | null>('detail.active', null)
  const [onTop, setOnTop] = useState(false)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const focused = useWindowFocused()
  const stripRef = useRef<HTMLDivElement>(null)

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
    // `open`/`close` read the latest tabs and active through these
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tabs])

  // The active tab scrolls into view in an overflowing strip
  useEffect(() => {
    const tab = stripRef.current?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, tabs])

  const current = active ? parse(active) : null
  const Current = current ? kinds.get(current.kind)?.component : undefined

  // The panel's File History follows the file of the active tab
  const activeRoot = current?.params.get('repo')
  const activePath = current && (current.kind === 'diff' || current.kind === 'file') ? current.params.get('path') : null
  useEffect(() => {
    if (activeRoot && activePath) void emit(ACTIVE_FILE_EVENT, { root: activeRoot, path: activePath })
  }, [activeRoot, activePath])

  // Left/Right move between tabs, Home/End jump to the ends (VS Code's tab keyboard navigation)
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>, route: string) => {
    const index = tabs.indexOf(route)
    const target = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: tabs.length - 1 }[event.key]
    if (target === undefined || !tabs[target]) return
    event.preventDefault()
    setActive(tabs[target])
    requestAnimationFrame(() => stripRef.current?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus())
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-(--vsc-editor-background) text-(--vsc-foreground)">
        {/* The title bar is overlaid: the strip leaves room for the traffic lights and drags the window */}
        <header
          data-tauri-drag-region
          className="relative flex h-[35px] shrink-0 bg-(--vsc-editorGroupHeader-tabsBackground) after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-[9] after:h-px after:bg-(--vsc-editorGroupHeader-tabsBorder)"
        >
          <div data-tauri-drag-region className="w-[78px] shrink-0" />
          <ScrollableTabs label={t('detail.tabs')} activeKey={active} scrollerRef={stripRef}>
            {tabs.map((route) => {
              const { kind, params } = parse(route)
              const label = kinds.get(kind)?.label(params) ?? kind
              const isActive = route === active
              return (
                <Tooltip key={route}>
                  <TooltipTrigger
                    render={
                      <div
                        role="tab"
                        aria-label={label}
                        aria-selected={isActive}
                        tabIndex={isActive ? 0 : -1}
                        className={cn(
                          'group/tab relative flex h-[35px] w-[120px] min-w-fit shrink-0 cursor-pointer items-center whitespace-nowrap border-(--vsc-tab-border) border-r ps-2.5 text-[13px] outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-(--vsc-focusBorder)',
                          isActive
                            ? 'bg-(--vsc-tab-activeBackground) text-(--vsc-tab-activeForeground)'
                            : 'bg-(--vsc-tab-inactiveBackground) text-(--vsc-tab-inactiveForeground) hover:bg-(--vsc-tab-hoverBackground)',
                        )}
                        onClick={() => setActive(route)}
                        onAuxClick={(e) => e.button === 1 && close(route)}
                        onKeyDown={(e) => onTabKeyDown(e, route)}
                      />
                    }
                  >
                    {isActive && (
                      <span
                        className={cn(
                          'pointer-events-none absolute inset-x-0 top-0 z-[6] h-px',
                          focused ? 'bg-(--vsc-tab-activeBorderTop)' : 'bg-(--vsc-tab-unfocusedActiveBorderTop)',
                        )}
                      />
                    )}
                    {isActive && <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-px bg-(--vsc-tab-activeBorder)" />}
                    <TabIcon kind={kind} />
                    <span className="leading-[35px]">{label}</span>
                    <span className="flex w-7 shrink-0 items-center justify-center">
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={vsb('Close Editor')}
                        className={cn(
                          'flex size-5 cursor-pointer items-center justify-center rounded-[6px] text-inherit hover:bg-(--vsc-toolbar-hoverBackground) focus-visible:opacity-100',
                          isActive ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100',
                        )}
                        onClick={(e) => {
                          e.stopPropagation()
                          close(route)
                        }}
                      >
                        <Icon name="close" />
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipPopup side="bottom">{tabTitle(params, label)}</TooltipPopup>
                </Tooltip>
              )
            })}
            <div data-tauri-drag-region className="min-w-4 flex-1" />
          </ScrollableTabs>
          {/* Editor title actions: padding 0 8px 0 4px, 4px between actions */}
          <div className="flex shrink-0 items-center gap-1 ps-1 pe-2">
            <div ref={setSlot} className="flex items-center gap-1 empty:hidden" />
            <ActionButton
              icon={onTop ? 'pinned' : 'pin'}
              label={onTop ? t('detail.unpin') : t('detail.pin')}
              pressed={onTop}
              onClick={() => {
                setOnTop(!onTop)
                void ipc.detailSetAlwaysOnTop(!onTop)
              }}
            />
          </div>
        </header>
        <main className="min-h-0 flex-1 bg-(--vsc-editor-background)">
          <EditorActionsSlot.Provider value={slot}>
            {current && Current && <Current key={active} route={active!} params={current.params} />}
          </EditorActionsSlot.Provider>
        </main>
      </div>
    </TooltipProvider>
  )
}
