// The Settings tab (VS Code's settings editor, settingsEditor2.css): a search box, the User
// scope tab, a table of contents, and one row per setting from configuration.json with a bold
// "Category: Title", its description, and the control (checkbox, select, text box). Rows
// that differ from the default carry the modified bar; the gear resets them. settings.json
// stays the source of truth; edits there show up here at once.
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import configuration from '@/commands/configuration.json'
import { Icon } from '@/components/Icon'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { Textarea } from '@/components/ui/textarea'
import { toastManager } from '@/components/ui/toast'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { t, useLocale, vs } from '@/i18n'
import type { AppKey } from '@/i18n/app/en'
import { errorMessage, ipc, type LoginItem } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { ActionButton, EditorActions, NativeSelect } from '@/routes/detail/EditorChrome'
import { setSetting, settingDefault, useSettings } from '@/settings/settings'

interface Schema {
  type: string | string[]
  enum?: (string | boolean)[]
  default: unknown
}

const schemas = configuration as Record<string, Schema>

const SECTIONS: { title: AppKey; match: (key: string) => boolean }[] = [
  { title: 'settings.section.general', match: (k) => (k.startsWith('gitmenu.') && !k.startsWith('gitmenu.ai.')) || k.startsWith('update.') },
  { title: 'settings.section.ai', match: (k) => k.startsWith('gitmenu.ai.') },
  { title: 'settings.section.git', match: (k) => k.startsWith('git.') },
  { title: 'settings.section.diff', match: (k) => k.startsWith('diffEditor.') || k.startsWith('editor.') },
  { title: 'settings.section.scm', match: (k) => k.startsWith('scm.') },
]

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
  'zh-cn': '简体中文',
  'zh-tw': '繁體中文',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  'pt-br': 'Português (Brasil)',
  ru: 'Русский',
}

// preferences.ts wordifyKey: `git.enableSmartCommit` → "Git › Enable Smart Commit"
const ACRONYMS = new Set(['css', 'html', 'scss', 'less', 'json', 'js', 'ts', 'ie', 'id', 'php', 'scm'])
function wordify(key: string) {
  return key
    .replace(/\.([a-z0-9])/g, (_, c: string) => ` › ${c.toUpperCase()}`)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]{1,})([A-Z][a-z])/g, '$1 $2')
    .replace(/^[a-z]/g, (c) => c.toUpperCase())
    .replace(/\b\w+\b/g, (word) => (ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word))
    .replace(/\bgithub\b/gi, 'GitHub')
}

/** settingKeyToDisplayFormat: the category (everything before the last segment) and the label. */
function displayName(key: string) {
  const dot = key.lastIndexOf('.')
  return { category: dot === -1 ? '' : wordify(key.slice(0, dot)), label: wordify(key.slice(dot + 1)) }
}

function descriptionOf(key: string): string {
  if (key.startsWith('git.')) return vs(`config.${key.slice(4)}`)
  return t(`setting.${key}` as AppKey)
}

function optionLabel(key: string, value: string | boolean): string {
  if (key === 'gitmenu.language') return value === 'auto' ? t('settings.systemLanguage') : LANGUAGE_NAMES[String(value)]
  if (key === 'gitmenu.theme.mode') return t(`settings.theme.${value}` as AppKey)
  return String(value)
}

const rowId = (key: string) => `setting-${key.replace(/\./g, '-')}`

/**
 * Setting descriptions are markdown: `code`, `#setting.id#` links (shown as "Category: Title"),
 * **bold** and [links](…).
 */
