// The Settings tab: every setting from configuration.json, grouped, searchable, written to
// settings.json (which stays the source of truth; edits there show up here at once).
import { useQuery } from '@tanstack/react-query'
import { FileJsonIcon, RotateCcwIcon, SearchIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import configuration from '@/commands/configuration.json'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { toastManager } from '@/components/ui/toast'
import { t, useLocale, vs } from '@/i18n'
import type { AppKey } from '@/i18n/app/en'
import { errorMessage, ipc, type LoginItem } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { setSetting, settingDefault, useSettings } from '@/settings/settings'

interface Schema {
  type: string | string[]
  enum?: (string | boolean)[]
  default: unknown
}

const schemas = configuration as Record<string, Schema>

const SECTIONS: { title: AppKey; match: (key: string) => boolean }[] = [
  { title: 'settings.section.general', match: (k) => (k.startsWith('gitside.') && !k.startsWith('gitside.ai.')) || k.startsWith('update.') },
  { title: 'settings.section.ai', match: (k) => k.startsWith('gitside.ai.') },
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

/** VS Code's settings UI title: `git.enableSmartCommit` → "Enable Smart Commit". */
function titleOf(key: string) {
  const last = key.slice(key.lastIndexOf('.') + 1)
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}

function categoryOf(key: string) {
  const parts = key.split('.')
  return parts.slice(0, -1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' › ')
}

function descriptionOf(key: string): string {
  if (key.startsWith('git.')) return vs(`config.${key.slice(4)}`).replace(/`/g, '')
  return t(`setting.${key}` as AppKey)
}

function optionLabel(key: string, value: string | boolean): string {
  if (key === 'gitside.language') return value === 'auto' ? t('settings.systemLanguage') : LANGUAGE_NAMES[String(value)]
  if (key === 'gitside.theme.mode') return t(`settings.theme.${value}` as AppKey)
  return String(value)
}

function Control({ name, schema, value }: { name: string; schema: Schema; value: unknown }) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const save = (next: unknown) =>
    void setSetting(name, next).catch((e) => toastManager.add({ type: 'error', title: errorMessage(e) }))
  const terminals = useQuery({ queryKey: ['terminalApps'], queryFn: ipc.terminalApps, enabled: name === 'gitside.terminal.app' })

  if (name === 'gitside.terminal.app') {
    const options = [...new Set([...(terminals.data ?? []), String(value)])]
    return (
      <Select value={String(value)} onValueChange={(v) => save(v)}>
        <SelectTrigger className="w-60">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    )
  }
  if (schema.enum) {
    return (
      <Select value={JSON.stringify(value)} onValueChange={(v) => save(JSON.parse(String(v)))}>
        <SelectTrigger className="w-60">
          <SelectValue>{optionLabel(name, value as string | boolean)}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {schema.enum.map((o) => (
            <SelectItem key={String(o)} value={JSON.stringify(o)}>
              {optionLabel(name, o)}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    )
  }
  if (types.includes('boolean')) {
    return <Switch checked={Boolean(value)} onCheckedChange={(v) => save(v)} aria-label={titleOf(name)} />
  }
  if (types.includes('number')) {
    return (
      <Input
        type="number"
        className="w-32"
        defaultValue={value == null ? '' : String(value)}
        onBlur={(e) => save(e.target.value === '' ? null : Number(e.target.value))}
      />
    )
  }
  if (name === 'gitside.ai.commitMessage.customInstructions') {
    return <Textarea className="w-full max-w-xl" rows={3} defaultValue={String(value ?? '')} onBlur={(e) => save(e.target.value)} />
  }
  if (types.includes('string')) {
    return <Input className="w-full max-w-md" defaultValue={value == null ? '' : String(value)} onBlur={(e) => save(e.target.value === '' ? null : e.target.value)} />
  }
  return (
    <Button size="sm" variant="outline" onClick={() => void ipc.settingsFilePaths().then(([settings]) => ipc.openPath(settings))}>
      <FileJsonIcon />
      {t('settings.editInJson')}
    </Button>
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
    <div className="flex flex-col gap-1.5 border-s-2 border-transparent py-3 ps-3">
      <div className="text-sm font-medium">{t('settings.openAtLogin')}</div>
      <p className="text-muted-foreground text-xs">{status.data === 'unavailable' ? t('settings.openAtLoginUnavailable') : t('settings.openAtLoginDescription')}</p>
      <Switch
        checked={status.data === 'enabled' || status.data === 'requiresApproval'}
        disabled={status.data === 'unavailable'}
        onCheckedChange={(v) => void set(v)}
        aria-label={t('settings.openAtLogin')}
      />
    </div>
  )
}

export function SettingsTab() {
  useLocale()
  const values = useSettings()
  const [query, setQuery] = useState('')
  const keys = useMemo(() => Object.keys(schemas), [])
  const q = query.trim().toLowerCase()
  const visible = keys.filter(
    (k) => !q || k.toLowerCase().includes(q) || titleOf(k).toLowerCase().includes(q) || descriptionOf(k).toLowerCase().includes(q),
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <InputGroup className="max-w-md flex-1">
          <InputGroupInput placeholder={t('settings.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('settings.search')} />
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
        </InputGroup>
        <Button size="sm" variant="ghost" onClick={() => void ipc.settingsFilePaths().then(([settings]) => ipc.openPath(settings))}>
          <FileJsonIcon />
          {t('settings.openJson')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-10">
        <div className="mx-auto max-w-3xl">
          {SECTIONS.map((section) => {
            const sectionKeys = visible.filter(section.match)
            const showLogin = section.title === 'settings.section.general' && (!q || t('settings.openAtLogin').toLowerCase().includes(q))
            if (sectionKeys.length === 0 && !showLogin) return null
            return (
              <section key={section.title} aria-labelledby={section.title} className="pt-6">
                <h2 id={section.title} className="mb-1 font-semibold text-base">
                  {t(section.title)}
                </h2>
                {showLogin && <LoginItemSetting />}
                {sectionKeys.map((key) => {
                  const value = key in values ? values[key] : settingDefault(key)
                  const modified = JSON.stringify(value) !== JSON.stringify(settingDefault(key))
                  return (
                    <div key={key} className={cn('group relative flex flex-col gap-1.5 border-s-2 py-3 ps-3', modified ? 'border-primary' : 'border-transparent')}>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">{categoryOf(key)}:</span>
                        <span className="font-medium">{titleOf(key)}</span>
                        {modified && (
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                            aria-label={t('settings.reset')}
                            title={t('settings.reset')}
                            onClick={() => void setSetting(key, null)}
                          >
                            <RotateCcwIcon />
                          </Button>
                        )}
                      </div>
                      <p className="text-muted-foreground text-xs leading-relaxed">{descriptionOf(key)}</p>
                      <Control name={key} schema={schemas[key]} value={value} />
                    </div>
                  )
                })}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
