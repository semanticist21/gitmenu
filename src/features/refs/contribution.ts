// GitLens commands and menus for the Branches, Remotes, Tags, Stashes, Worktrees and
// Contributors views.
import { ArchiveIcon, ArchiveRestoreIcon, CloudDownloadIcon, FolderPlusIcon, GitBranchPlusIcon, PlusIcon, TagIcon, TrashIcon, UserPlusIcon } from 'lucide-react'
import { executeCommand, registerHandler, type CommandContribution, type Contribution } from '@/commands/registry'
import { repoFrom } from '../scm/state'

const category = { text: 'GitLens' }

function command(id: string, title: string, extra: Partial<CommandContribution> = {}): CommandContribution {
  return { command: id, title: { gl: title }, category, ...extra }
}

const item = (re: string) => `viewItem =~ /${re}/`
const branch = item('^gitlens:branch\\b')
const localBranch = item('^gitlens:branch(?!.*\\+remote)')
const notCurrent = item('^gitlens:branch(?!.*\\+current)')
const remoteBranch = item('^gitlens:branch.*\\+remote')
const tag = item('^gitlens:tag\\b')
const refRow = item('^gitlens:(branch|tag)\\b')
const remote = item('^gitlens:remote\\b')
const stash = item('^gitlens:stash\\b')
const worktree = item('^gitlens:worktree\\b')
const otherWorktree = item('^gitlens:worktree(?!.*\\+current)(?!.*\\+main)')
const contributor = item('^gitlens:contributor\\b')
const view = (id: string) => `view == gitmenu.views.${id}`
const rows = (items: [string, string, string][]) => items.map(([command, group, when]) => ({ command, group, when }))

// View title buttons that run the VS Code git commands
const TITLE_COMMANDS: [string, string, string, typeof PlusIcon][] = [
  ['gitlens.views.branches.create', 'Create Branch...', 'git.branch', GitBranchPlusIcon],
  ['gitlens.views.remotes.add', 'Add Remote...', 'git.addRemote', PlusIcon],
  ['gitlens.views.remotes.fetchAll', 'Fetch All', 'git.fetchAll', CloudDownloadIcon],
  ['gitlens.views.tags.create', 'Create Tag...', 'git.createTag', TagIcon],
  ['gitlens.views.stashes.stash', 'Stash All Changes...', 'git.stash', ArchiveIcon],
  ['gitlens.views.stashes.applyLatest', 'Apply Latest Stash', 'git.stashApplyLatest', ArchiveRestoreIcon],
  ['gitlens.views.worktrees.create', 'Create Worktree...', 'git.createWorktree', FolderPlusIcon],
]

export function registerRefTitleHandlers() {
  for (const [id, , target] of TITLE_COMMANDS) registerHandler(id, (arg?: unknown) => executeCommand(target, repoFrom(arg)))
}

