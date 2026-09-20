// Keyboard Shortcuts tab (VS Code's keybindings editor, keybindingsEditor.css + table.css): a
// search box, then a table with one row per keybinding (Command, Keybinding, When, Source) and
// an edit/add action on the hovered or selected row. Defining a key opens VS Code's "Press
// desired key combination and then press ENTER" widget. Changes are written to
// keybindings.json the way VS Code writes them: a new entry for the new key, and a `-command`
// entry that removes the default it replaces.
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual'
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { formatKey, keybindingsQuery, type EffectiveBinding, normalizeKey, type UserKeybinding, useEffectiveBindings } from '@/commands/keybindings'
import { allCommands, paletteLabel } from '@/commands/registry'
import { Icon } from '@/components/Icon'
import { ContextMenu, ContextMenuItem, ContextMenuPopup, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Keybinding } from '@/components/ui/kbd'
import { toastManager } from '@/components/ui/toast'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { t, useLocale } from '@/i18n'
import { errorMessage, ipc } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { ActionButton, EditorActions } from '@/routes/detail/EditorChrome'

// KeyboardEvent.code → the key names keybindings.json uses
const CODE_NAMES: Record<string, string> = {
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
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Insert: 'insert',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
}
const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift'])

// keybindingsEditor.ts `Delegate`: a 30px header row, 24px rows, 40px when the search matched
// the command id and the row shows it on a second line
const HEADER_HEIGHT = 30
const ROW = 24
const ID_ROW = 40

/** One chord from a keydown (`cmd+shift+k`); a lone modifier gives an incomplete chord (`cmd+`). */
function chordOf(event: globalThis.KeyboardEvent): { chord: string; complete: boolean } {
  const mods = [event.ctrlKey && 'ctrl', event.shiftKey && 'shift', event.altKey && 'alt', event.metaKey && 'cmd'].filter(Boolean) as string[]
  if (MODIFIER_KEYS.has(event.key)) return { chord: `${mods.join('+')}+`, complete: false }
  const code = event.code
  const key =
    CODE_NAMES[code] ??
    (/^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : /^Digit\d$/.test(code) ? code.slice(5) : /^Numpad/.test(code) ? code.toLowerCase() : /^F\d+$/.test(code) ? code.toLowerCase() : event.key.toLowerCase())
  return { chord: normalizeKey([...mods, key].join('+')), complete: true }
}

async function save(bindings: UserKeybinding[]) {
  try {
    await ipc.keybindingsSet(bindings)
  } catch (e) {
    toastManager.add({ type: 'error', title: errorMessage(e) })
  }
}

interface Row {
  id: string
  command: string
  label: string
  binding: EffectiveBinding | null
}

/**
 * VS Code's DefineKeybindingWidget: a 400px box in the middle of the editor with the message,
 * an input that records up to two chords, the keybinding as key caps, and how many commands
 * already use it. Enter accepts, Escape clears (then cancels), leaving the input cancels.
 */
