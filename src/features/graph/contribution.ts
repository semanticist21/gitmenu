// GitLens's "Show Commit Graph": opens the Graph tab for a repository.
import { WaypointsIcon } from 'lucide-react'
import { type Contribution, registerHandler } from '@/commands/registry'
import { ipc } from '@/lib/ipc'
import { repoFrom } from '../scm/state'

export const graphContribution: Contribution = {
  commands: [{ command: 'gitlens.showGraph', title: { gl: 'Show Commit Graph' }, category: { text: 'GitLens' }, icon: WaypointsIcon }],
  menus: {
    'scm/title': [{ command: 'gitlens.showGraph', group: 'navigation@-1', when: 'scmProvider == git' }],
    'view/title': [{ command: 'gitlens.showGraph', group: 'navigation@8', when: 'view == gitside.views.commits || view == gitside.views.branches' }],
  },
}

export function registerGraphHandlers() {
  registerHandler('gitlens.showGraph', (arg?: unknown) => {
    const root = repoFrom(arg)
    if (root) void ipc.detailOpen(`/detail/graph?${new URLSearchParams({ repo: root })}`)
  })
}
