// UI language: `gitside.language` ("auto" follows the system), 10 locales.
// t()   app strings (src/i18n/app/)
// vs()  VS Code git extension strings by nls key (`command.stage`)
// vsb() VS Code git extension runtime strings by their English text
import { useSyncExternalStore } from 'react'
import en, { type AppKey } from './app/en'

export const LOCALES = ['en', 'ko', 'ja', 'zh-cn', 'zh-tw', 'de', 'fr', 'es', 'pt-br', 'ru'] as const
export type Locale = (typeof LOCALES)[number]

interface VscodeStrings {
  package: Record<string, string>
  bundle: Record<string, string>
}

const appLoaders = import.meta.glob<{ default: Partial<Record<AppKey, string>> }>('./app/*.ts')
const vscodeLoaders = import.meta.glob<VscodeStrings>('./vscode/*.json', { import: 'default' })

let locale: Locale = 'en'
let app: Record<AppKey, string> = en
let vscode: VscodeStrings = { package: {}, bundle: {} }
let vscodeEnglish: VscodeStrings = { package: {}, bundle: {} }
let gitlens: Record<string, string> = {}
const gitlensLoaders = import.meta.glob<Record<string, string>>('./gitlens/*.json', { import: 'default' })
const listeners = new Set<() => void>()

export function systemLocale(): Locale {
  const lang = (navigator.languages?.[0] ?? navigator.language ?? 'en').toLowerCase()
  if (lang.startsWith('zh')) {
    return lang.includes('tw') || lang.includes('hk') || lang.includes('hant') ? 'zh-tw' : 'zh-cn'
  }
  if (lang.startsWith('pt')) return 'pt-br'
  const base = lang.split('-')[0] as Locale
  return LOCALES.includes(base) ? base : 'en'
}

export async function setLocale(setting: string) {
  const next: Locale = setting === 'auto' || !LOCALES.includes(setting as Locale) ? systemLocale() : (setting as Locale)
  if (!vscodeEnglish.package['command.stage']) {
    vscodeEnglish = await vscodeLoaders['./vscode/en.json']()
  }
  app = next === 'en' ? en : { ...en, ...(await appLoaders[`./app/${next}.ts`]()).default }
  vscode = next === 'en' ? vscodeEnglish : await vscodeLoaders[`./vscode/${next}.json`]()
  const gitlensLoader = gitlensLoaders[`./gitlens/${next}.json`]
  gitlens = next !== 'en' && gitlensLoader ? await gitlensLoader() : {}
  locale = next
  document.documentElement.lang = next
  listeners.forEach((fn) => fn())
}

function format(text: string, args: unknown[]): string {
  return args.length ? text.replace(/\{(\d+)\}/g, (m, i) => (i < args.length ? String(args[i]) : m)) : text
}

export function t(key: AppKey, ...args: unknown[]): string {
  return format(app[key] ?? en[key], args)
}

/** A VS Code git extension string by its package.nls key, e.g. `command.stage`. */
export function vs(key: string, ...args: unknown[]): string {
  return format(vscode.package[key] ?? vscodeEnglish.package[key] ?? key, args)
}

/**
 * A VS Code git extension runtime message by its English text. Some keys carry a
 * translator comment after `/{Locked=…}`; it is part of the key but never shown.
 */
export function vsb(english: string, ...args: unknown[]): string {
  return format(vscode.bundle[english] ?? english.replace(/\/\{Locked=.*$/s, ''), args)
}

/** A GitLens label by its English text (GitLens ships English only; src/i18n/gitlens/ holds ours). */
export function gl(english: string, ...args: unknown[]): string {
  return format(gitlens[english] ?? english, args)
}

/** Strips VS Code's markdown command links (`[Label](command:…)`) down to plain lines. */
export function plainVs(key: string): string[] {
  return vs(key)
    .split('\n')
    .filter((line) => !/^\[[^\]]+\]\(command:/.test(line.trim()) && !line.includes('aka.ms'))
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Re-renders the caller when the language changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, () => locale)
}
