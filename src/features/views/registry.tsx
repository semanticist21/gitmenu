// Maps view ids to their components, and renders each view's title actions
// (VS Code's `view/title` menu: `navigation` items as 20px icon actions, the rest under "…").
import { type ComponentType, memo } from 'react'
import { useContextKeys } from '@/commands/context'
import { MenuItems } from '@/commands/MenuItems'
import { executeCommand, resolveMenu, title } from '@/commands/registry'
import { Menu, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { t, useLocale } from '@/i18n'
import type { RepoInfo } from '@/lib/ipc'
import { ActionButton, commandIcon } from './ActionButton'
import { viewMessageClass } from './ViewTree'

export interface ViewProps {
  repo: RepoInfo
}

const components = new Map<string, ComponentType<ViewProps>>()

/** Same repository, even if the project list handed us a new object for it. */
function sameRepo(a: ViewProps, b: ViewProps) {
  const x = a.repo
  const y = b.repo
  return x.root === y.root && x.gitDir === y.gitDir && x.commonDir === y.commonDir && x.kind === y.kind && x.name === y.name
}

export function registerView(id: string, component: ComponentType<ViewProps>) {
  // A view re-renders for its own data, not when a sibling pane is toggled or resized
  components.set(id, memo(component, sameRepo))
}

/** A view without a component yet: VS Code's tree message. */
function EmptyView() {
  useLocale()
  return <p className={viewMessageClass}>{t('view.empty')}</p>
}

export function renderView(id: string, repo: RepoInfo) {
  const View = components.get(id) ?? EmptyView
  return <View key={repo.root} repo={repo} />
}

export function ViewActions({ view, repo }: { view: string; repo: RepoInfo }) {
  useLocale()
  // Enablement and `when` follow context changes (operationInProgress)
  useContextKeys()
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
