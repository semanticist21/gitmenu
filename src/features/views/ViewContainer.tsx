// Collapsible view sections with draggable sashes, like VS Code's sidebar panes (paneview.css,
// paneviewlet.css, sash.css). Layout (visible, collapsed, sizes) is persisted; right-click any
// header to show or hide views.
import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'
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
import { useViewDescriptions } from './description'
import { DEFAULT_LAYOUT, VIEWS, type ViewLayout } from './views'

const MIN_EXPANDED = 64
/** `--pane-header-size` */
const HEADER = 22
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
  const sectionRefs = useRef(new Map<string, HTMLElement>())
  const [resizing, setResizing] = useState<string | null>(null)
  // Pane heights animate only right after an expand or collapse, never while dragging a sash
  const [animating, setAnimating] = useState(false)
  const animationTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(animationTimer.current), [])
  const visible = VIEWS.filter((v) => layout.visible.includes(v.id))

  const setCollapsed = (id: string, collapsed: boolean) => {
    const set = new Set(layout.collapsed)
    if (collapsed) set.add(id)
    else set.delete(id)
    setAnimating(true)
    window.clearTimeout(animationTimer.current)
    animationTimer.current = window.setTimeout(() => setAnimating(false), ANIMATION_MS)
    setLayout({ ...layout, collapsed: [...set] })
  }

  const startResize = (above: string, below: string, event: ReactPointerEvent) => {
    const top = sectionRefs.current.get(above)
    const bottom = sectionRefs.current.get(below)
    if (!top || !bottom) return
    event.preventDefault()
    setAnimating(false)
    setResizing(below)
    const startY = event.clientY
    const topStart = top.getBoundingClientRect().height
    const bottomStart = bottom.getBoundingClientRect().height
    const total = topStart + bottomStart
    let weights = layout.weights
    const move = (e: PointerEvent) => {
      const topHeight = Math.min(Math.max(topStart + e.clientY - startY, MIN_EXPANDED), total - MIN_EXPANDED)
      weights = { ...weights, [above]: topHeight, [below]: total - topHeight }
      top.style.flexGrow = String(topHeight)
      bottom.style.flexGrow = String(total - topHeight)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setResizing(null)
      setLayout({ ...layout, weights })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {visible.map((view, index) => {
        const collapsed = layout.collapsed.includes(view.id)
        const previous = visible[index - 1]
        const resizable = previous && !collapsed && !layout.collapsed.includes(previous.id)
        const label = t(view.title)
        const description = descriptions[view.id]
        // Border-box: a collapsed pane is its header plus the top border it has after the first
        const collapsedBasis = HEADER + (index > 0 ? 1 : 0)
        const toggle = () => setCollapsed(view.id, !collapsed)
        return (
          <section
            key={view.id}
            ref={(el) => {
              if (el) sectionRefs.current.set(view.id, el)
              else sectionRefs.current.delete(view.id)
            }}
            aria-label={label}
            className={cn(
              'group/pane relative flex min-h-0 flex-col overflow-hidden',
              index > 0 && 'border-(--vsc-sideBarSectionHeader-border) border-t',
              animating && 'transition-[flex-grow,flex-basis] duration-150 ease-out motion-reduce:transition-none',
            )}
            style={
              collapsed
                ? { flex: `0 0 ${collapsedBasis}px` }
                : { flex: `${layout.weights[view.id] ?? 1} 1 0px`, minHeight: animating ? undefined : MIN_EXPANDED }
            }
            data-context={JSON.stringify({ view: `gitmenu.views.${view.id}`, focusedView: `gitmenu.views.${view.id}` })}
          >
            {resizable && (
              <div
                role="separator"
                aria-orientation="horizontal"
                data-active={resizing === view.id || undefined}
                className="absolute inset-x-0 -top-0.5 z-10 h-1 cursor-ns-resize transition-[background-color] duration-100 ease-out hover:bg-(--vsc-sash-hoverBorder) hover:delay-300 data-active:bg-(--vsc-sash-hoverBorder) motion-reduce:transition-none"
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
                    className="group/header flex h-[22px] shrink-0 cursor-pointer items-center overflow-hidden bg-(--vsc-sideBarSectionHeader-background) font-bold text-(--vsc-sideBarSectionHeader-foreground) text-[11px] leading-[22px] outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-(--vsc-focusBorder) [&:lang(ja)]:font-normal [&:lang(ko)]:font-normal [&:lang(zh)]:font-normal"
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
                  <span className="ms-2.5 min-w-0 shrink-[100000] truncate font-normal text-(--vsc-panelTitle-inactiveForeground)">{description}</span>
                )}
                {!collapsed && actions && (
                  // Shown while the pane is hovered or holds focus (VS Code toggles `display`)
                  <div
                    className="ms-auto me-2 hidden shrink-0 items-center gap-1 pe-1 group-focus-within/pane:flex group-hover/pane:flex"
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
            {!collapsed && <div className="min-h-0 flex-1 overflow-hidden">{render(view.id)}</div>}
          </section>
        )
      })}
    </div>
  )
}