function Markdown({ text, onReveal }: { text: string; onReveal: (key: string) => void }) {
  const parts: ReactNode[] = []
  const pattern = /`#([\w.-]+)#`|#([\w.-]+)#|`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\([^)]*\)/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const setting = match[1] ?? match[2]
    if (setting) {
      const name = displayName(setting)
      parts.push(
        <a
          key={match.index}
          href={`#${rowId(setting)}`}
          className="text-link hover:text-link-active hover:underline"
          onClick={(e) => {
            e.preventDefault()
            onReveal(setting)
          }}
        >
          {name.category ? `${name.category}: ${name.label}` : name.label}
        </a>,
      )
    } else if (match[3]) {
      parts.push(
        <code
          key={match.index}
          className="rounded-control bg-preformat px-[3px] py-px font-mono text-preformat-foreground text-caption leading-[15px]"
        >
          {match[3]}
        </code>,
      )
    } else if (match[4]) {
      parts.push(<strong key={match.index}>{match[4]}</strong>)
    } else {
      parts.push(
        <span key={match.index} className="text-link">
          {match[5]}
        </span>,
      )
    }
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function Control({ name, schema, value }: { name: string; schema: Schema; value: unknown }) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const save = (next: unknown) => void setSetting(name, next).catch((e) => toastManager.add({ type: 'error', title: errorMessage(e) }))
  const terminals = useQuery({ queryKey: ['terminalApps'], queryFn: ipc.terminalApps, enabled: name === 'gitmenu.terminal.app' })
  const { label } = displayName(name)

  if (name === 'gitmenu.terminal.app') {
    const options = [...new Set([...(terminals.data ?? []), String(value)])]
    return <NativeSelect aria-label={label} className="w-80 max-w-full" value={String(value)} options={options.map((o) => ({ value: o, label: o }))} onChange={save} />
  }
  if (schema.enum) {
    return (
      <NativeSelect
        aria-label={label}
        className="w-80 max-w-full"
        value={JSON.stringify(value)}
        options={schema.enum.map((o) => ({ value: JSON.stringify(o), label: optionLabel(name, o) }))}
        onChange={(v) => save(JSON.parse(v))}
      />
    )
  }
  if (types.includes('number')) {
    return (
      <Input
        type="number"
        aria-label={label}
        className="w-[200px] max-w-full [&_input::-webkit-inner-spin-button]:appearance-none"
        defaultValue={value == null ? '' : String(value)}
        onBlur={(e) => save(e.target.value === '' ? null : Number(e.target.value))}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    )
  }
  if (name === 'gitmenu.ai.commitMessage.customInstructions') {
    return <Textarea aria-label={label} className="w-[420px] max-w-full" rows={3} defaultValue={String(value ?? '')} onBlur={(e) => save(e.target.value)} />
  }
  if (types.includes('string')) {
    return (
      <Input
        aria-label={label}
        className="w-[420px] max-w-full"
        defaultValue={value == null ? '' : String(value)}
        onBlur={(e) => save(e.target.value === '' ? null : e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    )
  }
  // Arrays and objects are edited in settings.json, through VS Code's link
  return (
    <button
      type="button"
      className="cursor-pointer text-link opacity-90 hover:text-link-active hover:underline"
      onClick={() => void ipc.settingsFilePaths().then(([settings]) => ipc.openPath(settings))}
    >
      {t('settings.editInJson')}
    </button>
  )
}

/** One setting row (settingsTree.ts): modified bar, gear, "Category: Title", description, control. */
function SettingRow({
  id,
  category,
  label,
  description,
  modified,
  bool,
  children,
  onReset,
}: {
  id?: string
  category: string
  label: string
  description: ReactNode
  modified: boolean
  /** Booleans put the checkbox in front of the description */
  bool?: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }
  children?: ReactNode
  onReset?: () => void
}) {
  return (
    <div
      id={id}
      className={cn(
        'group/setting relative px-3.5 pt-3 leading-ui hover:bg-settings-row-hover has-focus-visible:bg-settings-row-focus has-focus-visible:outline-solid has-focus-visible:outline-1 has-focus-visible:-outline-offset-1 has-focus-visible:outline-focus',
        bool ? 'pb-[26px]' : 'pb-[18px]',
      )}
    >
      {modified && (
        <span className={cn('absolute left-[5px] top-[15px] w-1.5 border-settings-modified border-l-2', bool ? 'bottom-[23px]' : 'bottom-[18px]')} />
      )}
      {onReset && (
        <div className="absolute top-2 left-[-22px] opacity-0 transition-opacity duration-300 group-focus-within/setting:opacity-100 group-hover/setting:opacity-100 has-data-popup-open:opacity-100 motion-reduce:transition-none">
          <Menu>
            <Tooltip>
              <TooltipTrigger render={<MenuTrigger render={<button type="button" aria-label={t('settings.reset')} className="flex size-action cursor-pointer items-center justify-center rounded-action text-inherit hover:bg-toolbar-hover" />} />}>
                <Icon name="gear" />
              </TooltipTrigger>
              <TooltipPopup>{t('settings.reset')}</TooltipPopup>
            </Tooltip>
            <MenuPopup>
              <MenuItem disabled={!modified} onClick={onReset}>
                {t('settings.reset')}
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      )}
      <div className="inline-block max-w-full truncate pb-0.5 align-top font-semibold">
        {category && <span className="select-text opacity-90">{category}: </span>}
        <span className="me-[7px] select-text text-settings-header-foreground">{label}</span>
      </div>
      {bool ? (
        <label className={cn('flex', bool.disabled ? 'cursor-default' : 'cursor-pointer')}>
          <Checkbox className="me-[9px] mt-px" checked={bool.checked} disabled={bool.disabled} onCheckedChange={(v) => bool.onChange(v === true)} />
          <span className="-mt-px min-w-0 select-text opacity-90">{description}</span>
        </label>
      ) : (
        <>
          <div className="-mt-px select-text opacity-90">{description}</div>
          <div className="mt-[9px] flex">{children}</div>
        </>
      )}
    </div>
  )
}

function LoginItemSetting() {
  useLocale()
  const status = useQuery({ queryKey: ['loginItem'], queryFn: ipc.loginItemStatus })
  const set = async (enabled: boolean) => {
    try {
      const next: LoginItem = await ipc.loginItemSet(enabled)
      if (next === 'requiresApproval') toastManager.add({ type: 'info', title: t('login.requiresApproval') })
    } catch (e) {
      toastManager.add({ type: 'error', title: errorMessage(e) })
    }
    void status.refetch()
  }
  return (
    <SettingRow
      category={wordify('gitmenu')}
      label={t('settings.openAtLogin')}
      description={status.data === 'unavailable' ? t('settings.openAtLoginUnavailable') : t('settings.openAtLoginDescription')}
      modified={false}
      bool={{
        checked: status.data === 'enabled' || status.data === 'requiresApproval',
        disabled: status.data === 'unavailable',
        onChange: (v) => void set(v),
      }}
    />
  )
}

export function SettingsTab() {
  useLocale()
  const values = useSettings()
  const [query, setQuery] = useState('')
  const [width, setWidth] = useState(0)
  const [activeSection, setActiveSection] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const keys = useMemo(() => Object.keys(schemas), [])
  const q = query.trim().toLowerCase()
  const matches = (key: string) => {
    const { category, label } = displayName(key)
    return !q || key.toLowerCase().includes(q) || `${category} ${label}`.toLowerCase().includes(q) || descriptionOf(key).toLowerCase().includes(q)
  }
  const visible = keys.filter(matches)
  const showLogin = !q || t('settings.openAtLogin').toLowerCase().includes(q)
  const count = visible.length + (showLogin ? 1 : 0)
  const sections = SECTIONS.map((section) => ({
    ...section,
    keys: visible.filter(section.match),
    login: section.title === 'settings.section.general' && showLogin,
  })).filter((section) => section.keys.length > 0 || section.login)

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  // Below 700px the table of contents is hidden (settingsEditor2.ts NARROW_TOTAL_WIDTH)
  const narrow = width < 700

  const reveal = (key: string) => {
    setQuery('')
    requestAnimationFrame(() => document.getElementById(rowId(key))?.scrollIntoView({ block: 'start' }))
  }

  // The table of contents follows the section at the top of the list
  const onScroll = () => {
    const tree = treeRef.current
    if (!tree) return
    const top = tree.getBoundingClientRect().top
    const headings = [...tree.querySelectorAll<HTMLElement>('[data-section]')]
    let index = 0
    headings.forEach((heading, i) => {
      if (heading.getBoundingClientRect().top - top <= 8) index = i
    })
    setActiveSection(index)
  }

  return (
    <div ref={rootRef} className="mx-auto flex h-full max-w-[1400px] flex-col overflow-hidden">
      <EditorActions>
        <ActionButton icon="go-to-file" label={t('settings.openJson')} onClick={() => void ipc.settingsFilePaths().then(([settings]) => ipc.openPath(settings))} />
      </EditorActions>
      <div className="mt-[11px] shrink-0 px-6 pt-[3px]">
        <InputGroup className="border-settings-search-border">
          <InputGroupInput placeholder={t('settings.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('settings.search')} />
          <InputGroupAddon align="inline-end">
            {q && <span className="me-[3px] shrink-0 whitespace-nowrap text-description">{count === 1 ? '1 Setting Found' : `${count} Settings Found`}</span>}
            <button
              type="button"
              aria-label="Clear Settings Search Input"
              disabled={!query}
              className="flex cursor-pointer rounded-inset p-px text-inherit hover:bg-input-option-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
              onClick={() => setQuery('')}
            >
              <Icon name="clear-all" />
            </button>
          </InputGroupAddon>
        </InputGroup>
        <div className="mt-2.5 flex border-settings-header-border border-b">
          <span className="border-settings-header-foreground border-b px-2 pt-[7px] pb-[6.5px] text-settings-header-foreground text-ui">{t('keys.user')}</span>
        </div>
      </div>
      <div className="mt-3.5 flex min-h-0 flex-1">
        {!narrow && (
          <nav className="w-[200px] shrink-0 overflow-y-auto border-settings-header-border border-r ps-6" aria-label={t('detail.settings')}>
            {sections.map((section, i) => (
              <button
                key={section.title}
                type="button"
                className={cn(
                  'flex h-row w-full cursor-pointer items-center truncate text-start leading-row',
                  i === activeSection ? 'font-bold' : 'opacity-90',
                )}
                onClick={() => document.getElementById(section.title)?.scrollIntoView({ block: 'start' })}
              >
                <span className="truncate">{t(section.title)}</span>
                {q && <span className="ms-[3px] opacity-80">({section.keys.length + (section.login ? 1 : 0)})</span>}
              </button>
            ))}
          </nav>
        )}
        <div ref={treeRef} className="min-w-0 flex-1 overflow-y-auto pb-10" onScroll={onScroll}>
          {sections.length === 0 && <p className="px-6 pt-5">No Settings Found</p>}
          {sections.map((section) => (
            <section key={section.title} aria-labelledby={section.title} className={narrow ? 'ps-[33px] pe-6' : 'px-6'}>
              <h2 id={section.title} data-section className="truncate p-2.5 ps-[15px] font-semibold text-settings-header-foreground text-[26px] leading-ui">
                {t(section.title)}
              </h2>
              {section.login && <LoginItemSetting />}
              {section.keys.map((key) => {
                const schema = schemas[key]
                const value = key in values ? values[key] : settingDefault(key)
                const modified = JSON.stringify(value) !== JSON.stringify(settingDefault(key))
                const types = Array.isArray(schema.type) ? schema.type : [schema.type]
                const { category, label } = displayName(key)
                const description = <Markdown text={descriptionOf(key)} onReveal={reveal} />
                const reset = () => void setSetting(key, null)
                if (types.includes('boolean') && !schema.enum) {
                  return (
                    <SettingRow
                      key={key}
                      id={rowId(key)}
                      category={category}
                      label={label}
                      description={description}
                      modified={modified}
                      onReset={reset}
                      bool={{ checked: Boolean(value), onChange: (v) => void setSetting(key, v).catch((e) => toastManager.add({ type: 'error', title: errorMessage(e) })) }}
                    />
                  )
                }
                return (
                  <SettingRow key={key} id={rowId(key)} category={category} label={label} description={description} modified={modified} onReset={reset}>
                    <Control name={key} schema={schema} value={value} />
                  </SettingRow>
                )
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
