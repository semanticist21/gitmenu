// Command palette (⌘⇧P): every command the palette allows in the current context, in VS Code's
// quick input widget (22px rows, bold matches, key caps on the right).
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  QuickInputLabel,
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
  const [query, setQuery] = useState('')
  const bindings = useEffectiveBindings()
  // Where the keyboard was, to go back to when the palette closes (a terminal's hidden input
  // isn't found otherwise, and the keys would reach nothing)
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(
    () =>
      registerHandler('workbench.action.showCommands', () => {
        const focused = document.activeElement
        returnFocus.current = focused instanceof HTMLElement && focused !== document.body ? focused : null
        setQuery('')
        setOpen(true)
      }),
    [],
  )
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
    // Let the widget close before the command opens anything of its own
    requestAnimationFrame(() => void executeCommand(id))
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandDialogPopup aria-label={t('palette.placeholder')} finalFocus={returnFocus}>
        <Command
          items={items}
          value={query}
          onValueChange={(value) => setQuery(value)}
          itemToStringValue={(item: unknown) => (item as Item).label}
        >
          <CommandInput placeholder={t('palette.placeholder')} aria-label={t('palette.placeholder')} />
          <CommandEmpty>{t('palette.empty')}</CommandEmpty>
          <CommandList>
            {(item: Item) => (
              <CommandItem key={item.id} value={item} onClick={() => run(item.id)}>
                <QuickInputLabel label={item.label} query={query} />
                {item.shortcut && <CommandShortcut>{item.shortcut}</CommandShortcut>}
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  )
}
