// Pieces of VS Code's editor chrome shared by the detail tabs: the editor title toolbar at the
// right end of the tab strip (the active tab portals its actions there), 22px action buttons
// with a hover instead of a native title, and the 22px breadcrumbs bar under the tabs.
import { createContext, type ReactNode, useContext } from 'react'
import { createPortal } from 'react-dom'
import { useShortcutFor } from '@/commands/keybindings'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export const EditorActionsSlot = createContext<HTMLElement | null>(null)

/** Renders `children` in the editor title toolbar of the tab strip. */
export function EditorActions({ children }: { children: ReactNode }) {
  const slot = useContext(EditorActionsSlot)
  return slot ? createPortal(children, slot) : null
}

/** VS Code's hover label for an action: `Next Change (⌥F5)`. */
function useActionLabel(label: string, command?: string) {
  const key = useShortcutFor(command ?? '')
  return command && key ? `${label} (${key})` : label
}

/** A 22px (or 20px with `small`) codicon action with a delayed hover. */
export function ActionButton({
  icon,
  label,
  command,
  pressed,
  disabled,
  small = false,
  className,
  onClick,
}: {
  icon: string | ReactNode
  label: string
  /** Shows this command's keybinding in the hover */
  command?: string
  /** Toggle state (toolbar.activeBackground when on) */
  pressed?: boolean
  disabled?: boolean
  small?: boolean
  className?: string
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const hover = useActionLabel(label, command)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size={small ? 'icon-sm' : 'icon'}
            variant="action"
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            className={className}
            onClick={onClick}
          />
        }
      >
        {typeof icon === 'string' ? <Icon name={icon} /> : icon}
      </TooltipTrigger>
      <TooltipPopup>{hover}</TooltipPopup>
    </Tooltip>
  )
}

/**
 * The breadcrumbs bar below the tabs (22px): the file's folders, then the file, separated by
 * `chevron-right`. Light themes draw editorWidget.border under it (breadcrumbscontrol.css).
 */
export function Breadcrumbs({ path, className }: { path: string; className?: string }) {
  const parts = path.split('/').filter(Boolean)
  return (
    <nav
      aria-label={path}
      className={cn(
        'flex h-[22px] shrink-0 cursor-default items-center overflow-hidden whitespace-nowrap bg-(--vsc-editor-background) text-(--vsc-breadcrumb-foreground) text-[13px] border-(--vsc-editorWidget-border) border-b dark:border-b-0',
        className,
      )}
    >
      <span className="w-4 shrink-0" />
      {parts.map((part, i) => {
        const last = i === parts.length - 1
        return (
          <span key={i} className={cn('flex h-full min-w-0 items-center', last ? 'max-w-[80%] shrink pe-2' : 'shrink-[2]')}>
            {last && <Icon name="file" className="me-1.5" />}
            <span className="truncate leading-[22px]">{part}</span>
            {!last && <Icon name="chevron-right" />}
          </span>
        )
      })}
    </nav>
  )
}

/**
 * VS Code's select box as macOS renders it: a native <select> (26px, 4px radius, dropdown
 * colors) with a `chevron-down` codicon. `compact` is the action-bar size (24px, 11px text).
 */
export function NativeSelect({
  value,
  options,
  onChange,
  compact = false,
  className,
  ...props
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  compact?: boolean
  className?: string
  'aria-label'?: string
  id?: string
}) {
  return (
    <span className={cn('relative inline-flex min-w-0', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full min-w-0 cursor-pointer appearance-none truncate rounded-[4px] border border-(--vsc-dropdown-border) bg-(--vsc-dropdown-background) text-(--vsc-dropdown-foreground) outline-none focus:outline-solid focus:outline-1 focus:-outline-offset-1 focus:outline-(--vsc-focusBorder)',
          compact ? 'h-6 py-0.5 ps-2 pe-[23px] text-[11px]' : 'h-[26px] py-0.5 ps-1.5 pe-6 text-[13px]',
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" className="pointer-events-none absolute end-1 top-1/2 -translate-y-1/2" />
    </span>
  )
}
