// GitLens's "Show Commit Graph": opens the Graph tab for a repository.
import { type CommandIcon, type Contribution, registerHandler } from '@/commands/registry'
import { LogoMarkIcon } from '@/components/LogoIcons'
import { ipc } from '@/lib/ipc'
import { repoFrom } from '../scm/state'

// GitLens draws its own `$(gitlens-graph)` glyph here; gitmenu uses its logo mark
const graphIcon: CommandIcon = LogoMarkIcon

export const graphContribution: Contribution = {
  commands: [{ command: 'gitlens.showGraph', title: { gl: 'Show Commit Graph' }, category: { text: 'GitLens' }, icon: graphIcon }],
  menus: {
    'scm/title': [{ command: 'gitlens.showGraph', group: 'navigation@-1', when: 'scmProvider == git' }],
    'view/title': [{ command: 'gitlens.showGraph', group: 'navigation@8', when: 'view == gitmenu.views.commits || view == gitmenu.views.branches' }],
  },
}

export function registerGraphHandlers() {
  registerHandler('gitlens.showGraph', (arg?: unknown) => {
    const root = repoFrom(arg)
    if (root) void ipc.detailOpen(`/detail/graph?${new URLSearchParams({ repo: root })}`)
  })
}