function DefineKeybindingWidget({ existing, onAccept, onCancel, onShowExisting }: { existing: (key: string) => number; onAccept: (key: string) => void; onCancel: () => void; onShowExisting: (key: string) => void }) {
  const [chords, setChords] = useState<{ chord: string; complete: boolean }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [])
  const key = chords.every((c) => c.complete) ? chords.map((c) => c.chord).join(' ') : ''
  const count = key ? existing(key) : 0

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Nothing reaches the window's shortcuts while recording
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      if (key) onAccept(key)
      else onCancel()
      return
    }
    if (event.key === 'Escape') {
      if (chords.length) setChords([])
      else onCancel()
      return
    }
    const next = chordOf(event.nativeEvent)
    setChords((current) => {
      const last = current[current.length - 1]
      if (last && !last.complete) return [...current.slice(0, -1), next]
      return current.length === 2 ? [next] : [...current, next]
    })
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="w-[420px] max-w-[calc(100%-16px)] rounded-menu border border-editor-widget-border bg-editor-widget p-2.5 text-editor-widget-foreground shadow-widget">
        <div className="text-center">Press desired key combination and then press ENTER.</div>
        <input
          ref={inputRef}
          readOnly
          aria-label="Press desired key combination and then press ENTER."
          value={chords.map((c) => c.chord).join(' ')}
          className="mt-2.5 block h-control w-full rounded-control border border-input-border bg-input-background px-1.5 text-center text-input-foreground outline-none focus:outline-solid focus:outline-1 focus:-outline-offset-1 focus:outline-focus"
          onKeyDown={onKeyDown}
          onBlur={onCancel}
        />
        <div className="mt-2.5 flex min-h-[18px] items-center justify-center gap-1">
          {chords.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span>chord to</span>}
              <Keybinding value={formatKey(c.chord.replace(/\+$/, ''))} className="mx-1" />
            </span>
          ))}
        </div>
        <div className="mt-2.5 min-h-[18px] text-center">
          {count > 0 && (
            <button
              type="button"
              className="cursor-pointer text-inherit underline"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onShowExisting(key)}
            >
              {count === 1 ? '1 existing command has this keybinding' : `${count} existing commands have this keybinding`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Bold highlight of the search term (list.highlightForeground). */
function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query) : -1
  if (at === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <span className="font-bold text-list-highlight in-data-selected:text-inherit">{text.slice(at, at + query.length)}</span>
      {text.slice(at + query.length)}
    </>
  )
}

