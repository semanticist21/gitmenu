// Collapsible view sections with draggable sashes, like VS Code's sidebar panes (paneview.css,
// paneviewlet.css, sash.css). Layout (visible, collapsed, sizes) is persisted; right-click any
// header to show or hide views.
import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { ProgressBar } from '@/components/ui/progress'
import { t, useLocale } from '@/i18n'
import { useUiState } from '@/lib/uiState'
import { cn } from '@/lib/utils'
import { PANE_HEADER_HEIGHT } from '@/theme/metrics'
import { useViewDescriptions } from './description'
import { MIN_EXPANDED, paneHeights } from './paneHeights'
import { DEFAULT_LAYOUT, VIEWS, type ViewLayout } from './views'

/** paneview.ts keeps `.animated` on the pane view this long after an expand or collapse */
const ANIMATION_MS = 200

export function useViewLayout() {
  return useUiState<ViewLayout>('views.layout', DEFAULT_LAYOUT)
}

export function toggleView(layout: ViewLayout, id: string, visible: boolean): ViewLayout {
  const next = visible ? [...new Set([...layout.visible, id])] : layout.visible.filter((v) => v !== id)
  // Keep VS Code's order regardless of toggle order
  return { ...layout, visible: VIEWS.map((v) => v.id).filter((v) => next.includes(v)) }
}

interface Props {
  render: (viewId: string) => ReactNode
  actions?: (viewId: string) => ReactNode
  /** Views with work running: a 2px progress bar on the header's bottom edge */
  progress?: (viewId: string) => boolean
}

