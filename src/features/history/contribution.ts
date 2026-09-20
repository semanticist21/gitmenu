// GitLens commands and menus for the Commits, File History, Line History and Search &
// Compare views, and GitLens's additions to Source Control rows. GitLens strings are English
// with gitmenu's own translations (`gl`).
import type { CommandContribution, CommandIcon, Contribution } from '@/commands/registry'

const category = { text: 'Git' }

function command(id: string, title: string, extra: Partial<CommandContribution> = {}): CommandContribution {
  return { command: id, title: { gl: title }, category, ...extra }
}

/** A codicon id as a command icon (menus and inline actions render ids with `<Icon>`). GitLens's
 * own glyphs (compare-ref-working) fall back to the nearest codicon. */
const codicon = (id: string): CommandIcon => id

const commit = 'viewItem =~ /^gitlens:commit\\b/'
const file = 'viewItem =~ /^gitlens:file\\b/'
const views = (...ids: string[]) => ids.map((id) => `view == gitmenu.views.${id}`).join(' || ')
const rowMenu = (items: [string, string, string][]) => items.map(([command, group, when]) => ({ command, group, when }))

export const historyContribution: Contribution = {
  commands: [
    command('gitmenu.views.searchAndCompare.searchCommits', 'Search Commits...', { icon: codicon('search') }),
    command('gitmenu.views.searchAndCompare.selectForCompare', 'Compare References...', { icon: codicon('compare-changes') }),
    command('gitmenu.views.searchAndCompare.clear', 'Clear Results', { icon: codicon('clear-all') }),
    command('gitmenu.views.dismissNode', 'Dismiss', { icon: codicon('close') }),
    command('gitmenu.views.swapComparison', 'Swap Comparison', { icon: codicon('arrow-swap') }),
    command('gitmenu.views.refresh', 'Refresh', { icon: codicon('refresh') }),
    command('gitmenu.views.push', 'Push', { icon: codicon('repo-push') }),
    command('gitmenu.views.pull', 'Pull', { icon: codicon('repo-pull') }),
    command('gitmenu.views.fetch', 'Fetch', { icon: codicon('repo-fetch') }),
    command('gitmenu.views.publishBranch', 'Publish Branch', { icon: codicon('cloud-upload') }),
    command('gitmenu.views.fileHistory.pick', 'Choose File...', { icon: codicon('folder-opened') }),
    command('gitmenu.views.fileHistory.setEditorFollowingOff', 'Pin the Current History', { icon: codicon('pin') }),
    command('gitmenu.views.fileHistory.setEditorFollowingOn', 'Unpin the Current History', { icon: codicon('pinned') }),

    command('gitmenu.views.cherryPick', 'Cherry Pick Commit...'),
    command('gitmenu.views.revert', 'Revert Commit...'),
    command('gitmenu.views.resetToCommit', 'Reset Current Branch to Commit...'),
    command('gitmenu.views.resetCommit', 'Reset Current Branch to Previous Commit...'),
    command('gitmenu.views.rebaseOntoCommit', 'Rebase Current Branch onto Commit...'),
    command('gitmenu.views.switchToCommit', 'Switch to Commit...'),
    command('gitmenu.views.createBranch', 'Create Branch...'),
    command('gitmenu.views.createTag', 'Create Tag...'),
    command('gitmenu.views.openChanges', 'Open Changes', { icon: codicon('compare-changes') }),
    command('gitmenu.views.openChangesWithWorking', 'Open Changes with Working File', { icon: codicon('compare-changes') }),
    command('gitmenu.views.openFile', 'Open File', { icon: codicon('go-to-file') }),
    command('gitmenu.views.openFileRevision', 'Open File at Revision'),
    command('gitmenu.views.compareWithHead', 'Compare with HEAD'),
    command('gitmenu.views.selectForCompare', 'Select for Compare'),
    command('gitmenu.views.compareWithSelected', 'Compare with Selected'),
    command('gitmenu.copyShaToClipboard', 'Copy SHA'),
    command('gitmenu.copyMessageToClipboard', 'Copy Message'),
    command('gitmenu.openCommitOnRemote', 'Open Commit on Remote'),
    command('gitmenu.copyRemoteCommitUrl', 'Copy Remote Commit URL'),
    command('gitmenu.openFileOnRemote', 'Open File on Remote'),
    command('gitmenu.copyRemoteFileUrlToClipboard', 'Copy Remote File URL'),
    command('gitmenu.openRepoOnRemote', 'Open Repository on Remote'),
    command('gitmenu.openFileHistory', 'Open File History', { icon: codicon('history') }),
  ],
  menus: {
    'view/title': [
      { command: 'gitmenu.views.searchAndCompare.searchCommits', group: 'navigation@1', when: views('commits', 'searchCompare') },
      { command: 'gitmenu.views.searchAndCompare.selectForCompare', group: 'navigation@2', when: views('searchCompare') },
      { command: 'gitmenu.views.searchAndCompare.clear', group: 'navigation@3', when: views('searchCompare') },
      { command: 'gitmenu.views.fileHistory.pick', group: 'navigation@1', when: views('fileHistory') },
      { command: 'gitmenu.views.fileHistory.setEditorFollowingOff', group: 'navigation@2', when: `${views('fileHistory')} && !gitmenu:views:fileHistory:pinned` },
      { command: 'gitmenu.views.fileHistory.setEditorFollowingOn', group: 'navigation@2', when: `${views('fileHistory')} && gitmenu:views:fileHistory:pinned` },
      { command: 'gitmenu.views.refresh', group: 'navigation@9', when: views('commits', 'fileHistory', 'lineHistory', 'searchCompare') },
      { command: 'gitmenu.views.pull', group: '1_gitlens_sync@1', when: views('commits') },
      { command: 'gitmenu.views.push', group: '1_gitlens_sync@2', when: views('commits') },
      { command: 'gitmenu.views.fetch', group: '1_gitlens_sync@3', when: views('commits') },
      { command: 'gitmenu.openRepoOnRemote', group: '2_gitlens_remote@1', when: views('commits') },
    ],
    'view/item/context': [
      // Branch status rows in Commits
      { command: 'gitmenu.views.push', group: 'inline@1', when: 'viewItem =~ /upstream\\+ahead/' },
      { command: 'gitmenu.views.pull', group: 'inline@1', when: 'viewItem =~ /upstream\\+behind/' },
      { command: 'gitmenu.views.fetch', group: 'inline@1', when: 'viewItem =~ /upstream\\+same/' },
      { command: 'gitmenu.views.publishBranch', group: 'inline@1', when: 'viewItem =~ /upstream\\+none/' },
      { command: 'gitmenu.views.push', group: '1_gitlens_actions@1', when: 'viewItem =~ /^gitlens:status-branch/' },
      { command: 'gitmenu.views.pull', group: '1_gitlens_actions@2', when: 'viewItem =~ /^gitlens:status-branch/' },
      { command: 'gitmenu.views.fetch', group: '1_gitlens_actions@3', when: 'viewItem =~ /^gitlens:status-branch/' },

      // Commits
      ...rowMenu([
        ['gitmenu.views.openChanges', '2_gitlens_quickopen@1', commit],
        ['gitmenu.views.openChangesWithWorking', '2_gitlens_quickopen@2', commit],
        ['gitmenu.views.cherryPick', '1_gitlens_actions@1', 'viewItem =~ /^gitlens:commit(?!.*\\+current)/'],
        ['gitmenu.views.revert', '1_gitlens_actions@2', `${commit} && viewItem =~ /\\+current/`],
        ['gitmenu.views.resetToCommit', '1_gitlens_actions@3', `${commit} && viewItem =~ /\\+current/`],
        ['gitmenu.views.resetCommit', '1_gitlens_actions@4', `${commit} && viewItem =~ /\\+current/`],
        ['gitmenu.views.rebaseOntoCommit', '1_gitlens_actions@5', commit],
        ['gitmenu.views.switchToCommit', '1_gitlens_actions@6', commit],
        ['gitmenu.views.createBranch', '1_gitlens_actions_1@1', commit],
        ['gitmenu.views.createTag', '1_gitlens_actions_1@2', commit],
        ['gitmenu.views.compareWithHead', '4_gitlens_compare@1', commit],
        ['gitmenu.views.selectForCompare', '4_gitlens_compare@2', commit],
        ['gitmenu.views.compareWithSelected', '4_gitlens_compare@3', `${commit} && gitlens:views:canCompare`],
        ['gitmenu.openCommitOnRemote', '5_gitlens_remote@1', commit],
        ['gitmenu.copyShaToClipboard', '6_gitlens_copy@1', commit],
        ['gitmenu.copyMessageToClipboard', '6_gitlens_copy@2', commit],
        ['gitmenu.copyRemoteCommitUrl', '6_gitlens_copy@3', commit],
      ]),

      // Files in a commit
      ...rowMenu([
        ['gitmenu.views.openChangesWithWorking', 'inline@1', file],
        ['gitmenu.views.openFile', 'inline@2', file],
        ['gitmenu.views.openChanges', '2_gitlens_quickopen@1', file],
        ['gitmenu.views.openChangesWithWorking', '2_gitlens_quickopen@2', file],
        ['gitmenu.views.openFile', '2_gitlens_quickopen_file@1', file],
        ['gitmenu.views.openFileRevision', '2_gitlens_quickopen_file@2', file],
        ['gitmenu.openFileHistory', '3_gitlens_explore@1', file],
        ['gitmenu.openFileOnRemote', '5_gitlens_remote@1', file],
        ['gitmenu.copyShaToClipboard', '6_gitlens_copy@1', file],
        ['gitmenu.copyRemoteFileUrlToClipboard', '6_gitlens_copy@2', file],
      ]),

      // Search & Compare results
      { command: 'gitmenu.views.swapComparison', group: 'inline@1', when: 'viewItem == gitlens:compare:results' },
      { command: 'gitmenu.views.dismissNode', group: 'inline@99', when: 'viewItem =~ /^gitlens:(search|compare):results/' },
      { command: 'gitmenu.views.swapComparison', group: '1_gitlens_actions@1', when: 'viewItem == gitlens:compare:results' },
      { command: 'gitmenu.views.dismissNode', group: '8_gitlens_actions@1', when: 'viewItem =~ /^gitlens:(search|compare):results/' },
    ],
    'scm/resourceState/context': [
      { command: 'gitmenu.openFileHistory', group: '4_gitlens_history@1', when: 'scmProvider == git' },
      { command: 'gitmenu.openFileOnRemote', group: '5_gitlens_remote@1', when: 'scmProvider == git && scmResourceGroup != untracked' },
      { command: 'gitmenu.copyRemoteFileUrlToClipboard', group: '5_gitlens_remote@2', when: 'scmProvider == git && scmResourceGroup != untracked' },
    ],
    commandPalette: [
      { command: 'gitmenu.views.dismissNode', when: 'false' },
      { command: 'gitmenu.views.swapComparison', when: 'false' },
      { command: 'gitmenu.views.openChanges', when: 'false' },
      { command: 'gitmenu.views.openChangesWithWorking', when: 'false' },
      { command: 'gitmenu.views.openFile', when: 'false' },
      { command: 'gitmenu.views.openFileRevision', when: 'false' },
      { command: 'gitmenu.views.cherryPick', when: 'false' },
      { command: 'gitmenu.views.revert', when: 'false' },
      { command: 'gitmenu.views.resetToCommit', when: 'false' },
      { command: 'gitmenu.views.resetCommit', when: 'false' },
      { command: 'gitmenu.views.rebaseOntoCommit', when: 'false' },
      { command: 'gitmenu.views.switchToCommit', when: 'false' },
      { command: 'gitmenu.views.createBranch', when: 'false' },
      { command: 'gitmenu.views.createTag', when: 'false' },
      { command: 'gitmenu.views.compareWithHead', when: 'false' },
      { command: 'gitmenu.views.selectForCompare', when: 'false' },
      { command: 'gitmenu.views.compareWithSelected', when: 'false' },
      { command: 'gitmenu.copyShaToClipboard', when: 'false' },
      { command: 'gitmenu.copyMessageToClipboard', when: 'false' },
      { command: 'gitmenu.openCommitOnRemote', when: 'false' },
      { command: 'gitmenu.copyRemoteCommitUrl', when: 'false' },
      { command: 'gitmenu.openFileOnRemote', when: 'false' },
      { command: 'gitmenu.copyRemoteFileUrlToClipboard', when: 'false' },
      { command: 'gitmenu.openFileHistory', when: 'false' },
    ],
  },
}
