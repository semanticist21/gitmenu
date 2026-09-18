// Command palette (⌘⇧P): every command the palette allows in the current context.
import { useEffect, useMemo, useState } from 'react'
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from '@/components/ui/command'
import { t, useLocale } from '@/i18n'
import { contextSnapshot, openOverlay } from './context'
import { formatKey, useEffectiveBindings } from './keybindings'
import { executeCommand, paletteCommands, paletteLabel, registerHandler } from './registry'

interface Item {
  id: string
  label: string
  shortcut?: string
}

export function CommandPalette() {
  useLocale()
  const [open, setOpen] = useState(false)
  const bindings = useEffectiveBindings()

  useEffect(() => registerHandler('workbench.action.showCommands', () => setOpen(true)), [])
  useEffect(() => (open ? openOverlay() : undefined), [open])

  const items = useMemo<Item[]>(() => {
    if (!open) return []
    return paletteCommands(contextSnapshot())
      .map((c) => {
        const binding = [...bindings].reverse().find((b) => b.command === c.command)
        return { id: c.command, label: paletteLabel(c.command), shortcut: binding && formatKey(binding.key) }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [open, bindings])

  const run = (id: string) => {
    setOpen(false)
    // Let the dialog close before the command opens anything of its own
    requestAnimationFrame(() => void executeCommand(id))
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandDialogPopup className="max-w-[calc(100vw-1rem)]">
        <Command items={items} itemToStringValue={(item: unknown) => (item as Item).label}>
          <CommandInput placeholder={t('palette.placeholder')} />
          <CommandPanel>
            <CommandEmpty>{t('palette.empty')}</CommandEmpty>
            <CommandList>
              {(item: Item) => (
                <CommandItem key={item.id} value={item} onClick={() => run(item.id)}>
                  <span className="truncate">{item.label}</span>
                  {item.shortcut && <CommandShortcut>{item.shortcut}</CommandShortcut>}
                </CommandItem>
              )}
            </CommandList>
          </CommandPanel>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  )
}
