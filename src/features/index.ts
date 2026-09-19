// Feature registrations: command contributions, handlers, views and detail tabs.
import { contribute, registerHandler } from '@/commands/registry'
import { registerDetailTab } from '@/routes/detail/DetailApp'
import { registerAiHandlers } from './ai/api'
import { ChangesTab, changesLabel } from './diff/ChangesTab'
import { diffContribution } from './diff/contribution'
import { DiffTab, diffLabel } from './diff/DiffTab'
import { FileTab, fileLabel } from './diff/FileTab'
import { graphContribution, registerGraphHandlers } from './graph/contribution'
import { GraphTab, graphLabel } from './graph/GraphTab'
import { CommitsView } from './history/CommitsView'
import { historyContribution } from './history/contribution'
import { FileHistoryView } from './history/FileHistoryView'
import { registerHistoryHandlers } from './history/handlers'
import { LineHistoryView } from './history/LineHistoryView'
import { SearchCompareView } from './history/SearchCompareView'
import { refsContribution, registerRefTitleHandlers } from './refs/contribution'
import { registerRefHandlers } from './refs/handlers'
import { BranchesView, ContributorsView, RemotesView, StashesView, TagsView, WorktreesView } from './refs/views'
import { ScmView } from './scm/components/ScmView'
import { scmContribution } from './scm/contribution'
import { commitAndThen, registerScmHandlers } from './scm/handlers'
import { KeybindingsTab } from './settings/KeybindingsTab'
import { SettingsTab } from './settings/SettingsTab'
import { AboutTab, aboutLabel } from './about/AboutTab'
import { OutputTab, outputLabel } from './output/OutputTab'
import { registerView } from './views/registry'
import { t } from '@/i18n'
import { ipc } from '@/lib/ipc'

contribute(scmContribution)
contribute(diffContribution)
contribute({
  commands: [
    { command: 'gitmenu.generateCommitMessage', title: { app: 'ai.generate' }, category: { text: 'gitmenu' }, icon: 'sparkle' },
    { command: 'gitmenu.commitAndPush', title: { vsb: '{0} Commit & Push' } },
    { command: 'gitmenu.commitAndSync', title: { vsb: '{0} Commit & Sync' } },
  ],
  menus: {
    commandPalette: [
      { command: 'gitmenu.commitAndPush', when: 'false' },
      { command: 'gitmenu.commitAndSync', when: 'false' },
    ],
  },
})

registerScmHandlers()
registerAiHandlers()
registerHandler('gitmenu.commitAndPush', (arg?: unknown) => commitAndThen(arg, 'push'))
registerHandler('gitmenu.commitAndSync', (arg?: unknown) => commitAndThen(arg, 'sync'))
registerView('scm', ScmView)

contribute(historyContribution)
registerHistoryHandlers()
registerView('commits', CommitsView)
registerView('fileHistory', FileHistoryView)
registerView('lineHistory', LineHistoryView)
registerView('searchCompare', SearchCompareView)

contribute(refsContribution)
registerRefHandlers()
registerRefTitleHandlers()
registerView('branches', BranchesView)
registerView('remotes', RemotesView)
registerView('tags', TagsView)
registerView('stashes', StashesView)
registerView('worktrees', WorktreesView)
registerView('contributors', ContributorsView)

contribute(graphContribution)
registerGraphHandlers()
registerDetailTab('graph', { label: graphLabel, component: GraphTab })

registerDetailTab('diff', { label: diffLabel, component: DiffTab })
registerDetailTab('file', { label: fileLabel, component: FileTab })
registerDetailTab('changes', { label: changesLabel, component: ChangesTab })
registerDetailTab('settings', { label: () => t('detail.settings'), component: SettingsTab })
registerDetailTab('keyboard-shortcuts', { label: () => t('detail.keybindings'), component: KeybindingsTab })
registerDetailTab('output', { label: outputLabel, component: OutputTab })
registerDetailTab('about', { label: aboutLabel, component: AboutTab })
registerHandler('workbench.action.showAboutDialog', () => ipc.detailOpen('/detail/about'))
registerHandler('git.showOutput', () => ipc.detailOpen('/detail/output'))
