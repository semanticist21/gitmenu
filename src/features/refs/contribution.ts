// GitLens commands and menus for the Branches, Remotes, Tags, Stashes, Worktrees and
// Contributors views.
import { executeCommand, registerHandler, type CommandContribution, type CommandIcon, type Contribution } from '@/commands/registry'
import { repoFrom } from '../scm/state'

const category = { text: 'Git' }

function command(id: string, title: string, extra: Partial<CommandContribution> = {}): CommandContribution {
  return { command: id, title: { gl: title }, category, ...extra }
}

/** A codicon id as a command icon (menus and inline actions render ids with `<Icon>`). GitLens's
 * own stash glyphs fall back to the codicons `git-stash` and `git-stash-pop`. */
const codicon = (id: string): CommandIcon => id

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
const TITLE_COMMANDS: [string, string, string, string][] = [
  ['gitmenu.views.branches.create', 'Create Branch...', 'git.branch', 'add'],
  ['gitmenu.views.remotes.add', 'Add Remote...', 'git.addRemote', 'add'],
  ['gitmenu.views.remotes.fetchAll', 'Fetch All', 'git.fetchAll', 'repo-fetch'],
  ['gitmenu.views.tags.create', 'Create Tag...', 'git.createTag', 'add'],
  ['gitmenu.views.stashes.stash', 'Stash All Changes...', 'git.stash', 'git-stash'],
  ['gitmenu.views.stashes.applyLatest', 'Apply Latest Stash', 'git.stashApplyLatest', 'git-stash-pop'],
  ['gitmenu.views.worktrees.create', 'Create Worktree...', 'git.createWorktree', 'add'],
]

export function registerRefTitleHandlers() {
  for (const [id, , target] of TITLE_COMMANDS) registerHandler(id, (arg?: unknown) => executeCommand(target, repoFrom(arg)))
}

