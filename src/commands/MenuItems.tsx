// Renders a registry menu (`resolveMenu`) as items of a coss Menu or ContextMenu.
import { Fragment } from 'react'
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from '@/components/ui/context-menu'
import { MenuItem, MenuSeparator, MenuShortcut } from '@/components/ui/menu'
import { useLocale } from '@/i18n'
import { formatKey, useEffectiveBindings } from './keybindings'
import { executeCommand, type MenuGroup, resolveMenu, title } from './registry'
import type { Context } from './when'

interface Props {
  menu: string
  context?: Context
  args?: unknown[]
  kind?: 'menu' | 'context'
  /** Groups rendered elsewhere (inline icons); `inline` is always left out */
  exclude?: string[]
}

export function MenuItems({ menu, context, args = [], kind = 'menu', exclude = [] }: Props) {
  useLocale()
  const bindings = useEffectiveBindings()
  const groups: MenuGroup[] = resolveMenu(menu, context).filter((g) => g.group !== 'inline' && !exclude.includes(g.group))
  const Item = kind === 'menu' ? MenuItem : ContextMenuItem
  const Separator = kind === 'menu' ? MenuSeparator : ContextMenuSeparator
  const Shortcut = kind === 'menu' ? MenuShortcut : ContextMenuShortcut
  return groups.map((group, i) => (
    <Fragment key={group.group || i}>
      {i > 0 && <Separator />}
      {group.items.map((item) => {
        if (!item.command) return null
        const binding = [...bindings].reverse().find((b) => b.command === item.command!.command)
        return (
          <Item
            key={item.id}
            disabled={!item.enabled}
            onClick={() => void executeCommand(item.command!.command, ...args)}
          >
            {title(item.command.title)}
            {binding && <Shortcut>{formatKey(binding.key)}</Shortcut>}
          </Item>
        )
      })}
    </Fragment>
  ))
}
