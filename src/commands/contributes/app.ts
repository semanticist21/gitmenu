// gitside's own commands (project tabs, panel, windows). VS Code ids are kept where VS Code
// has the same command (palette, settings, keyboard shortcuts).
import { FolderOpenIcon, PinIcon, SettingsIcon, SquareTerminalIcon } from 'lucide-react'
import type { Contribution } from '../registry'

const category = { text: 'gitside' }

export const appContribution: Contribution = {
  commands: [
    { command: 'workbench.action.showCommands', title: { app: 'panel.commandPalette' } },
    { command: 'workbench.action.openSettings', title: { app: 'panel.settings' }, category, icon: SettingsIcon },
    { command: 'workbench.action.openGlobalKeybindings', title: { app: 'panel.keyboardShortcuts' }, category },
    { command: 'gitside.openProject', title: { app: 'project.open' }, category, icon: FolderOpenIcon },
    { command: 'gitside.closeProject', title: { app: 'project.close' }, category, enablement: 'gitside.hasProject' },
    { command: 'gitside.nextProject', title: { app: 'project.next' }, category, enablement: 'gitside.projectCount > 1' },
    { command: 'gitside.previousProject', title: { app: 'project.previous' }, category, enablement: 'gitside.projectCount > 1' },
    { command: 'gitside.togglePin', title: { app: 'panel.pin' }, category, icon: PinIcon },
    { command: 'gitside.hidePanel', title: { app: 'panel.hide' }, category },
    {
      command: 'gitside.openInTerminal',
      title: { app: 'panel.openInTerminal' },
      category,
      icon: SquareTerminalIcon,
      enablement: 'gitside.hasRepository',
    },
    { command: 'gitside.revealInFinder', title: { app: 'panel.revealInFinder' }, category, enablement: 'gitside.hasProject' },
    { command: 'gitside.quit', title: { app: 'panel.quit' } },
  ],
  menus: {
    commandPalette: [{ command: 'gitside.hidePanel', when: 'false' }],
    'gitside/panel/more': [
      { command: 'workbench.action.showCommands', group: '1_commands' },
      { command: 'workbench.action.openSettings', group: '2_preferences@1' },
      { command: 'workbench.action.openGlobalKeybindings', group: '2_preferences@2' },
      { command: 'gitside.quit', group: '9_quit' },
    ],
    'gitside/project/context': [
      { command: 'gitside.openInTerminal', group: '1_open@1' },
      { command: 'gitside.revealInFinder', group: '1_open@2' },
      { command: 'gitside.closeProject', group: '9_close' },
    ],
  },
  keybindings: [
    { command: 'workbench.action.showCommands', key: 'ctrl+shift+p', mac: 'cmd+shift+p' },
    { command: 'workbench.action.openSettings', key: 'ctrl+,', mac: 'cmd+,' },
    { command: 'workbench.action.openGlobalKeybindings', key: 'ctrl+k ctrl+s', mac: 'cmd+k cmd+s' },
    { command: 'gitside.openProject', key: 'ctrl+o', mac: 'cmd+o' },
    { command: 'gitside.closeProject', key: 'ctrl+w', mac: 'cmd+w', when: 'gitside.window == panel' },
    { command: 'gitside.nextProject', key: 'ctrl+tab', mac: 'cmd+shift+]' },
    { command: 'gitside.previousProject', key: 'ctrl+shift+tab', mac: 'cmd+shift+[' },
    { command: 'gitside.hidePanel', key: 'escape', when: 'gitside.window == panel && !inputFocus && !gitside.overlayOpen' },
    { command: 'gitside.quit', key: 'ctrl+q', mac: 'cmd+q' },
  ],
}