export const refsContribution: Contribution = {
  commands: [
    ...TITLE_COMMANDS.map(([id, title, , icon]) => command(id, title, { icon: codicon(icon) })),
    command('gitmenu.views.switchToBranch', 'Switch to Branch...'),
    command('gitmenu.views.switchToTag', 'Switch to Tag...'),
    command('gitmenu.views.merge', 'Merge Branch into Current Branch...'),
    command('gitmenu.views.rebaseOntoBranch', 'Rebase Current Branch onto Branch...'),
    command('gitmenu.views.renameBranch', 'Rename Branch...'),
    command('gitmenu.views.deleteBranch', 'Delete Branch...', { icon: codicon('trash') }),
    command('gitmenu.views.createBranchFrom', 'Create Branch...'),
    command('gitmenu.views.pushBranch', 'Push Branch'),
    command('gitmenu.views.pushTag', 'Push Tag'),
    command('gitmenu.views.deleteTag', 'Delete Tag...', { icon: codicon('trash') }),
    command('gitmenu.views.compareRefWithHead', 'Compare with HEAD'),
    command('gitmenu.openBranchOnRemote', 'Open Branch on Remote'),
    command('gitmenu.copyRemoteBranchUrl', 'Copy Remote Branch URL'),
    command('gitmenu.views.copyRefName', 'Copy Name'),
    command('gitmenu.views.fetchRemote', 'Fetch', { icon: codicon('repo-fetch') }),
    command('gitmenu.views.pruneRemote', 'Prune'),
    command('gitmenu.views.removeRemote', 'Remove Remote...'),
    command('gitmenu.openRemoteOnRemote', 'Open Repository on Remote'),
    command('gitmenu.views.copyRemoteUrl', 'Copy Remote URL'),
    command('gitmenu.views.stash.apply', 'Apply Stash', { icon: codicon('git-stash-pop') }),
    command('gitmenu.views.stash.pop', 'Pop Stash'),
    command('gitmenu.views.stash.delete', 'Delete Stash...', { icon: codicon('trash') }),
    command('gitmenu.views.stash.openAll', 'Open All Changes'),
    command('gitmenu.views.openWorktree', 'Open Worktree in New Tab'),
    command('gitmenu.views.revealWorktreeInFinder', 'Reveal in Finder'),
    command('gitmenu.views.openWorktreeInTerminal', 'Open in Terminal'),
    command('gitmenu.views.deleteWorktree', 'Delete Worktree...', { icon: codicon('trash') }),
    command('gitmenu.views.lockWorktree', 'Lock'),
    command('gitmenu.views.unlockWorktree', 'Unlock'),
    command('gitmenu.views.addAuthor', 'Add as Co-author', { icon: codicon('person-add') }),
    command('gitmenu.views.copyEmail', 'Copy Email'),
  ],
  menus: {
    'view/title': [
      { command: 'gitmenu.views.branches.create', group: 'navigation@1', when: view('branches') },
      { command: 'gitmenu.views.remotes.add', group: 'navigation@1', when: view('remotes') },
      { command: 'gitmenu.views.remotes.fetchAll', group: 'navigation@2', when: view('remotes') },
      { command: 'gitmenu.views.tags.create', group: 'navigation@1', when: view('tags') },
      { command: 'gitmenu.views.stashes.stash', group: 'navigation@1', when: view('stashes') },
      { command: 'gitmenu.views.stashes.applyLatest', group: '1_gitlens@1', when: view('stashes') },
      { command: 'gitmenu.views.worktrees.create', group: 'navigation@1', when: view('worktrees') },
      ...['branches', 'remotes', 'tags', 'stashes', 'worktrees', 'contributors'].map((id) => ({
        command: 'gitmenu.views.refresh',
        group: 'navigation@9',
        when: view(id),
      })),
    ],
    'view/item/context': [
      ...rows([
        // Branches and remote branches
        ['gitmenu.views.switchToBranch', '1_gitlens_actions@1', `${branch} && ${notCurrent}`],
        ['gitmenu.views.merge', '1_gitlens_actions@2', `${branch} && ${notCurrent}`],
        ['gitmenu.views.rebaseOntoBranch', '1_gitlens_actions@3', `${branch} && ${notCurrent}`],
        ['gitmenu.views.pushBranch', '1_gitlens_actions@4', localBranch],
        ['gitmenu.views.createBranchFrom', '1_gitlens_actions_1@1', refRow],
        ['gitmenu.views.renameBranch', '1_gitlens_actions_1@2', localBranch],
        ['gitmenu.views.deleteBranch', '1_gitlens_actions_1@3', `${branch} && ${notCurrent}`],
        ['gitmenu.views.compareRefWithHead', '4_gitlens_compare@1', `${refRow} && ${notCurrent}`],
        ['gitmenu.openBranchOnRemote', '5_gitlens_remote@1', `${branch} && viewItem =~ /\\+(tracking|remote)/`],
        ['gitmenu.views.copyRefName', '6_gitlens_copy@1', refRow],
        ['gitmenu.copyRemoteBranchUrl', '6_gitlens_copy@2', `${branch} && viewItem =~ /\\+(tracking|remote)/`],
        ['gitmenu.views.switchToBranch', 'inline@1', `${remoteBranch}`],

        // Tags
        ['gitmenu.views.switchToTag', '1_gitlens_actions@1', tag],
        ['gitmenu.views.pushTag', '1_gitlens_actions@2', tag],
        ['gitmenu.views.deleteTag', '1_gitlens_actions_1@3', tag],

        // Remotes
        ['gitmenu.views.fetchRemote', 'inline@1', remote],
        ['gitmenu.views.fetchRemote', '1_gitlens_actions@1', remote],
        ['gitmenu.views.pruneRemote', '1_gitlens_actions@2', remote],
        ['gitmenu.openRemoteOnRemote', '5_gitlens_remote@1', `${remote} && viewItem =~ /\\+provider/`],
        ['gitmenu.views.copyRemoteUrl', '6_gitlens_copy@1', remote],
        ['gitmenu.views.removeRemote', '8_gitlens_actions@1', remote],

        // Stashes
        ['gitmenu.views.stash.apply', 'inline@1', stash],
        ['gitmenu.views.stash.delete', 'inline@99', stash],
        ['gitmenu.views.stash.apply', '1_gitlens_actions@1', stash],
        ['gitmenu.views.stash.pop', '1_gitlens_actions@2', stash],
        ['gitmenu.views.stash.openAll', '2_gitlens_quickopen@1', stash],
        ['gitmenu.views.stash.delete', '8_gitlens_actions@1', stash],

        // Worktrees
        ['gitmenu.views.openWorktree', '1_gitlens_actions@1', otherWorktree],
        ['gitmenu.views.revealWorktreeInFinder', '2_gitlens_open@1', worktree],
        ['gitmenu.views.openWorktreeInTerminal', '2_gitlens_open@2', worktree],
        ['gitmenu.views.lockWorktree', '3_gitlens_actions@1', item('^gitlens:worktree(?!.*\\+current)(?!.*\\+main)(?!.*\\+locked)')],
        ['gitmenu.views.unlockWorktree', '3_gitlens_actions@1', `${worktree} && viewItem =~ /\\+locked/`],
        ['gitmenu.views.deleteWorktree', '8_gitlens_actions@1', otherWorktree],

        // Contributors
        ['gitmenu.views.addAuthor', 'inline@1', contributor],
        ['gitmenu.views.addAuthor', '1_gitlens_actions@1', contributor],
        ['gitmenu.views.copyEmail', '6_gitlens_copy@1', contributor],
      ]),
    ],
    commandPalette: [
      'gitmenu.views.switchToBranch',
      'gitmenu.views.switchToTag',
      'gitmenu.views.merge',
      'gitmenu.views.rebaseOntoBranch',
      'gitmenu.views.renameBranch',
      'gitmenu.views.deleteBranch',
      'gitmenu.views.createBranchFrom',
      'gitmenu.views.pushBranch',
      'gitmenu.views.pushTag',
      'gitmenu.views.deleteTag',
      'gitmenu.views.compareRefWithHead',
      'gitmenu.openBranchOnRemote',
      'gitmenu.copyRemoteBranchUrl',
      'gitmenu.views.copyRefName',
      'gitmenu.views.fetchRemote',
      'gitmenu.views.pruneRemote',
      'gitmenu.views.removeRemote',
      'gitmenu.openRemoteOnRemote',
      'gitmenu.views.copyRemoteUrl',
      'gitmenu.views.stash.apply',
      'gitmenu.views.stash.pop',
      'gitmenu.views.stash.delete',
      'gitmenu.views.stash.openAll',
      'gitmenu.views.openWorktree',
      'gitmenu.views.revealWorktreeInFinder',
      'gitmenu.views.openWorktreeInTerminal',
      'gitmenu.views.deleteWorktree',
      'gitmenu.views.lockWorktree',
      'gitmenu.views.unlockWorktree',
      'gitmenu.views.addAuthor',
      'gitmenu.views.copyEmail',
    ].map((command) => ({ command, when: 'false' })),
  },
}
