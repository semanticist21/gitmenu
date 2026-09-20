import { expect, test } from 'bun:test'
import { fullDate, relativeTime } from './time'

/** The app's locales (src/i18n/index.ts `LOCALES`, inlined: that module needs Vite to load). */
const LOCALES = ['en', 'ko', 'ja', 'zh-cn', 'zh-tw', 'de', 'fr', 'es', 'pt-br', 'ru']

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

// What the helpers did before the formatters were cached; the cached ones must match it exactly.
function uncachedRelative(seconds: number, locale: string): string {
  const diff = seconds - Date.now() / 1000
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, size] of UNITS) if (Math.abs(diff) >= size) return format.format(Math.round(diff / size), unit)
  return format.format(0, 'minute')
}

const uncachedFull = (seconds: number, locale: string) => new Date(seconds * 1000).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' })

const OFFSETS = [0, 59, 61, 3 * 3_600, 25 * 3_600, 8 * 86_400, 40 * 86_400, 400 * 86_400]
const now = 1_700_000_000

test('caching the formatters does not change a single string', () => {
  for (const locale of LOCALES) {
    for (const offset of OFFSETS) {
      for (const seconds of [now - offset, now + offset]) {
        expect(`${locale} ${offset} ${relativeTime(seconds, locale)}`).toBe(`${locale} ${offset} ${uncachedRelative(seconds, locale)}`)
        expect(`${locale} ${offset} ${fullDate(seconds, locale)}`).toBe(`${locale} ${offset} ${uncachedFull(seconds, locale)}`)
      }
    }
  }
})

test('a formatter is built once per locale, not once per row', () => {
  const patchable = Intl as unknown as { RelativeTimeFormat: unknown; DateTimeFormat: unknown }
  const RelativeTimeFormat = Intl.RelativeTimeFormat
  const DateTimeFormat = Intl.DateTimeFormat
  let built = 0
  patchable.RelativeTimeFormat = function (locale: string, options: Intl.RelativeTimeFormatOptions) {
    built += 1
    return new RelativeTimeFormat(locale, options)
  }
  patchable.DateTimeFormat = function (locale: string, options: Intl.DateTimeFormatOptions) {
    built += 1
    return new DateTimeFormat(locale, options)
  }
  try {
    // Locales the other test has not warmed, so the count is this test's own
    for (let i = 0; i < 1000; i += 1) {
      relativeTime(now - i, 'en-GB')
      fullDate(now - i, 'en-GB')
      relativeTime(now - i, 'fi')
      fullDate(now - i, 'fi')
    }
  } finally {
    patchable.RelativeTimeFormat = RelativeTimeFormat
    patchable.DateTimeFormat = DateTimeFormat
  }
  expect(built).toBe(4)
})
