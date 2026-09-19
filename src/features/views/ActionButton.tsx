// VS Code's icon action (`.action-label`): a codicon button, 22px in title bars and 20px in
// pane headers and rows, with a hover instead of the browser's title tooltip.
import type { ComponentType, ReactElement, ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'

/** A command's icon: a codicon id, or a component for GitLens's own glyphs. */
export function commandIcon(icon: unknown): ReactNode {
  if (!icon) return null
  if (typeof icon === 'string') return <Icon name={icon} />
  const Component = icon as ComponentType
  return <Component />
}

interface ActionButtonProps extends Omit<ButtonProps, 'children' | 'size' | 'variant'> {
  /** Codicon id, or any icon node */
  icon: string | ReactNode
  label: string
  /** 20px (pane headers, rows, tabs) instead of 22px (part titles, toolbars) */
  small?: boolean
  spin?: boolean
  /** Wraps the button, e.g. `<MenuTrigger />` so the action opens a menu */
  render?: ReactElement
}

export function ActionButton({ icon, label, small = false, spin, render, ...props }: ActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button size={small ? 'icon-sm' : 'icon'} variant="action" aria-label={label} render={render} {...props} />}
      >
        {typeof icon === 'string' ? <Icon name={icon} spin={spin} /> : icon}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  )
}
