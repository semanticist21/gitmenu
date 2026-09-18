// Checks src/i18n/gitlens/<locale>.json against the GitLens strings used in src/ (`gl('…')`,
// `{ gl: '…' }` and the contribution helpers that wrap titles in `{ gl }`). Reports only.
//
//   bun scripts/i18n/extract-gitlens.ts          missing/stale keys and placeholder mismatches per locale
//   bun scripts/i18n/extract-gitlens.ts --list   the sorted English strings
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = join(import.meta.dirname, '..', '..', 'src')
const localeDir = join(src, 'i18n', 'gitlens')

// A single- or double-quoted literal with escapes; group 1 is the quote, group 2 the body
const LIT = String.raw`(['"])((?:\\.|(?!\1)[^\\\n])*)\1`
const PATTERNS = [
  new RegExp(String.raw`\bgl\(\s*${LIT}`, 'g'), // gl('…')
  new RegExp(String.raw`\bgl:\s*${LIT}`, 'g'), // { gl: '…' }
  new RegExp(String.raw`\bcommand\('[^']*', ${LIT}`, 'g'), // command('id', '…') in contribution files
  new RegExp(String.raw`\['gitlens\.[^']*', ${LIT}`, 'g'), // ['gitlens.id', '…', …] title tuples
]
// gl({ key: '…', … }[value]) lookups
const OBJECT_LOOKUP = /\bgl\(\{([^}]*)\}\[/g
const OBJECT_VALUE = new RegExp(String.raw`:\s*${LIT}`, 'g')

const unescape = (body: string) => body.replace(/\\(.)/g, '$1')
const placeholders = (text: string) => [...text.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort().join()

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return path === join(src, 'i18n') ? [] : sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const strings = new Set<string>()
for (const file of sourceFiles(src)) {
  const code = readFileSync(file, 'utf8')
  // The helper call sites only count where the helper wraps its title in `{ gl }`
  const wrapsTitles = /title:\s*\{\s*gl:\s*title\s*\}/.test(code)
  for (const [i, pattern] of PATTERNS.entries()) {
    if (i >= 2 && !wrapsTitles) continue
    for (const m of code.matchAll(pattern)) {
      // Menu tuples share the ['gitlens.id', …] shape but carry a group (`inline@1`)
      if (i === 3 && m[2].includes('@')) continue
      strings.add(unescape(m[2]))
    }
  }
  for (const m of code.matchAll(OBJECT_LOOKUP)) {
    for (const v of m[1].matchAll(OBJECT_VALUE)) strings.add(unescape(v[2]))
  }
}
const english = [...strings].sort()

if (process.argv.includes('--list')) {
  console.log(english.join('\n'))
  process.exit(0)
}

let failed = false
for (const name of readdirSync(localeDir).filter((f) => f.endsWith('.json')).sort()) {
  const table: Record<string, string> = JSON.parse(readFileSync(join(localeDir, name), 'utf8'))
  const keys = Object.keys(table)
  const problems = [
    ...english.filter((s) => !(s in table)).map((s) => `missing: ${s}`),
    ...keys.filter((k) => !strings.has(k)).map((k) => `stale: ${k}`),
    ...keys.filter((k) => typeof table[k] !== 'string' || !table[k].trim()).map((k) => `empty: ${k}`),
    ...keys.filter((k) => strings.has(k) && placeholders(k) !== placeholders(table[k] ?? '')).map((k) => `placeholders: ${k}`),
    ...(keys.join('\n') === [...keys].sort().join('\n') ? [] : ['keys are not sorted']),
  ]
  failed ||= problems.length > 0
  console.log(`${name}: ${problems.length ? '' : 'ok'}`)
  for (const p of problems) console.log(`  ${p}`)
}
console.log(`${english.length} strings`)
process.exit(failed ? 1 : 0)
