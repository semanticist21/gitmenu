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

// 18pt canvas (what macOS shows in the menu bar); the mark is 16pt tall like system icons.
// The body is drawn in body.svg's 24-unit space and scaled; the badge sits bottom-right.
const SIZE_PT = 18
const BODY = { scale: 0.825, tx: 0.34, ty: -0.9 }
const BADGE = { cx: 14.1, cy: 14.1, r: 3.6, gap: 1.0 }
// Badge glyphs are drawn around (0,0) in a 10-unit space
const glyphs: Record<string, string> = {
  push: '<path d="M0 3v-6M-2.6-0.6 0-3.2l2.6 2.6"/>',
  pull: '<path d="M0-3v6M-2.6 0.6 0 3.2l2.6-2.6"/>',
  fetch: '<path d="M2.6-1.6a3 3 0 1 0 .4 2.2"/><path d="M3-3.4v2.2H.8"/>',
  commit: '<circle r="2" fill="currentColor" stroke="none"/>',
  conflict: '<path d="M0-3v3.4"/><circle cy="3" r="0.3"/>',
  failure: '<path d="m-2.1-2.1 4.2 4.2m0-4.2-4.2 4.2"/>',
}

function svg(state: string, bodyColor: string): string {
  // The knockout is applied inside the body's transformed space
  const kx = (BADGE.cx - BODY.tx) / BODY.scale
  const ky = (BADGE.cy - BODY.ty) / BODY.scale
  const kr = (BADGE.r + BADGE.gap) / BODY.scale
  const knockout = state === 'idle'
    ? ''
    : `<mask id="k" maskUnits="userSpaceOnUse" x="-10" y="-10" width="60" height="60"><rect x="-10" y="-10" width="60" height="60" fill="#fff"/><circle cx="${kx}" cy="${ky}" r="${kr}" fill="#000"/></mask>`
  const mask = state === 'idle' ? '' : ' mask="url(#k)"'
  const bodyGroup = `<g transform="translate(${BODY.tx} ${BODY.ty}) scale(${BODY.scale})"${mask} color="${bodyColor}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body.replaceAll('#000', 'currentColor')}</g>`
  let badge = ''
  if (state === 'conflict' || state === 'failure') {
    badge = `<circle cx="${BADGE.cx}" cy="${BADGE.cy}" r="${BADGE.r}" fill="#ff3b30"/>`
      + `<g transform="translate(${BADGE.cx} ${BADGE.cy}) scale(0.62)" color="#fff" stroke="currentColor" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${glyphs[state]}</g>`
  } else if (state !== 'idle') {
    badge = `<g transform="translate(${BADGE.cx} ${BADGE.cy})" color="${bodyColor}" stroke="currentColor" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">`
      + `<circle r="${BADGE.r - 0.5}"/><g transform="scale(0.62)">${glyphs[state]}</g></g>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18"><defs>${knockout}</defs>${bodyGroup}${badge}</svg>`
}

function render(name: string, source: string) {
  const tmp = join(tmpdir(), `gitmenu-tray-${name}.svg`)
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
