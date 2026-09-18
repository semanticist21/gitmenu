// Renders the menu bar icon and its status badges to PNG (@1x/@2x) with rsvg-convert.
// Output: src-tauri/icons/tray/<state>.png and <state>@2x.png
//   idle, push, pull, fetch, commit  → black template images (macOS tints them)
//   conflict-{light,dark}, failure-{light,dark} → full color, body drawn for a light or dark menu bar
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = join(import.meta.dirname, '..', '..')
const outDir = join(root, 'src-tauri', 'icons', 'tray')
const body = readFileSync(join(import.meta.dirname, 'body.svg'), 'utf8')
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')

// 28-unit canvas: the 24-unit body sits top-left, the badge overlaps its bottom-right corner
const SIZE_PT = 22
const BADGE = { cx: 22, cy: 22, r: 5.6, gap: 1.6 }

const glyphs: Record<string, string> = {
  push: '<path d="M22 25v-6M19.4 21.4 22 18.8l2.6 2.6"/>',
  pull: '<path d="M22 19v6M19.4 22.6 22 25.2l2.6-2.6"/>',
  fetch: '<path d="M24.6 20.4a3 3 0 1 0 .4 2.2"/><path d="M25 18.6v2.2h-2.2"/>',
  commit: '<circle cx="22" cy="22" r="2" fill="currentColor" stroke="none"/>',
  conflict: '<path d="M22 19v3.4"/><circle cx="22" cy="25" r="0.3"/>',
  failure: '<path d="m19.9 19.9 4.2 4.2m0-4.2-4.2 4.2"/>',
}

function svg(state: string, bodyColor: string): string {
  const knockout = state === 'idle'
    ? ''
    : `<mask id="k"><rect width="28" height="28" fill="#fff"/><circle cx="${BADGE.cx}" cy="${BADGE.cy}" r="${BADGE.r + BADGE.gap}" fill="#000"/></mask>`
  const mask = state === 'idle' ? '' : ' mask="url(#k)"'
  const bodyGroup = `<g${mask} color="${bodyColor}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body.replaceAll('#000', 'currentColor')}</g>`
  let badge = ''
  if (state === 'conflict' || state === 'failure') {
    badge = `<circle cx="${BADGE.cx}" cy="${BADGE.cy}" r="${BADGE.r}" fill="#ff3b30"/>`
      + `<g color="#fff" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${glyphs[state]}</g>`
  } else if (state !== 'idle') {
    badge = `<g color="${bodyColor}" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">`
      + `<circle cx="${BADGE.cx}" cy="${BADGE.cy}" r="${BADGE.r - 0.6}"/>${glyphs[state]}</g>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28"><defs>${knockout}</defs>${bodyGroup}${badge}</svg>`
}

function render(name: string, source: string) {
  const tmp = join(tmpdir(), `gitside-tray-${name}.svg`)
  writeFileSync(tmp, source)
  for (const [suffix, scale] of [['', 1], ['@2x', 2]] as const) {
    const px = String(SIZE_PT * scale)
    const result = spawnSync('rsvg-convert', ['-w', px, '-h', px, '-o', join(outDir, `${name}${suffix}.png`), tmp])
    if (result.status !== 0) throw new Error(`rsvg-convert failed for ${name}: ${result.stderr}`)
  }
  rmSync(tmp)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
for (const state of ['idle', 'push', 'pull', 'fetch', 'commit']) render(state, svg(state, '#000'))
for (const state of ['conflict', 'failure']) {
  render(`${state}-light`, svg(state, '#000'))
  render(`${state}-dark`, svg(state, '#fff'))
}
console.log(`wrote tray icons to ${outDir}`)
