import { buildPatch, type Hunk, selectHunks, splitLines } from '../diff/patch'

function markerRun(line: string) {
  return /^(<+|\|+|=+|>+)(?:[ \t].*)?$/.exec(line.replace(/\r$/, ''))?.[1]
}

function marker(line: string, width: number) {
  const start = markerRun(line)
  return start?.length === width ? start[0] : null
}

export function hasConflictMarkers(text: string, width: number, headWidth?: number | null) {
  return splitLines(text).some((line) => {
    const run = markerRun(line)
    return !!run && (run.length === width || run.length === headWidth || run.length === 7 || /^[<>]{2}/.test(run))
  })
}

/** Resolves marked blocks only. A broken or nested block is left for manual editing. */
export function conflictPatch(path: string, text: string, side: 'current' | 'incoming', width: number, headWidth?: number | null): string | null {
  if (headWidth == null || headWidth === width) return patchAtWidth(path, text, side, width)
  const lines = splitLines(text)
  const current = lines.some((line) => marker(line, width) !== null)
  const previous = lines.some((line) => marker(line, headWidth) !== null)
  if (current && previous) return null
  return patchAtWidth(path, text, side, previous ? headWidth : width)
}

function patchAtWidth(path: string, text: string, side: 'current' | 'incoming', width: number): string | null {
  const old = splitLines(text)
  const next: string[] = []
  const hunks: Hunk[] = []
  for (let i = 0; i < old.length;) {
    if (marker(old[i], width) !== '<') {
      next.push(old[i++])
      continue
    }
    const start = i++
    let base = -1
    let separator = -1
    for (; i < old.length; i++) {
      const token = marker(old[i], width)
      if (!token) continue
      if (token === '|' && base === -1 && separator === -1) base = i
      else if (token === '=' && separator === -1) separator = i
      else if (token === '>' && separator !== -1) break
      else return null
    }
    if (i === old.length) return null
    const accepted = side === 'current' ? old.slice(start + 1, base === -1 ? separator : base) : old.slice(separator + 1, i)
    hunks.push({ leftStart: start, leftCount: i - start + 1, rightStart: next.length, rightCount: accepted.length })
    for (const line of accepted) next.push(line)
    i++
  }
  const resolved = next.join('\n') + (next.length && text.endsWith('\n') ? '\n' : '')
  return buildPatch(path, text, resolved, hunks, selectHunks(hunks))
}
