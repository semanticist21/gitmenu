// Collapsible view sections with draggable sashes, like VS Code's sidebar.
// Layout (visible, collapsed, sizes) is persisted; right-click any header to show or hide views.
import { ChevronRightIcon } from 'lucide-react'
import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef } from 'react'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { t, useLocale } from '@/i18n'
import { useUiState } from '@/lib/uiState'
import { cn } from '@/lib/utils'
import { DEFAULT_LAYOUT, VIEWS, type ViewLayout } from './views'

const MIN_EXPANDED = 64

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
}

export function ViewContainer({ render, actions }: Props) {
  useLocale()
  const [layout, setLayout] = useViewLayout()
  const sectionRefs = useRef(new Map<string, HTMLElement>())
  const visible = VIEWS.filter((v) => layout.visible.includes(v.id))

  const setCollapsed = (id: string, collapsed: boolean) => {
    const set = new Set(layout.collapsed)
    if (collapsed) set.add(id)
    else set.delete(id)
    setLayout({ ...layout, collapsed: [...set] })
  }

  const startResize = (above: string, below: string, event: ReactPointerEvent) => {
    const top = sectionRefs.current.get(above)
    const bottom = sectionRefs.current.get(below)
    if (!top || !bottom) return
    event.preventDefault()
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
        return (
          <section
            key={view.id}
            ref={(el) => {
              if (el) sectionRefs.current.set(view.id, el)
              else sectionRefs.current.delete(view.id)
            }}
            aria-label={label}
            className={cn('relative flex min-h-0 flex-col', index > 0 && 'border-t')}
            style={collapsed ? { flex: '0 0 auto' } : { flex: `${layout.weights[view.id] ?? 1} 1 0px`, minHeight: MIN_EXPANDED }}
            data-context={JSON.stringify({ view: `gitmenu.views.${view.id}`, focusedView: `gitmenu.views.${view.id}` })}
          >
            {resizable && (
              <div
                role="separator"
                aria-orientation="horizontal"
                className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize"
                onPointerDown={(e) => startResize(previous.id, view.id, e)}
              />
            )}
            <ContextMenu>
              <ContextMenuTrigger
                render={<div className="group flex h-6 shrink-0 items-center gap-0.5 pe-1 ps-0.5" />}
              >
                <button
                  type="button"
                  aria-expanded={!collapsed}
                  className="flex min-w-0 flex-1 items-center gap-0.5 self-stretch rounded-sm text-start text-[11px] font-semibold uppercase tracking-wide text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => setCollapsed(view.id, !collapsed)}
                >
                  <ChevronRightIcon className={cn('size-3.5 shrink-0 transition-transform', !collapsed && 'rotate-90')} />
                  <span className="truncate">{label}</span>
                </button>
                {!collapsed && actions && (
                  <div className="flex items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
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
                <ContextMenuItem onClick={() => setLayout(toggleView(layout, view.id, false))}>
                  {t('view.hide', label)}
                </ContextMenuItem>
              </ContextMenuPopup>
            </ContextMenu>
            {!collapsed && <div className="min-h-0 flex-1 overflow-hidden">{render(view.id)}</div>}
          </section>
        )
      })}
    </div>
  )
}
