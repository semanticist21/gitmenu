// Maps view ids to their components, and renders each view's title actions
// (VS Code's `view/title` menu: `navigation` items as 20px icon actions, the rest under "…").
import type { ComponentType } from 'react'
import { MenuItems } from '@/commands/MenuItems'
import { executeCommand, resolveMenu, title } from '@/commands/registry'
import { Menu, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { t, useLocale } from '@/i18n'
import type { RepoInfo } from '@/lib/ipc'
import { ActionButton, commandIcon } from './ActionButton'

export interface ViewProps {
  repo: RepoInfo
}

const components = new Map<string, ComponentType<ViewProps>>()

export function registerView(id: string, component: ComponentType<ViewProps>) {
  components.set(id, component)
}

/** A view without a component yet: VS Code's tree message. */
function EmptyView() {
  useLocale()
  return <p className="flex select-text py-1 ps-[18px] pe-3">{t('view.empty')}</p>
}

export function renderView(id: string, repo: RepoInfo) {
  const View = components.get(id) ?? EmptyView
  return <View key={repo.root} repo={repo} />
}

export function ViewActions({ view, repo }: { view: string; repo: RepoInfo }) {
  useLocale()
  // Source Control uses VS Code's own `scm/title` menu; the other views use `view/title`
  const menu = view === 'scm' ? 'scm/title' : 'view/title'
  const context = view === 'scm' ? { scmProvider: 'git' } : { view: `gitmenu.views.${view}` }
  const groups = resolveMenu(menu, context)
  const inline = groups.filter((g) => g.group === 'navigation').flatMap((g) => g.items)
  const hasMore = groups.some((g) => g.group !== 'navigation' && g.items.length > 0)
  return (
    <>
      {inline.map((item) => {
        const icon: unknown = item.command?.icon
        if (!item.command || !icon) return null
        return (
          <ActionButton
            key={item.id}
            small
            icon={commandIcon(icon)}
            label={title(item.command.title)}
            disabled={!item.enabled}
            onClick={() => void executeCommand(item.command!.command, repo.root)}
          />
        )
      })}
      {hasMore && (
        <Menu>
          <ActionButton small icon="ellipsis" label={t('panel.more')} render={<MenuTrigger />} />
          <MenuPopup align="end">
            <MenuItems menu={menu} context={context} args={[repo.root]} exclude={['navigation']} />
          </MenuPopup>
        </Menu>
      )}
    </>
  )
}
