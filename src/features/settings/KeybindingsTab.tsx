// Keyboard Shortcuts tab (VS Code's): every command with its keybinding, `when` and source.
// Changes are written to keybindings.json the way VS Code writes them: a new entry for the
// new key, and a `-command` entry that removes the default it replaces.
import { useHotkeyRecorder } from '@tanstack/react-hotkeys'
import { useQuery } from '@tanstack/react-query'
import { FileJsonIcon, PencilIcon, RotateCcwIcon, SearchIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { formatKey, keybindingsQuery, normalizeKey, type UserKeybinding, useEffectiveBindings } from '@/commands/keybindings'
import { allCommands, paletteLabel } from '@/commands/registry'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { toastManager } from '@/components/ui/toast'
import { t, useLocale } from '@/i18n'
import { errorMessage, ipc } from '@/lib/ipc'

/** TanStack's recorded `Meta+Shift+K` → VS Code's `cmd+shift+k`. */
function toVscodeKey(hotkey: string): string {
  const names: Record<string, string> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    Enter: 'enter',
    Escape: 'escape',
    Space: 'space',
    Tab: 'tab',
    Backspace: 'backspace',
    Delete: 'delete',
    PageUp: 'pageup',
    PageDown: 'pagedown',
  }
  const parts = hotkey.split('+')
  const key = parts.pop() ?? ''
  const mods = parts.map((p) => ({ Mod: 'cmd', Meta: 'cmd', Command: 'cmd', Cmd: 'cmd', Control: 'ctrl', Ctrl: 'ctrl', Alt: 'alt', Option: 'alt', Shift: 'shift' })[p] ?? p.toLowerCase())
  return normalizeKey([...mods, names[key] ?? key.toLowerCase()].join('+'))
}

async function save(bindings: UserKeybinding[]) {
  try {
    await ipc.keybindingsSet(bindings)
  } catch (e) {
    toastManager.add({ type: 'error', title: errorMessage(e) })
  }
}

function RecordDialog({ command, onClose, onSave }: { command: string; onClose: () => void; onSave: (key: string) => void }) {
  useLocale()
  const [recorded, setRecorded] = useState<string | null>(null)
  const recorder = useHotkeyRecorder({ onRecord: (hotkey) => setRecorded(toVscodeKey(String(hotkey))), onCancel: onClose })
  if (!recorder.isRecording && recorded === null) recorder.startRecording()
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{paletteLabel(command)}</DialogTitle>
          <DialogDescription>{t('keys.pressKeys')}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex justify-center py-4">
          <Kbd className="text-base">{recorded ? formatKey(recorded) : recorder.recordedHotkey ? formatKey(toVscodeKey(String(recorder.recordedHotkey))) : '…'}</Kbd>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('prompt.cancel')}
          </Button>
          <Button disabled={!recorded} onClick={() => recorded && onSave(recorded)}>
            {t('prompt.save')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}

export function KeybindingsTab() {
  useLocale()
  const bindings = useEffectiveBindings()
  const { data: user = [] } = useQuery(keybindingsQuery)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

  const rows = allCommands()
    .map((c) => ({ command: c.command, label: paletteLabel(c.command), bindings: bindings.filter((b) => b.command === c.command) }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const q = query.trim().toLowerCase()
  const visible = rows.filter(
    (r) => !q || r.label.toLowerCase().includes(q) || r.command.toLowerCase().includes(q) || r.bindings.some((b) => b.key.includes(q) || formatKey(b.key).toLowerCase().includes(q)),
  )

  const setKey = async (command: string, key: string) => {
    const defaults = bindings.filter((b) => b.command === command && b.source === 'default')
    const kept = user.filter((u) => u.command !== command && u.command !== `-${command}`)
    const removals = defaults.map((d) => ({ key: d.key, command: `-${command}`, ...(d.when ? { when: d.when } : {}) }))
    const when = defaults[0]?.when
    await save([...kept, ...removals, { key, command, ...(when ? { when } : {}) }])
    setEditing(null)
  }

  const remove = async (command: string) => {
    const defaults = bindings.filter((b) => b.command === command && b.source === 'default')
    const kept = user.filter((u) => u.command !== command && u.command !== `-${command}`)
    await save([...kept, ...defaults.map((d) => ({ key: d.key, command: `-${command}`, ...(d.when ? { when: d.when } : {}) }))])
  }

  const reset = async (command: string) => save(user.filter((u) => u.command !== command && u.command !== `-${command}`))

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <InputGroup className="max-w-md flex-1">
          <InputGroupInput placeholder={t('keys.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('keys.search')} />
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
        </InputGroup>
        <Button size="sm" variant="ghost" onClick={() => void ipc.settingsFilePaths().then(([, keys]) => ipc.openPath(keys))}>
          <FileJsonIcon />
          {t('keys.openJson')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-background text-muted-foreground text-xs">
            <tr className="border-b text-start">
              <th className="px-4 py-1.5 text-start font-medium">{t('keys.command')}</th>
              <th className="px-2 py-1.5 text-start font-medium">{t('keys.keybinding')}</th>
              <th className="px-2 py-1.5 text-start font-medium">{t('keys.when')}</th>
              <th className="px-2 py-1.5 text-start font-medium">{t('keys.source')}</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const customized = user.some((u) => u.command === row.command || u.command === `-${row.command}`)
              return (
                <tr key={row.command} className="group border-b border-border/50 hover:bg-accent/40">
                  <td className="px-4 py-1.5">
                    <div>{row.label}</div>
                    <div className="text-muted-foreground text-xs">{row.command}</div>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {row.bindings.map((b) => (
                        <Kbd key={b.key + (b.when ?? '')}>{formatKey(b.key)}</Kbd>
                      ))}
                    </div>
                  </td>
                  <td className="max-w-64 truncate px-2 py-1.5 font-mono text-muted-foreground text-xs" title={row.bindings.map((b) => b.when).filter(Boolean).join('\n')}>
                    {row.bindings[0]?.when ?? ''}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground text-xs">
                    {row.bindings.length ? (row.bindings.some((b) => b.source === 'user') ? t('keys.user') : t('keys.default')) : ''}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex justify-end gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                      <Button size="icon-xs" variant="ghost" aria-label={t('keys.change')} title={t('keys.change')} onClick={() => setEditing(row.command)}>
                        <PencilIcon />
                      </Button>
                      {row.bindings.length > 0 && (
                        <Button size="icon-xs" variant="ghost" aria-label={t('keys.remove')} title={t('keys.remove')} onClick={() => void remove(row.command)}>
                          <XIcon />
                        </Button>
                      )}
                      {customized && (
                        <Button size="icon-xs" variant="ghost" aria-label={t('keys.reset')} title={t('keys.reset')} onClick={() => void reset(row.command)}>
                          <RotateCcwIcon />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {editing && <RecordDialog command={editing} onClose={() => setEditing(null)} onSave={(key) => void setKey(editing, key)} />}
    </div>
  )
}
