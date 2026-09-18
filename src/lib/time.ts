// Dates the way GitLens shows them by default (`gitlens.defaultDateStyle: relative`).

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

/** "5 minutes ago" for a time in seconds since epoch. */
export function relativeTime(seconds: number, locale: string): string {
  const diff = seconds - Date.now() / 1000
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, size] of UNITS) if (Math.abs(diff) >= size) return format.format(Math.round(diff / size), unit)
  return format.format(0, 'minute')
}

/** Full local date and time, for tooltips. */
export function fullDate(seconds: number, locale: string): string {
  return new Date(seconds * 1000).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' })
}
