// GitLens commands and menus for the Commits, File History, Line History and Search &
// Compare views, and GitLens's additions to Source Control rows. GitLens strings are English
// with gitmenu's own translations (`gl`).
import type { CommandContribution, CommandIcon, Contribution } from '@/commands/registry'

const category = { text: 'GitLens' }

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
    command('gitlens.views.searchAndCompare.searchCommits', 'Search Commits...', { icon: codicon('search') }),
    command('gitlens.views.searchAndCompare.selectForCompare', 'Compare References...', { icon: codicon('compare-changes') }),
    command('gitlens.views.searchAndCompare.clear', 'Clear Results', { icon: codicon('clear-all') }),
    command('gitlens.views.dismissNode', 'Dismiss', { icon: codicon('close') }),
    command('gitlens.views.swapComparison', 'Swap Comparison', { icon: codicon('arrow-swap') }),
    command('gitlens.views.refresh', 'Refresh', { icon: codicon('refresh') }),
    command('gitlens.views.push', 'Push', { icon: codicon('repo-push') }),
    command('gitlens.views.pull', 'Pull', { icon: codicon('repo-pull') }),
    command('gitlens.views.fetch', 'Fetch', { icon: codicon('repo-fetch') }),
    command('gitlens.views.publishBranch', 'Publish Branch', { icon: codicon('cloud-upload') }),
    command('gitlens.views.fileHistory.pick', 'Choose File...', { icon: codicon('folder-opened') }),
    command('gitlens.views.fileHistory.setEditorFollowingOff', 'Pin the Current History', { icon: codicon('pin') }),
    command('gitlens.views.fileHistory.setEditorFollowingOn', 'Unpin the Current History', { icon: codicon('pinned') }),

    command('gitlens.views.cherryPick', 'Cherry Pick Commit...'),
    command('gitlens.views.revert', 'Revert Commit...'),
    command('gitlens.views.resetToCommit', 'Reset Current Branch to Commit...'),
    command('gitlens.views.resetCommit', 'Reset Current Branch to Previous Commit...'),
    command('gitlens.views.rebaseOntoCommit', 'Rebase Current Branch onto Commit...'),
    command('gitlens.views.switchToCommit', 'Switch to Commit...'),
    command('gitlens.views.createBranch', 'Create Branch...'),
    command('gitlens.views.createTag', 'Create Tag...'),
    command('gitlens.views.openChanges', 'Open Changes', { icon: codicon('compare-changes') }),
    command('gitlens.views.openChangesWithWorking', 'Open Changes with Working File', { icon: codicon('compare-changes') }),
    command('gitlens.views.openFile', 'Open File', { icon: codicon('go-to-file') }),
    command('gitlens.views.openFileRevision', 'Open File at Revision'),
    command('gitlens.views.compareWithHead', 'Compare with HEAD'),
    command('gitlens.views.selectForCompare', 'Select for Compare'),
    command('gitlens.views.compareWithSelected', 'Compare with Selected'),
    command('gitlens.copyShaToClipboard', 'Copy SHA'),
    command('gitlens.copyMessageToClipboard', 'Copy Message'),
    command('gitlens.openCommitOnRemote', 'Open Commit on Remote'),
    command('gitlens.copyRemoteCommitUrl', 'Copy Remote Commit URL'),
    command('gitlens.openFileOnRemote', 'Open File on Remote'),
    command('gitlens.copyRemoteFileUrlToClipboard', 'Copy Remote File URL'),
    command('gitlens.openRepoOnRemote', 'Open Repository on Remote'),
    command('gitlens.openFileHistory', 'Open File History', { icon: codicon('history') }),
  ],
  menus: {
    'view/title': [
      { command: 'gitlens.views.searchAndCompare.searchCommits', group: 'navigation@1', when: views('commits', 'searchCompare') },
      { command: 'gitlens.views.searchAndCompare.selectForCompare', group: 'navigation@2', when: views('searchCompare') },
      { command: 'gitlens.views.searchAndCompare.clear', group: 'navigation@3', when: views('searchCompare') },
      { command: 'gitlens.views.fileHistory.pick', group: 'navigation@1', when: views('fileHistory') },
      { command: 'gitlens.views.fileHistory.setEditorFollowingOff', group: 'navigation@2', when: `${views('fileHistory')} && !gitmenu:views:fileHistory:pinned` },
      { command: 'gitlens.views.fileHistory.setEditorFollowingOn', group: 'navigation@2', when: `${views('fileHistory')} && gitmenu:views:fileHistory:pinned` },
      { command: 'gitlens.views.refresh', group: 'navigation@9', when: views('commits', 'fileHistory', 'lineHistory', 'searchCompare') },
      { command: 'gitlens.views.pull', group: '1_gitlens_sync@1', when: views('commits') },
      { command: 'gitlens.views.push', group: '1_gitlens_sync@2', when: views('commits') },
      { command: 'gitlens.views.fetch', group: '1_gitlens_sync@3', when: views('commits') },
      { command: 'gitlens.openRepoOnRemote', group: '2_gitlens_remote@1', when: views('commits') },
    ],
    'view/item/context': [
      // Branch status rows in Commits
      { command: 'gitlens.views.push', group: 'inline@1', when: 'viewItem =~ /upstream\\+ahead/' },
      { command: 'gitlens.views.pull', group: 'inline@1', when: 'viewItem =~ /upstream\\+behind/' },
      { command: 'gitlens.views.fetch', group: 'inline@1', when: 'viewItem =~ /upstream\\+same/' },
      { command: 'gitlens.views.publishBranch', group: 'inline@1', when: 'viewItem =~ /upstream\\+none/' },
      { command: 'gitlens.views.push', group: '1_gitlens_actions@1', when: 'viewItem =~ /^gitlens:status-branch/' },
      { command: 'gitlens.views.pull', group: '1_gitlens_actions@2', when: 'viewItem =~ /^gitlens:status-branch/' },
      { command: 'gitlens.views.fetch', group: '1_gitlens_actions@3', when: 'viewItem =~ /^gitlens:status-branch/' },

      // Commits
      ...rowMenu([
        ['gitlens.views.openChanges', '2_gitlens_quickopen@1', commit],
        ['gitlens.views.openChangesWithWorking', '2_gitlens_quickopen@2', commit],
        ['gitlens.views.cherryPick', '1_gitlens_actions@1', 'viewItem =~ /^gitlens:commit(?!.*\\+current)/'],
        ['gitlens.views.revert', '1_gitlens_actions@2', `${commit} && viewItem =~ /\\+current/`],
        ['gitlens.views.resetToCommit', '1_gitlens_actions@3', `${commit} && viewItem =~ /\\+current/`],
        ['gitlens.views.resetCommit', '1_gitlens_actions@4', `${commit} && viewItem =~ /\\+current/`],
        ['gitlens.views.rebaseOntoCommit', '1_gitlens_actions@5', commit],
        ['gitlens.views.switchToCommit', '1_gitlens_actions@6', commit],
        ['gitlens.views.createBranch', '1_gitlens_actions_1@1', commit],
        ['gitlens.views.createTag', '1_gitlens_actions_1@2', commit],
        ['gitlens.views.compareWithHead', '4_gitlens_compare@1', commit],
        ['gitlens.views.selectForCompare', '4_gitlens_compare@2', commit],
        ['gitlens.views.compareWithSelected', '4_gitlens_compare@3', `${commit} && gitlens:views:canCompare`],
        ['gitlens.openCommitOnRemote', '5_gitlens_remote@1', commit],
        ['gitlens.copyShaToClipboard', '6_gitlens_copy@1', commit],
        ['gitlens.copyMessageToClipboard', '6_gitlens_copy@2', commit],
        ['gitlens.copyRemoteCommitUrl', '6_gitlens_copy@3', commit],
      ]),

      // Files in a commit
      ...rowMenu([
        ['gitlens.views.openChangesWithWorking', 'inline@1', file],
        ['gitlens.views.openFile', 'inline@2', file],
        ['gitlens.views.openChanges', '2_gitlens_quickopen@1', file],
        ['gitlens.views.openChangesWithWorking', '2_gitlens_quickopen@2', file],
        ['gitlens.views.openFile', '2_gitlens_quickopen_file@1', file],
        ['gitlens.views.openFileRevision', '2_gitlens_quickopen_file@2', file],
        ['gitlens.openFileHistory', '3_gitlens_explore@1', file],
        ['gitlens.openFileOnRemote', '5_gitlens_remote@1', file],
        ['gitlens.copyShaToClipboard', '6_gitlens_copy@1', file],
        ['gitlens.copyRemoteFileUrlToClipboard', '6_gitlens_copy@2', file],
      ]),

      // Search & Compare results
      { command: 'gitlens.views.swapComparison', group: 'inline@1', when: 'viewItem == gitlens:compare:results' },
      { command: 'gitlens.views.dismissNode', group: 'inline@99', when: 'viewItem =~ /^gitlens:(search|compare):results/' },
      { command: 'gitlens.views.swapComparison', group: '1_gitlens_actions@1', when: 'viewItem == gitlens:compare:results' },
      { command: 'gitlens.views.dismissNode', group: '8_gitlens_actions@1', when: 'viewItem =~ /^gitlens:(search|compare):results/' },
    ],
    'scm/resourceState/context': [
      { command: 'gitlens.openFileHistory', group: '4_gitlens_history@1', when: 'scmProvider == git' },
      { command: 'gitlens.openFileOnRemote', group: '5_gitlens_remote@1', when: 'scmProvider == git && scmResourceGroup != untracked' },
      { command: 'gitlens.copyRemoteFileUrlToClipboard', group: '5_gitlens_remote@2', when: 'scmProvider == git && scmResourceGroup != untracked' },
    ],
    commandPalette: [
      { command: 'gitlens.views.dismissNode', when: 'false' },
      { command: 'gitlens.views.swapComparison', when: 'false' },
      { command: 'gitlens.views.openChanges', when: 'false' },
      { command: 'gitlens.views.openChangesWithWorking', when: 'false' },
      { command: 'gitlens.views.openFile', when: 'false' },
      { command: 'gitlens.views.openFileRevision', when: 'false' },
      { command: 'gitlens.views.cherryPick', when: 'false' },
      { command: 'gitlens.views.revert', when: 'false' },
      { command: 'gitlens.views.resetToCommit', when: 'false' },
      { command: 'gitlens.views.resetCommit', when: 'false' },
      { command: 'gitlens.views.rebaseOntoCommit', when: 'false' },
      { command: 'gitlens.views.switchToCommit', when: 'false' },
      { command: 'gitlens.views.createBranch', when: 'false' },
      { command: 'gitlens.views.createTag', when: 'false' },
      { command: 'gitlens.views.compareWithHead', when: 'false' },
      { command: 'gitlens.views.selectForCompare', when: 'false' },
      { command: 'gitlens.views.compareWithSelected', when: 'false' },
      { command: 'gitlens.copyShaToClipboard', when: 'false' },
      { command: 'gitlens.copyMessageToClipboard', when: 'false' },
      { command: 'gitlens.openCommitOnRemote', when: 'false' },
      { command: 'gitlens.copyRemoteCommitUrl', when: 'false' },
      { command: 'gitlens.openFileOnRemote', when: 'false' },
      { command: 'gitlens.copyRemoteFileUrlToClipboard', when: 'false' },
      { command: 'gitlens.openFileHistory', when: 'false' },
    ],
  },
}
