// gitmenu's own commands (project tabs, panel, windows). VS Code ids are kept where VS Code
// has the same command (palette, settings, keyboard shortcuts).
import type { Contribution } from '../registry'

const category = { text: 'gitmenu' }

export const appContribution: Contribution = {
  commands: [
    { command: 'workbench.action.showAboutDialog', title: { app: 'panel.about' } },
    { command: 'workbench.action.showCommands', title: { app: 'panel.commandPalette' } },
    { command: 'workbench.action.quickOpen', title: { app: 'project.quickOpen' }, category },
    { command: 'workbench.action.openSettings', title: { app: 'panel.settings' }, category, icon: 'settings-gear' },
    { command: 'workbench.action.openGlobalKeybindings', title: { app: 'panel.keyboardShortcuts' }, category },
    { command: 'workbench.action.closeActiveEditor', title: { vsb: 'Close Editor' } },
    { command: 'gitmenu.openProject', title: { app: 'project.open' }, category, icon: 'folder-opened' },
    { command: 'gitmenu.closeProject', title: { app: 'project.close' }, category, enablement: 'gitmenu.hasProject' },
    { command: 'gitmenu.nextProject', title: { app: 'project.next' }, category, enablement: 'gitmenu.projectCount > 1' },
    { command: 'gitmenu.previousProject', title: { app: 'project.previous' }, category, enablement: 'gitmenu.projectCount > 1' },
    { command: 'gitmenu.togglePin', title: { app: 'panel.pin' }, category, icon: 'pin' },
    { command: 'gitmenu.hidePanel', title: { app: 'panel.hide' }, category },
    { command: 'gitmenu.toggleDetach', title: { app: 'panel.detach' }, category, icon: 'empty-window' },
    {
      command: 'gitmenu.openInTerminal',
      title: { app: 'panel.openInTerminal' },
      category,
      icon: 'terminal',
      enablement: 'gitmenu.hasRepository',
    },
    { command: 'gitmenu.revealInFinder', title: { app: 'panel.revealInFinder' }, category, enablement: 'gitmenu.hasProject' },
    { command: 'update.checkForUpdates', title: { app: 'update.check' }, category },
    { command: 'gitmenu.quit', title: { app: 'panel.quit' } },
  ],
  menus: {
    commandPalette: [
      { command: 'gitmenu.hidePanel', when: 'false' },
      { command: 'workbench.action.closeActiveEditor', when: 'gitmenu.window == detail' },
    ],
    'gitmenu/panel/more': [
      { command: 'workbench.action.showAboutDialog', group: '0_about' },
      { command: 'workbench.action.showCommands', group: '1_commands' },
      { command: 'gitmenu.toggleDetach', group: '1_commands@2' },
      { command: 'workbench.action.openSettings', group: '2_preferences@1' },
      { command: 'workbench.action.openGlobalKeybindings', group: '2_preferences@2' },
      { command: 'update.checkForUpdates', group: '3_update' },
      { command: 'gitmenu.quit', group: '9_quit' },
    ],
    'gitmenu/project/context': [
      { command: 'gitmenu.openInTerminal', group: '1_open@1' },
      { command: 'gitmenu.revealInFinder', group: '1_open@2' },
      { command: 'gitmenu.closeProject', group: '9_close' },
    ],
  },
  keybindings: [
    { command: 'workbench.action.showCommands', key: 'ctrl+shift+p', mac: 'cmd+shift+p' },
    { command: 'workbench.action.quickOpen', key: 'ctrl+p', mac: 'cmd+p' },
    { command: 'workbench.action.openSettings', key: 'ctrl+,', mac: 'cmd+,' },
    { command: 'workbench.action.openGlobalKeybindings', key: 'ctrl+k ctrl+s', mac: 'cmd+k cmd+s' },
    { command: 'gitmenu.openProject', key: 'ctrl+o', mac: 'cmd+o' },
    { command: 'gitmenu.closeProject', key: 'ctrl+w', mac: 'cmd+w', when: 'gitmenu.window == panel' },
    { command: 'workbench.action.closeActiveEditor', key: 'ctrl+w', mac: 'cmd+w', when: 'gitmenu.window == detail' },
    { command: 'gitmenu.nextProject', key: 'ctrl+tab', mac: 'cmd+shift+]' },
    { command: 'gitmenu.previousProject', key: 'ctrl+shift+tab', mac: 'cmd+shift+[' },
    { command: 'gitmenu.hidePanel', key: 'escape', when: 'gitmenu.window == panel && !inputFocus && !gitmenu.overlayOpen' },
    { command: 'gitmenu.quit', key: 'ctrl+q', mac: 'cmd+q' },
  ],
}
