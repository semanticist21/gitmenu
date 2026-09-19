// Maps view ids to their components, and renders each view's title actions
// (VS Code's `view/title` menu: `navigation` items as icons, the rest under "More").
import { EllipsisIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import { MenuItems } from '@/commands/MenuItems'
import { executeCommand, resolveMenu, title } from '@/commands/registry'
import { Button } from '@/components/ui/button'
import { Menu, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { t, useLocale } from '@/i18n'
import type { RepoInfo } from '@/lib/ipc'

export interface ViewProps {
  repo: RepoInfo
}

const components = new Map<string, ComponentType<ViewProps>>()

export function registerView(id: string, component: ComponentType<ViewProps>) {
  components.set(id, component)
}

function EmptyView() {
  useLocale()
  return <p className="px-3 py-2 text-muted-foreground text-xs">{t('view.empty')}</p>
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
        const Icon = item.command?.icon
        if (!item.command || !Icon) return null
        const label = title(item.command.title)
        return (
          <Button
            key={item.id}
            size="icon-xs"
            variant="ghost"
            aria-label={label}
            title={label}
            disabled={!item.enabled}
            onClick={() => void executeCommand(item.command!.command, repo.root)}
          >
            <Icon />
          </Button>
        )
      })}
      {hasMore && (
        <Menu>
          <MenuTrigger render={<Button size="icon-xs" variant="ghost" aria-label={t('panel.more')} title={t('panel.more')} />}>
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItems menu={menu} context={context} args={[repo.root]} exclude={['navigation']} />
          </MenuPopup>
        </Menu>
      )}
    </>
  )
}
