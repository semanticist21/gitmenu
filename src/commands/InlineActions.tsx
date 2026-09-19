// A menu's `inline` group as 20px icon actions on a row, shown only on hover, focus or
// selection (VS Code toggles `display`, it does not fade them).
import type { ComponentType } from 'react'
import { executeCommand, resolveMenu, title } from '@/commands/registry'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import type { Context } from './when'

/** A command icon: a codicon id, or a component for GitLens's own glyphs. */
function ActionIcon({ icon }: { icon: unknown }) {
  if (typeof icon === 'string') return <Icon name={icon} />
  const Component = icon as ComponentType
  return <Component />
}

export function InlineActions({ menu, context, args }: { menu: string; context: Context; args: unknown[] }) {
  const items = resolveMenu(menu, context)
    .filter((g) => g.group === 'inline')
    .flatMap((g) => g.items)
  if (items.length === 0) return null
  return (
    <div className="hidden shrink-0 items-center group-focus-within/row:flex group-hover/row:flex group-focus/row:flex group-data-[selected=true]/row:flex">
      {items.map((item) => {
        const icon: unknown = item.command?.icon
        if (!item.command || !icon) return null
        const label = title(item.command.title)
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="action"
                  tabIndex={-1}
                  aria-label={label}
                  disabled={!item.enabled}
                  onClick={(e) => {
                    e.stopPropagation()
                    void executeCommand(item.command!.command, ...args)
                  }}
                />
              }
            >
              <ActionIcon icon={icon} />
            </TooltipTrigger>
            <TooltipPopup>{label}</TooltipPopup>
          </Tooltip>
        )
      })}
    </div>
  )
}
