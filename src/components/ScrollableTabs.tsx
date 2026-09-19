// A tab strip that scrolls sideways when its tabs don't fit: a faint fade and a chevron button
// on each side that has more tabs, the vertical wheel scrolls it, and the active tab (marked
// aria-selected) is kept in view.
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'

const FADE = 16

type Edges = { start: boolean; end: boolean }

function measureEdges(el: HTMLElement, set: (update: (prev: Edges) => Edges) => void) {
  const start = el.scrollLeft > 1
  const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
  set((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
}

export function ScrollableTabs({
  children,
  label,
  className,
  activeKey,
  scrollerRef,
}: {
  children: ReactNode
  label: string
  className?: string
  activeKey?: string | null
  /** The scrolling element, for callers that move focus between tabs */
  scrollerRef?: RefObject<HTMLDivElement | null>
}) {
  const own = useRef<HTMLDivElement>(null)
  const ref = scrollerRef ?? own
  const [edges, setEdges] = useState<Edges>({ start: false, end: false })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => measureEdges(el, setEdges)
    const observer = new ResizeObserver(update)
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    el.addEventListener('scroll', update, { passive: true })
    update()
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [ref, children])

  // Keep the active tab visible when it changes
  useEffect(() => {
    const el = ref.current
    el?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (el) measureEdges(el, setEdges)
  }, [ref, activeKey])

  const scroll = (direction: 1 | -1) => {
    const el = ref.current
    if (el) el.scrollBy({ left: direction * Math.max(80, el.clientWidth * 0.7) })
  }

  const mask =
    edges.start || edges.end
      ? `linear-gradient(to right, ${edges.start ? 'transparent' : 'black'} 0, black ${FADE}px, black calc(100% - ${FADE}px), ${edges.end ? 'transparent' : 'black'} 100%)`
      : undefined

  return (
    <div className={cn('relative flex min-w-0 flex-1', className)}>
      {edges.start && <Chevron direction={-1} onClick={() => scroll(-1)} />}
      <div
        ref={ref}
        role="tablist"
        aria-label={label}
        className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
        onWheel={(e) => {
          // A vertical wheel scrolls the strip sideways, as in VS Code
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
        }}
      >
        {children}
      </div>
      {edges.end && <Chevron direction={1} onClick={() => scroll(1)} />}
    </div>
  )
}

function Chevron({ direction, onClick }: { direction: 1 | -1; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      className="flex w-4 shrink-0 items-center justify-center self-stretch text-(--vsc-icon-foreground) opacity-70 hover:bg-(--vsc-toolbar-hoverBackground) hover:opacity-100"
      onClick={onClick}
    >
      <Icon name={direction < 0 ? 'chevron-left' : 'chevron-right'} className="text-[12px]" />
    </button>
  )
}