export function ViewContainer({ render, actions, progress }: Props) {
  useLocale()
  const [layout, setLayout] = useViewLayout()
  const descriptions = useViewDescriptions()
  const containerRef = useRef<HTMLDivElement>(null)
  const [total, setTotal] = useState(0)
  const [resizing, setResizing] = useState<string | null>(null)
  // Weights while a sash is being dragged (saved on release)
  const [dragWeights, setDragWeights] = useState<Record<string, number> | null>(null)
  // paneview.ts: heights animate only right after an expand or collapse, never while dragging
  const [animating, setAnimating] = useState(false)
  // A collapsing pane keeps its body, at the height it had, until the animation ends
  // (paneview.ts removes it after 200ms)
  const [closing, setClosing] = useState<ReadonlyMap<string, number>>(new Map())
  const timers = useRef(new Map<string, number>())
  // Panes opened at least once keep their content mounted, hidden while collapsed: VS Code
  // renders a pane body once and only re-attaches it, so expanding doesn't rebuild the view
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const visible = VIEWS.filter((v) => layout.visible.includes(v.id))
  const collapsedSet = new Set(layout.collapsed)
  const heights = paneHeights(
    visible.map((v) => v.id),
    collapsedSet,
    dragWeights ?? layout.weights,
    total,
  )

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setTotal(el.clientHeight))
    observer.observe(el)
    setTotal(el.clientHeight)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((t) => window.clearTimeout(t))
  }, [])

  const setCollapsed = (id: string, collapsed: boolean) => {
    const set = new Set(layout.collapsed)
    if (collapsed) set.add(id)
    else set.delete(id)
    setAnimating(true)
    window.clearTimeout(timers.current.get('animation'))
    timers.current.set('animation', window.setTimeout(() => setAnimating(false), ANIMATION_MS))
    window.clearTimeout(timers.current.get(id))
    if (collapsed) {
      // It was open, so its content exists: keep it for the next expand
      setOpened((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
      const index = visible.findIndex((v) => v.id === id)
      const body = (heights.get(id) ?? 0) - PANE_HEADER_HEIGHT - (index > 0 ? 1 : 0)
      setClosing((prev) => new Map(prev).set(id, body))
      timers.current.set(
        id,
        window.setTimeout(() => {
          setClosing((prev) => {
            const next = new Map(prev)
            next.delete(id)
            return next
          })
        }, ANIMATION_MS),
      )
    } else {
      setClosing((prev) => {
        if (!prev.has(id)) return prev
        const next = new Map(prev)
        next.delete(id)
        return next
      })
    }
    setLayout({ ...layout, collapsed: [...set] })
  }

  const startResize = (above: string, below: string, event: ReactPointerEvent) => {
    event.preventDefault()
    setAnimating(false)
    setResizing(below)
    const startY = event.clientY
    const minBody = MIN_EXPANDED - PANE_HEADER_HEIGHT
    // Freeze every expanded pane at its current body height; only the two around the sash move
    const frozen: Record<string, number> = {}
    visible.forEach((view, index) => {
      if (!collapsedSet.has(view.id)) frozen[view.id] = (heights.get(view.id) ?? 0) - PANE_HEADER_HEIGHT - (index > 0 ? 1 : 0)
    })
    const topStart = frozen[above] ?? minBody
    const pair = topStart + (frozen[below] ?? minBody)
    let weights = frozen
    const move = (e: PointerEvent) => {
      const top = Math.min(Math.max(topStart + e.clientY - startY, minBody), pair - minBody)
      weights = { ...frozen, [above]: top, [below]: pair - top }
      setDragWeights(weights)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setResizing(null)
      setDragWeights(null)
      setLayout({ ...layout, weights: { ...layout.weights, ...weights } })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col overflow-hidden">
      {visible.map((view, index) => {
        const collapsed = collapsedSet.has(view.id)
        const previous = visible[index - 1]
        const resizable = previous && !collapsed && !collapsedSet.has(previous.id)
        const label = t(view.title)
        const description = descriptions[view.id]
        const headerSize = PANE_HEADER_HEIGHT + (index > 0 ? 1 : 0)
        const height = heights.get(view.id) ?? headerSize
        // Laid out once at its final size and clipped while the pane animates (paneview.ts)
        const bodyHeight = collapsed ? (closing.get(view.id) ?? 0) : height - headerSize
        const closingNow = closing.has(view.id)
        const mounted = !collapsed || closingNow || opened.has(view.id)
        const toggle = () => setCollapsed(view.id, !collapsed)
        return (
          <section
            key={view.id}
            aria-label={label}
            className={cn(
              'group/pane relative flex shrink-0 flex-col overflow-hidden',
              index > 0 && 'border-section-header-border border-t',
              animating && 'transition-[height] duration-pane ease-pane motion-reduce:transition-none',
            )}
            style={{ height }}
            data-context={JSON.stringify({ view: `gitmenu.views.${view.id}`, focusedView: `gitmenu.views.${view.id}` })}
          >
            {resizable && (
              <div
                role="separator"
                aria-orientation="horizontal"
                data-active={resizing === view.id || undefined}
                className="absolute inset-x-0 -top-0.5 z-10 h-1 cursor-ns-resize transition-[background-color] duration-sash ease-sash hover:bg-sash-hover hover:delay-sash data-active:bg-sash-hover motion-reduce:transition-none"
                onPointerDown={(e) => startResize(previous.id, view.id, e)}
              />
            )}
            <ContextMenu>
              <ContextMenuTrigger
                render={
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={!collapsed}
                    aria-label={label}
                    className="group/header flex h-pane-header shrink-0 cursor-pointer items-center overflow-hidden bg-section-header font-bold text-section-header-foreground text-caption leading-pane-header outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus [&:lang(ja)]:font-normal [&:lang(ko)]:font-normal [&:lang(zh)]:font-normal"
                    onClick={toggle}
                    onKeyDown={(e: KeyboardEvent) => {
                      if (e.target !== e.currentTarget) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggle()
                      } else if ((e.key === 'ArrowLeft' && !collapsed) || (e.key === 'ArrowRight' && collapsed)) {
                        e.preventDefault()
                        toggle()
                      }
                    }}
                  />
                }
              >
                <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} className={cn('mx-0.5', !collapsed && 'translate-y-px')} />
                <h3 className="min-w-[3ch] truncate uppercase">{label}</h3>
                {description && !collapsed && (
                  <span className="ms-2.5 min-w-0 shrink-[100000] truncate font-normal text-section-header-description">{description}</span>
                )}
                {!collapsed && actions && (
                  // Shown while the pane is hovered or holds focus, or one of its menus is open (VS Code toggles `display`)
                  <div
                    className="ms-auto me-2 hidden shrink-0 items-center gap-1 pe-1 group-focus-within/pane:flex group-hover/pane:flex has-data-popup-open:flex"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {actions(view.id)}
                  </div>
                )}
              </ContextMenuTrigger>
              <ContextMenuPopup>
                {VIEWS.map((v) => (
                  <ContextMenuCheckboxItem
                    key={v.id}
                    checked={layout.visible.includes(v.id)}
                    onCheckedChange={(checked) => setLayout(toggleView(layout, v.id, checked))}
                  >
                    {t(v.title)}
                  </ContextMenuCheckboxItem>
                ))}
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => setLayout(toggleView(layout, view.id, false))}>{t('view.hide', label)}</ContextMenuItem>
              </ContextMenuPopup>
            </ContextMenu>
            {progress?.(view.id) && <ProgressBar aria-label={label} className="absolute inset-x-0 top-5 z-[5]" />}
            {mounted && (
              <div
                className="shrink-0 overflow-hidden [contain:strict]"
                style={{ height: bodyHeight }}
                hidden={collapsed && !closingNow}
                inert={collapsed || undefined}
              >
                {render(view.id)}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
