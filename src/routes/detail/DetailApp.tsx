// The detail window: one window, tabs for diffs, Graph, Settings, Keyboard Shortcuts and
// terminals. Opening something already open switches to its tab. Tabs survive closing the window.
// The tab strip is VS Code's editor title (multieditortabscontrol.css): 35px tabs, the active
// one with a 1px top border, close buttons shown on the active or hovered tab, and at the right
// end New Terminal, the active tab's title actions and Keep on Top.
import { emit } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { type ComponentType, type KeyboardEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { setContext } from '@/commands/context'
import { executeCommand, registerHandler } from '@/commands/registry'
import { Icon } from '@/components/Icon'
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { LogoMarkIcon } from '@/components/LogoIcons'
import { ACTIVE_FILE_EVENT } from '@/features/history/state'
import { useOpSync, useRepoChangeSync } from '@/features/scm/api'
import { newTerminalRoute } from '@/features/terminal/contribution'
import { t, useLocale, vsb } from '@/i18n'
import { ipc, useTauriEvent } from '@/lib/ipc'
import { useUiState } from '@/lib/uiState'
import { ScrollableTabs } from '@/components/ScrollableTabs'
import { cn } from '@/lib/utils'
import { ActionButton, EditorActionsSlot } from './EditorChrome'
import { useNoInitialFocusRing } from '@/lib/initialFocus'

export interface DetailTabProps {
  route: string
  params: URLSearchParams
}

interface TabKind {
  label: (params: URLSearchParams) => string
  /** The hover; defaults to the file's path, else the label */
  title?: (params: URLSearchParams) => string
  component: ComponentType<DetailTabProps>
  /** Runs when the tab closes, however it closes (a terminal ends its shell) */
  onClose?: (params: URLSearchParams) => void
  /**
   * VS Code's editor close handler: asked once for this kind's tabs before the user closes them
   * or the window; false keeps them all (a terminal running something asks first)
   */
  confirmClose?: (tabs: URLSearchParams[]) => Promise<boolean>
  /** Gives the editor the keyboard when its tab is clicked while active */
  focus?: (params: URLSearchParams) => void
  /** For labels and hovers that change while the tab is open; returns the unsubscribe */
  subscribe?: (onChange: () => void) => () => void
}

const kinds = new Map<string, TabKind>()

/** Registers a tab kind for routes `/detail/<kind>?…`. */
export function registerDetailTab(kind: string, tab: TabKind) {
  kinds.set(kind, tab)
}

type CloseRequest = (kind: string, match: (params: URLSearchParams) => boolean, keepWindow?: Promise<unknown>) => void
const closeRequests = new Set<CloseRequest>()

/**
 * Closes the open tabs of `kind` that `match` picks without asking (a terminal whose shell
 * exited). A window left without tabs closes, or once `keepWindow` settles when it still shows
 * something (the terminal's exit alert).
 */
export function closeDetailTabs(kind: string, match: (params: URLSearchParams) => boolean, keepWindow?: Promise<unknown>) {
  closeRequests.forEach((request) => request(kind, match, keepWindow))
}

/** Whether the editors of `routes` let them close: each kind with a close handler asks once for its tabs. */
async function confirmClose(routes: string[]): Promise<boolean> {
  const byKind = new Map<string, URLSearchParams[]>()
  for (const route of routes) {
    const { kind, params } = parse(route)
    byKind.set(kind, [...(byKind.get(kind) ?? []), params])
  }
  for (const [kind, tabs] of byKind) {
    const confirm = kinds.get(kind)?.confirmClose
    if (confirm && !(await confirm(tabs))) return false
  }
  return true
}

// Tabs whose close is waiting for an answer: closing one again doesn't ask twice
const confirming = new Set<string>()

// The strip re-renders when a kind's label source changes (a terminal learning its shell)
let labelsVersion = 0
function subscribeLabels(onChange: () => void) {
  const unsubscribe = [...kinds.values()].flatMap((kind) =>
    kind.subscribe
      ? [
          kind.subscribe(() => {
            labelsVersion++
            onChange()
          }),
        ]
      : [],
  )
  return () => unsubscribe.forEach((fn) => fn())
}
const labelsSnapshot = () => labelsVersion

function parse(route: string) {
  const [path, query = ''] = route.split('?')
  return { kind: path.replace(/^\/detail\/?/, ''), params: new URLSearchParams(query) }
}

// The hash is the route as `detail_open` got it, query already encoded: decoding it would
// turn an encoded `&` inside a value into a separator
function initialRoute() {
  return window.location.hash.replace(/^#/, '') || '/detail/settings'
}

/** The editor's label icon: file editors show `file`, the others their editor's codicon. */
function TabIcon({ kind }: { kind: string }) {
  if (kind === 'graph') return <LogoMarkIcon className="me-1.5" />
  const name = { changes: 'diff-multiple', settings: 'settings', 'keyboard-shortcuts': 'keyboard', output: 'output', about: 'info', terminal: 'terminal' }[kind] ?? 'file'
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
  useNoInitialFocusRing()
  useRepoChangeSync()
  useOpSync()
  const [tabs, setTabs, loaded] = useUiState<string[]>('detail.tabs', [])
  const [active, setActive] = useUiState<string | null>('detail.active', null)
  const [onTop, setOnTop] = useState(false)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const focused = useWindowFocused()
  const stripRef = useRef<HTMLDivElement>(null)
  const reopenable = useRef<string[]>([])
  useSyncExternalStore(subscribeLabels, labelsSnapshot)

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

  const close = (routes: string[], keepWindow?: Promise<unknown>) => {
    routes = routes.filter((route) => tabs.includes(route))
    if (routes.length === 0) return
    for (const route of routes) {
      const { kind, params } = parse(route)
      kinds.get(kind)?.onClose?.(params)
    }
    // VS Code's reopen history, newest last and bounded
    reopenable.current = [...reopenable.current.filter((r) => !routes.includes(r)), ...routes].slice(-20)
    const next = tabs.filter((r) => !routes.includes(r))
    setTabs(next)
    if (active && routes.includes(active)) setActive(next[next.length - 1] ?? null)
    if (next.length > 0) return
    if (!keepWindow) void getCurrentWindow().close()
    else void keepWindow.then(() => latest.current.tabs.length === 0 && void getCurrentWindow().close())
  }
  // The tabs and close of the latest render, for closes that finish after an answer or an alert
  const latest = useRef({ tabs, close })
  useEffect(() => {
    latest.current = { tabs, close }
  })

  /** Closes tabs at the user's request (⌘W, the close button), once their editors agree. */
  const requestClose = (routes: string[]) => {
    routes = routes.filter((route) => !confirming.has(route))
    routes.forEach((route) => confirming.add(route))
    void confirmClose(routes)
      .then((confirmed) => confirmed && latest.current.close(routes))
      .finally(() => routes.forEach((route) => confirming.delete(route)))
  }

  // Closing the window closes every tab, so the editors' close handlers get their say
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      if (!(await confirmClose(latest.current.tabs))) event.preventDefault()
    })
    return () => void unlisten.then((fn) => fn())
  }, [])

  /** Activates the tab at `index`; out of range does nothing, the way an absent tab should. */
  const at = (index: number) => {
    const route = tabs[index]
    if (route) setActive(route)
  }

  /** Next/previous tab, wrapping at the ends like Chrome and VS Code. */
  const step = (delta: number) => {
    if (tabs.length < 2) return
    const i = active ? tabs.indexOf(active) : -1
    at((i + delta + tabs.length) % tabs.length)
  }

  useEffect(() => {
    setContext('gitmenu.window', 'detail')
    const disposers = [
      registerHandler('workbench.action.openSettings', () => open('/detail/settings')),
      registerHandler('workbench.action.openGlobalKeybindings', () => open('/detail/keyboard-shortcuts')),
      registerHandler('workbench.action.closeActiveEditor', () => active && requestClose([active])),
      registerHandler('workbench.action.closeAllEditors', () => tabs.length > 0 && requestClose([...tabs])),
      registerHandler('workbench.action.nextEditor', () => step(1)),
      registerHandler('workbench.action.previousEditor', () => step(-1)),
      registerHandler('workbench.action.lastEditorInGroup', () => at(tabs.length - 1)),
      registerHandler('workbench.action.reopenClosedEditor', () => {
        const route = reopenable.current.pop()
        if (route) open(route)
      }),
      // Chrome and VS Code both put the first editors on the number keys
      ...Array.from({ length: 8 }, (_, i) => registerHandler(`workbench.action.openEditorAtIndex${i + 1}`, () => at(i))),
      // New Terminal starts in the active tab's repository (the panel's handler lets Rust pick)
      registerHandler('workbench.action.terminal.new', () => open(newTerminalRoute(active ? parse(active).params.get('repo') : null))),
    ]
    const request: CloseRequest = (kind, match, keepWindow) => {
      const routes = tabs.filter((route) => {
        const tab = parse(route)
        return tab.kind === kind && match(tab.params)
      })
      close(routes, keepWindow)
    }
    closeRequests.add(request)
    return () => {
      disposers.forEach((d) => d())
      closeRequests.delete(request)
    }
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
      <div className="flex h-screen flex-col overflow-hidden bg-editor text-foreground">
        {/* The title bar is overlaid: the strip leaves room for the traffic lights and drags the window */}
        <header
          data-tauri-drag-region
          className="relative flex h-tab shrink-0 bg-tab-strip after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-[9] after:h-px after:bg-tab-strip-border"
        >
          <div data-tauri-drag-region className="w-[78px] shrink-0" />
          <ScrollableTabs label={t('detail.tabs')} activeKey={active} scrollerRef={stripRef}>
            {tabs.map((route) => {
              const { kind, params } = parse(route)
              const tabKind = kinds.get(kind)
              const label = tabKind?.label(params) ?? kind
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
                          'group/tab relative flex h-tab w-fit shrink-0 cursor-pointer items-center whitespace-nowrap border-tab-border border-r ps-2.5 text-ui outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                          isActive
                            ? 'bg-tab-active text-tab-active-foreground'
                            : 'bg-tab-inactive text-tab-inactive-foreground hover:bg-tab-hover',
                        )}
                        onClick={() => (isActive ? tabKind?.focus?.(params) : setActive(route))}
                        onAuxClick={(e) => e.button === 1 && requestClose([route])}
                        onKeyDown={(e) => onTabKeyDown(e, route)}
                      />
                    }
                  >
                    {isActive && (
                      <span
                        className={cn(
                          'pointer-events-none absolute inset-x-0 top-0 z-[6] h-px',
                          focused ? 'bg-tab-active-border-top' : 'bg-tab-unfocused-active-border-top',
                        )}
                      />
                    )}
                    {isActive && <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-px bg-tab-active-border" />}
                    <TabIcon kind={kind} />
                    <span className="flex-1 leading-tab">{label}</span>
                    <span className="flex w-7 shrink-0 items-center justify-center">
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={vsb('Close Editor')}
                        className={cn(
                          'flex size-action-sm cursor-pointer items-center justify-center rounded-action text-inherit hover:bg-toolbar-hover focus-visible:opacity-100',
                          isActive ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100',
                        )}
                        onClick={(e) => {
                          e.stopPropagation()
                          requestClose([route])
                        }}
                      >
                        <Icon name="close" />
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipPopup side="bottom">{tabKind?.title?.(params) ?? tabTitle(params, label)}</TooltipPopup>
                </Tooltip>
              )
            })}
            <div data-tauri-drag-region className="min-w-4 flex-1" />
          </ScrollableTabs>
          {/* Editor title actions: padding 0 8px 0 4px, 4px between actions */}
          <div className="flex shrink-0 items-center gap-1 ps-1 pe-2">
            <ActionButton
              icon="add"
              label={t('terminal.new')}
              command="workbench.action.terminal.new"
              onClick={() => void executeCommand('workbench.action.terminal.new')}
            />
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
        <main className="min-h-0 flex-1 bg-editor">
          <EditorActionsSlot.Provider value={slot}>
            {current && Current && <Current key={active} route={active!} params={current.params} />}
          </EditorActionsSlot.Provider>
        </main>
      </div>
    </TooltipProvider>
  )
}
