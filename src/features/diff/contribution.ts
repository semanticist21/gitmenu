// Diff editor commands: VS Code's selected-range staging and change navigation, the
// inline/side-by-side toggle, and GitLens's file blame toggle.
import type { Contribution } from '@/commands/registry'

const inDiff = 'gitmenuDiffFocus'

export const diffContribution: Contribution = {
  commands: [
    { command: 'git.stageSelectedRanges', title: { vs: 'command.stageSelectedRanges' }, category: { text: 'Git' }, enablement: 'gitmenuDiffCanStage' },
    { command: 'git.unstageSelectedRanges', title: { vs: 'command.unstageSelectedRanges' }, category: { text: 'Git' }, enablement: 'gitmenuDiffCanUnstage' },
    { command: 'git.revertSelectedRanges', title: { vs: 'command.revertSelectedRanges' }, category: { text: 'Git' }, enablement: 'gitmenuDiffCanStage' },
    { command: 'workbench.action.editor.nextChange', title: { app: 'diff.nextChange' } },
    { command: 'workbench.action.editor.previousChange', title: { app: 'diff.previousChange' } },
    { command: 'toggle.diff.renderSideBySide', title: { app: 'diff.inline' } },
    { command: 'gitlens.toggleFileBlame', title: { gl: 'Toggle File Blame' }, category: { text: 'GitLens' } },
  ],
  keybindings: [
    { command: 'git.stageSelectedRanges', key: 'ctrl+k ctrl+alt+s', mac: 'cmd+k cmd+alt+s', when: inDiff },
    { command: 'git.unstageSelectedRanges', key: 'ctrl+k ctrl+n', mac: 'cmd+k cmd+n', when: inDiff },
    { command: 'git.revertSelectedRanges', key: 'ctrl+k ctrl+r', mac: 'cmd+k cmd+r', when: inDiff },
    { command: 'workbench.action.editor.nextChange', key: 'alt+f5', when: inDiff },
    { command: 'workbench.action.editor.previousChange', key: 'shift+alt+f5', when: inDiff },
    { command: 'gitlens.toggleFileBlame', key: 'ctrl+shift+g b', mac: 'cmd+alt+g b', when: 'gitmenu.window == detail' },
  ],
}
