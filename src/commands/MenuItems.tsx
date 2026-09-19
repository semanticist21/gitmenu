// Renders a registry menu (`resolveMenu`) as items of a Menu or ContextMenu, including
// submenus (VS Code's `submenu` entries). Groups are split by separators; empty groups leave
// no leading, trailing or doubled separator. Keybindings show as plain text on the right.
import { Fragment, type ReactNode } from 'react'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubPopup,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu'
import { MenuItem, MenuSeparator, MenuShortcut, MenuSub, MenuSubPopup, MenuSubTrigger } from '@/components/ui/menu'
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
  const Sub = kind === 'menu' ? MenuSub : ContextMenuSub
  const SubTrigger = kind === 'menu' ? MenuSubTrigger : ContextMenuSubTrigger
  const SubPopup = kind === 'menu' ? MenuSubPopup : ContextMenuSubPopup

  const rendered = groups
    .map((group, i) => ({
      key: group.group || String(i),
      items: group.items
        .map((item): ReactNode => {
          if (item.submenu) {
            if (resolveMenu(item.submenu.id, context).every((g) => g.items.length === 0)) return null
            return (
              <Sub key={item.id}>
                <SubTrigger>{title(item.submenu.label)}</SubTrigger>
                <SubPopup>
                  <MenuItems menu={item.submenu.id} context={context} args={args} kind={kind} />
                </SubPopup>
              </Sub>
            )
          }
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
        })
        .filter((node) => node !== null),
    }))
    .filter((group) => group.items.length > 0)

  return rendered.map((group, i) => (
    <Fragment key={group.key}>
      {i > 0 && <Separator />}
      {group.items}
    </Fragment>
  ))
}