export const refsContribution: Contribution = {
  commands: [
    ...TITLE_COMMANDS.map(([id, title, , icon]) => command(id, title, { icon })),
    command('gitlens.views.switchToBranch', 'Switch to Branch...'),
    command('gitlens.views.switchToTag', 'Switch to Tag...'),
    command('gitlens.views.merge', 'Merge Branch into Current Branch...'),
    command('gitlens.views.rebaseOntoBranch', 'Rebase Current Branch onto Branch...'),
    command('gitlens.views.renameBranch', 'Rename Branch...'),
    command('gitlens.views.deleteBranch', 'Delete Branch...', { icon: TrashIcon }),
    command('gitlens.views.createBranchFrom', 'Create Branch...'),
    command('gitlens.views.pushBranch', 'Push Branch'),
    command('gitlens.views.pushTag', 'Push Tag'),
    command('gitlens.views.deleteTag', 'Delete Tag...', { icon: TrashIcon }),
    command('gitlens.views.compareRefWithHead', 'Compare with HEAD'),
    command('gitlens.openBranchOnRemote', 'Open Branch on Remote'),
    command('gitlens.copyRemoteBranchUrl', 'Copy Remote Branch URL'),
    command('gitlens.views.copyRefName', 'Copy Name'),
    command('gitlens.views.fetchRemote', 'Fetch', { icon: CloudDownloadIcon }),
    command('gitlens.views.pruneRemote', 'Prune'),
    command('gitlens.views.removeRemote', 'Remove Remote...'),
    command('gitlens.openRemoteOnRemote', 'Open Repository on Remote'),
    command('gitlens.views.copyRemoteUrl', 'Copy Remote URL'),
    command('gitlens.views.stash.apply', 'Apply Stash', { icon: ArchiveRestoreIcon }),
    command('gitlens.views.stash.pop', 'Pop Stash'),
    command('gitlens.views.stash.delete', 'Delete Stash...', { icon: TrashIcon }),
    command('gitlens.views.stash.openAll', 'Open All Changes'),
    command('gitlens.views.openWorktree', 'Open Worktree in New Tab'),
    command('gitlens.views.revealWorktreeInFinder', 'Reveal in Finder'),
    command('gitlens.views.openWorktreeInTerminal', 'Open in Terminal'),
    command('gitlens.views.deleteWorktree', 'Delete Worktree...', { icon: TrashIcon }),
    command('gitlens.views.lockWorktree', 'Lock'),
    command('gitlens.views.unlockWorktree', 'Unlock'),
    command('gitlens.views.addAuthor', 'Add as Co-author', { icon: UserPlusIcon }),
    command('gitlens.views.copyEmail', 'Copy Email'),
  ],
  menus: {
    'view/title': [
      { command: 'gitlens.views.branches.create', group: 'navigation@1', when: view('branches') },
      { command: 'gitlens.views.remotes.add', group: 'navigation@1', when: view('remotes') },
      { command: 'gitlens.views.remotes.fetchAll', group: 'navigation@2', when: view('remotes') },
      { command: 'gitlens.views.tags.create', group: 'navigation@1', when: view('tags') },
      { command: 'gitlens.views.stashes.stash', group: 'navigation@1', when: view('stashes') },
      { command: 'gitlens.views.stashes.applyLatest', group: '1_gitlens@1', when: view('stashes') },
      { command: 'gitlens.views.worktrees.create', group: 'navigation@1', when: view('worktrees') },
      ...['branches', 'remotes', 'tags', 'stashes', 'worktrees', 'contributors'].map((id) => ({
        command: 'gitlens.views.refresh',
        group: 'navigation@9',
        when: view(id),
      })),
    ],
    'view/item/context': [
      ...rows([
        // Branches and remote branches
        ['gitlens.views.switchToBranch', '1_gitlens_actions@1', `${branch} && ${notCurrent}`],
        ['gitlens.views.merge', '1_gitlens_actions@2', `${branch} && ${notCurrent}`],
        ['gitlens.views.rebaseOntoBranch', '1_gitlens_actions@3', `${branch} && ${notCurrent}`],
        ['gitlens.views.pushBranch', '1_gitlens_actions@4', localBranch],
        ['gitlens.views.createBranchFrom', '1_gitlens_actions_1@1', refRow],
        ['gitlens.views.renameBranch', '1_gitlens_actions_1@2', localBranch],
        ['gitlens.views.deleteBranch', '1_gitlens_actions_1@3', `${branch} && ${notCurrent}`],
        ['gitlens.views.compareRefWithHead', '4_gitlens_compare@1', `${refRow} && ${notCurrent}`],
        ['gitlens.openBranchOnRemote', '5_gitlens_remote@1', `${branch} && viewItem =~ /\\+(tracking|remote)/`],
        ['gitlens.views.copyRefName', '6_gitlens_copy@1', refRow],
        ['gitlens.copyRemoteBranchUrl', '6_gitlens_copy@2', `${branch} && viewItem =~ /\\+(tracking|remote)/`],
        ['gitlens.views.switchToBranch', 'inline@1', `${remoteBranch}`],

        // Tags
        ['gitlens.views.switchToTag', '1_gitlens_actions@1', tag],
        ['gitlens.views.pushTag', '1_gitlens_actions@2', tag],
        ['gitlens.views.deleteTag', '1_gitlens_actions_1@3', tag],

        // Remotes
        ['gitlens.views.fetchRemote', 'inline@1', remote],
        ['gitlens.views.fetchRemote', '1_gitlens_actions@1', remote],
        ['gitlens.views.pruneRemote', '1_gitlens_actions@2', remote],
        ['gitlens.openRemoteOnRemote', '5_gitlens_remote@1', `${remote} && viewItem =~ /\\+provider/`],
        ['gitlens.views.copyRemoteUrl', '6_gitlens_copy@1', remote],
        ['gitlens.views.removeRemote', '8_gitlens_actions@1', remote],

        // Stashes
        ['gitlens.views.stash.apply', 'inline@1', stash],
        ['gitlens.views.stash.delete', 'inline@99', stash],
        ['gitlens.views.stash.apply', '1_gitlens_actions@1', stash],
        ['gitlens.views.stash.pop', '1_gitlens_actions@2', stash],
        ['gitlens.views.stash.openAll', '2_gitlens_quickopen@1', stash],
        ['gitlens.views.stash.delete', '8_gitlens_actions@1', stash],

        // Worktrees
        ['gitlens.views.openWorktree', '1_gitlens_actions@1', otherWorktree],
        ['gitlens.views.revealWorktreeInFinder', '2_gitlens_open@1', worktree],
        ['gitlens.views.openWorktreeInTerminal', '2_gitlens_open@2', worktree],
        ['gitlens.views.lockWorktree', '3_gitlens_actions@1', item('^gitlens:worktree(?!.*\\+current)(?!.*\\+main)(?!.*\\+locked)')],
        ['gitlens.views.unlockWorktree', '3_gitlens_actions@1', `${worktree} && viewItem =~ /\\+locked/`],
        ['gitlens.views.deleteWorktree', '8_gitlens_actions@1', otherWorktree],

        // Contributors
        ['gitlens.views.addAuthor', 'inline@1', contributor],
        ['gitlens.views.addAuthor', '1_gitlens_actions@1', contributor],
        ['gitlens.views.copyEmail', '6_gitlens_copy@1', contributor],
      ]),
    ],
    commandPalette: [
      'gitlens.views.switchToBranch',
      'gitlens.views.switchToTag',
      'gitlens.views.merge',
      'gitlens.views.rebaseOntoBranch',
      'gitlens.views.renameBranch',
      'gitlens.views.deleteBranch',
      'gitlens.views.createBranchFrom',
      'gitlens.views.pushBranch',
      'gitlens.views.pushTag',
      'gitlens.views.deleteTag',
      'gitlens.views.compareRefWithHead',
      'gitlens.openBranchOnRemote',
      'gitlens.copyRemoteBranchUrl',
      'gitlens.views.copyRefName',
      'gitlens.views.fetchRemote',
      'gitlens.views.pruneRemote',
      'gitlens.views.removeRemote',
      'gitlens.openRemoteOnRemote',
      'gitlens.views.copyRemoteUrl',
      'gitlens.views.stash.apply',
      'gitlens.views.stash.pop',
      'gitlens.views.stash.delete',
      'gitlens.views.stash.openAll',
      'gitlens.views.openWorktree',
      'gitlens.views.revealWorktreeInFinder',
      'gitlens.views.openWorktreeInTerminal',
      'gitlens.views.deleteWorktree',
      'gitlens.views.lockWorktree',
      'gitlens.views.unlockWorktree',
      'gitlens.views.addAuthor',
      'gitlens.views.copyEmail',
    ].map((command) => ({ command, when: 'false' })),
  },
}
