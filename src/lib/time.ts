// Dates the way GitLens shows them by default (`gitlens.defaultDateStyle: relative`).

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

// An ICU formatter costs two orders of magnitude more to build than to use, and every commit
// row formats two or three dates, so they are built once per locale (VS Code's
// `vs/base/common/date.ts` and GitLens's `system/date.ts` cache them the same way).
const RELATIVE = new Map<string, Intl.RelativeTimeFormat>()
const FULL = new Map<string, Intl.DateTimeFormat>()

function relative(locale: string): Intl.RelativeTimeFormat {
  let format = RELATIVE.get(locale)
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    RELATIVE.set(locale, format)
  }
  return format
}

function full(locale: string): Intl.DateTimeFormat {
  let format = FULL.get(locale)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' })
    FULL.set(locale, format)
  }
  return format
}

/** "5 minutes ago" for a time in seconds since epoch. */
export function relativeTime(seconds: number, locale: string): string {
  const diff = seconds - Date.now() / 1000
  const format = relative(locale)
  for (const [unit, size] of UNITS) if (Math.abs(diff) >= size) return format.format(Math.round(diff / size), unit)
  return format.format(0, 'minute')
}

/** Full local date and time, for tooltips. */
export function fullDate(seconds: number, locale: string): string {
  return full(locale).format(new Date(seconds * 1000))
}