export function KeybindingsTab() {
  useLocale()
  const bindings = useEffectiveBindings()
  const { data: user = [] } = useQuery(keybindingsQuery)
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<Row | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  // One row per keybinding, plus one for each command without any (VS Code's model)
  const rows = useMemo<Row[]>(() => {
    const result: Row[] = []
    for (const command of allCommands()) {
      const label = paletteLabel(command.command)
      const own = bindings.filter((b) => b.command === command.command)
      if (own.length === 0) result.push({ id: command.command, command: command.command, label, binding: null })
      own.forEach((binding, i) => result.push({ id: `${command.command}#${i}`, command: command.command, label, binding }))
    }
    // Bound commands first, then alphabetically
    return result.sort((a, b) => Number(!a.binding) - Number(!b.binding) || a.label.localeCompare(b.label))
  }, [bindings])

  const raw = query.trim()
  const quoted = /^".*"$/.test(raw) ? normalizeKey(raw.slice(1, -1)) : null
  const q = raw.toLowerCase()
  const visible = useMemo(
    () =>
      rows.filter((r) => {
        if (quoted !== null) return r.binding?.key === quoted
        return (
          !q ||
          r.label.toLowerCase().includes(q) ||
          r.command.toLowerCase().includes(q) ||
          (r.binding && (r.binding.key.includes(q) || formatKey(r.binding.key).toLowerCase().includes(q) || r.binding.when?.toLowerCase().includes(q)))
        )
      }),
    [rows, q, quoted],
  )
  /** The search matched the command id, so the row shows it under the label and is taller. */
  const showsId = (row: Row) => Boolean(q) && quoted === null && row.command.toLowerCase().includes(q)

  // The table is virtualized like VS Code's (a WorkbenchTable), so the command list can grow
  // without every row — and every row's context menu — being mounted at once
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => tableRef.current,
    estimateSize: (index) => (showsId(visible[index]) ? ID_ROW : ROW),
    overscan: 12,
    scrollMargin: HEADER_HEIGHT,
  })
  // Row heights depend on the search, which `count` alone does not tell the virtualizer
  useEffect(() => {
    virtualizer.measure()
  }, [q, quoted, virtualizer])

  const setKey = async (row: Row, key: string) => {
    const binding = row.binding
    let next = user
    if (binding?.source === 'user') {
      next = user.filter((u) => !(u.command === row.command && normalizeKey(u.key) === binding.key && u.when === binding.when))
    } else if (binding) {
      next = [...user, { key: binding.key, command: `-${row.command}`, ...(binding.when ? { when: binding.when } : {}) }]
    }
    await save([...next, { key, command: row.command, ...(binding?.when ? { when: binding.when } : {}) }])
    setEditing(null)
  }

  const remove = async (row: Row) => {
    const binding = row.binding
    if (!binding) return
    if (binding.source === 'user') {
      await save(user.filter((u) => !(u.command === row.command && normalizeKey(u.key) === binding.key && u.when === binding.when)))
    } else {
      await save([...user, { key: binding.key, command: `-${row.command}`, ...(binding.when ? { when: binding.when } : {}) }])
    }
  }

  const reset = async (command: string) => save(user.filter((u) => u.command !== command && u.command !== `-${command}`))

  const onTableKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = visible.findIndex((r) => r.id === selected)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const at = Math.min(visible.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))
      const next = visible[at]
      if (!next) return
      setSelected(next.id)
      virtualizer.scrollToIndex(at, { align: 'auto' })
    } else if (event.key === 'Enter' && index >= 0) {
      event.preventDefault()
      setEditing(visible[index])
    }
  }

  // Column weights (keybindingsEditor.ts): actions 40px, then .3 / .2 / .35 / .15 of the rest
  const column = (weight: number) => ({ flex: `${weight} 1 0%` })
  const columnBorder =
    'border-l border-transparent group-hover/table:border-table-column-border transition-[border-color] duration-columns ease-columns motion-reduce:transition-none'
  const cell = cn('flex min-w-0 items-center overflow-hidden ps-2.5', columnBorder)

  const header = (
    <div role="row" className="sticky top-0 z-10 flex h-[30px] bg-editor font-semibold">
      <div className="flex h-full w-full bg-table-odd-row">
        <div role="columnheader" className="w-10 shrink-0" />
        <div role="columnheader" className={cell} style={column(0.3)}>
          <span className="truncate">{t('keys.command')}</span>
        </div>
        <div role="columnheader" className={cell} style={column(0.2)}>
          <span className="truncate">{t('keys.keybinding')}</span>
        </div>
        <div role="columnheader" className={cell} style={column(0.35)}>
          <span className="truncate">{t('keys.when')}</span>
        </div>
        <div role="columnheader" className={cell} style={column(0.15)}>
          <span className="truncate">{t('keys.source')}</span>
        </div>
      </div>
    </div>
  )

  const renderRow = (row: Row, item: VirtualItem): ReactNode => {
    const isSelected = row.id === selected
    const customized = user.some((u) => u.command === row.command || u.command === `-${row.command}`)
    const idMatched = showsId(row)
    const binding = row.binding
    return (
      <ContextMenu key={row.id}>
        <ContextMenuTrigger
          render={
            <div
              role="row"
              data-row={row.id}
              data-selected={isSelected || undefined}
              aria-rowindex={item.index + 1}
              aria-selected={isSelected}
              className={cn(
                'group/row absolute inset-x-0 top-0 flex cursor-default',
                isSelected
                  ? 'bg-list-inactive group-focus/table:bg-list-active group-focus/table:text-list-active-foreground group-focus/table:outline-solid group-focus/table:outline-1 group-focus/table:-outline-offset-1 group-focus/table:outline-list-selection-outline'
                  : cn('hover:bg-list-hover', item.index % 2 === 1 && 'bg-table-odd-row'),
              )}
              style={{ height: idMatched ? ID_ROW : ROW, transform: `translateY(${item.start - HEADER_HEIGHT}px)` }}
              onClick={() => setSelected(row.id)}
              onDoubleClick={() => setEditing(row)}
            />
          }
        >
          <div className="flex w-10 shrink-0 items-center justify-center">
            <span className={cn('hidden group-hover/row:flex', isSelected && 'flex')}>
              <ActionButton
                small
                icon={binding ? 'edit' : 'add'}
                label={binding ? t('keys.change') : 'Add Keybinding'}
                onClick={(e) => {
                  e.stopPropagation()
                  setEditing(row)
                }}
              />
            </span>
          </div>
          <div className={cn(cell, 'flex-col items-start justify-center')} style={column(0.3)} title={`${row.label} (${row.command})`}>
            <span className="max-w-full truncate">
              <Highlight text={row.label} query={quoted === null ? q : ''} />
            </span>
            {idMatched && (
              <span className="mt-0.5 max-w-full truncate font-mono text-[90%]">
                <Highlight text={row.command} query={q} />
              </span>
            )}
          </div>
          <div className={cell} style={column(0.2)}>
            {binding && <Keybinding value={formatKey(binding.key)} />}
          </div>
          <div className={cell} style={column(0.35)} title={binding?.when}>
            {binding?.when ? <span className="truncate font-mono text-[90%]">{binding.when}</span> : <span className="ps-1">-</span>}
          </div>
          <div className={cell} style={column(0.15)}>
            <span className="truncate">{binding ? (binding.source === 'user' ? t('keys.user') : t('keys.default')) : '-'}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuPopup>
          <ContextMenuItem onClick={() => void ipc.clipboardWrite(row.command)}>Copy Command ID</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => setEditing(row)}>{binding ? `${t('keys.change')}...` : 'Add Keybinding...'}</ContextMenuItem>
          {binding && <ContextMenuItem onClick={() => void remove(row)}>{t('keys.remove')}</ContextMenuItem>}
          <ContextMenuItem disabled={!customized} onClick={() => void reset(row.command)}>
            {t('keys.reset')}
          </ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenu>
    )
  }

  return (
    <div className="relative flex h-full flex-col ps-[27px] pt-[11px]">
      <EditorActions>
        <ActionButton icon="go-to-file" label={t('keys.openJson')} onClick={() => void ipc.settingsFilePaths().then(([, keys]) => ipc.openPath(keys))} />
      </EditorActions>
      <div className="shrink-0 pe-2.5 pb-[11px]">
        <InputGroup>
          <InputGroupInput
            placeholder={recording ? 'Recording Keys. Press Escape to exit' : t('keys.search')}
            value={query}
            onChange={(e) => !recording && setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (!recording) return
              // Recording: keys become a quoted keybinding search; Escape stops recording
              e.preventDefault()
              e.stopPropagation()
              if (e.key === 'Escape') setRecording(false)
              else if (!MODIFIER_KEYS.has(e.key)) setQuery(`"${chordOf(e.nativeEvent).chord}"`)
            }}
            aria-label={t('keys.search')}
          />
          <InputGroupAddon align="inline-end">
            {recording && (
              <span className="me-2 rounded-xs bg-badge px-[3px] py-0.5 text-badge-foreground text-caption leading-none">Recording Keys</span>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Record Keys"
                    aria-pressed={recording}
                    className="flex size-5 cursor-pointer items-center justify-center rounded-inset border border-transparent text-inherit hover:bg-input-option-hover aria-pressed:border-input-option-active-border aria-pressed:bg-input-option-active aria-pressed:text-input-option-active-foreground"
                    onClick={() => setRecording(!recording)}
                  />
                }
              >
                <Icon name="record-keys" />
              </TooltipTrigger>
              <TooltipPopup>Record Keys</TooltipPopup>
            </Tooltip>
            <button
              type="button"
              aria-label="Clear Keybindings Search Input"
              disabled={!query}
              className="flex size-5 cursor-pointer items-center justify-center rounded-inset text-inherit hover:bg-input-option-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
              onClick={() => setQuery('')}
            >
              <Icon name="clear-all" />
            </button>
          </InputGroupAddon>
        </InputGroup>
      </div>
      <div
        ref={tableRef}
        role="grid"
        tabIndex={0}
        aria-label={t('detail.keybindings')}
        // Only the rows on screen are in the grid, so the real count is an attribute, the way
        // the Commit Graph's virtualized grid states it
        aria-rowcount={visible.length}
        className="group/table min-h-0 flex-1 overflow-y-auto overflow-x-hidden whitespace-nowrap outline-none"
        onKeyDown={onTableKeyDown}
      >
        {header}
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => renderRow(visible[item.index], item))}
        </div>
      </div>
      {editing && (
        <DefineKeybindingWidget
          existing={(key) => bindings.filter((b) => b.key === key).length}
          onAccept={(key) => void setKey(editing, key)}
          onCancel={() => setEditing(null)}
          onShowExisting={(key) => {
            setQuery(`"${key}"`)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
