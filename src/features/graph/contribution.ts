// GitLens's "Show Commit Graph": opens the Graph tab for a repository.
import { type CommandIcon, type Contribution, registerHandler } from '@/commands/registry'
import { ipc } from '@/lib/ipc'
import { repoFrom } from '../scm/state'
import { GraphIcon } from './glicons'

// `$(gitlens-graph)`: GitLens's own glyph, a component drawing a 16px currentColor SVG
const graphIcon: CommandIcon = GraphIcon

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
