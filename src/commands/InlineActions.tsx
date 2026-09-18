// A menu's `inline` group as icon buttons on a row, shown on hover, focus or selection.
import { executeCommand, resolveMenu, title } from '@/commands/registry'
import { Button } from '@/components/ui/button'
import type { Context } from './when'

export function InlineActions({ menu, context, args }: { menu: string; context: Context; args: unknown[] }) {
  const items = resolveMenu(menu, context)
    .filter((g) => g.group === 'inline')
    .flatMap((g) => g.items)
  if (items.length === 0) return null
  return (
    <div className="flex shrink-0 items-center opacity-0 group-hover/row:opacity-100 group-focus/row:opacity-100 group-data-[selected=true]/row:opacity-100">
      {items.map((item) => {
        const Icon = item.command?.icon
        if (!item.command || !Icon) return null
        const label = title(item.command.title)
        return (
          <Button
            key={item.id}
            size="icon-xs"
            variant="ghost"
            tabIndex={-1}
            aria-label={label}
            title={label}
            disabled={!item.enabled}
            onClick={(e) => {
              e.stopPropagation()
              void executeCommand(item.command!.command, ...args)
            }}
          >
            <Icon />
          </Button>
        )
      })}
    </div>
  )
}
