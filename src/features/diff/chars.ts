// Changed character ranges inside a changed line pair, for VS Code's `char-insert` /
// `char-delete` decorations. Words, runs of whitespace and single symbols are compared with a
// longest common subsequence; long lines fall back to the common prefix and suffix.

/** `[start, end)` in UTF-16 offsets; `start === end` marks an insertion point. */
export type CharRange = [number, number]

const TOKEN = /\w+|\s+|[^\w\s]/g
const MAX_CELLS = 40_000

function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? []
}

function prefixSuffix(a: string, b: string): [CharRange[], CharRange[]] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  return [[[start, a.length - end]], [[start, b.length - end]]]
}

/** Ranges of `a` and `b` that differ; empty arrays when the lines are equal. */
export function charChanges(a: string, b: string): [CharRange[], CharRange[]] {
  if (a === b) return [[], []]
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (ta.length * tb.length > MAX_CELLS) return prefixSuffix(a, b)

  // LCS table over tokens, filled from the end so the walk below goes forward
  const n = ta.length
  const m = tb.length
  const table = new Uint16Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * (m + 1) + j] =
        ta[i] === tb[j] ? table[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(table[(i + 1) * (m + 1) + j], table[i * (m + 1) + j + 1])
    }
  }

  const left: CharRange[] = []
  const right: CharRange[] = []
  const push = (ranges: CharRange[], start: number, end: number) => {
    const last = ranges[ranges.length - 1]
    if (last && last[1] === start) last[1] = end
    else ranges.push([start, end])
  }
  let i = 0
  let j = 0
  let offA = 0
  let offB = 0
  // Offsets where the current run of changes began on each side
  let runA = -1
  let runB = -1
  const flush = () => {
    if (runA === -1) return
    push(left, runA, offA)
    push(right, runB, offB)
    runA = -1
    runB = -1
  }
  while (i < n || j < m) {
    if (i < n && j < m && ta[i] === tb[j]) {
      flush()
      offA += ta[i++].length
      offB += tb[j++].length
    } else {
      if (runA === -1) {
        runA = offA
        runB = offB
      }
      if (j >= m || (i < n && table[(i + 1) * (m + 1) + j] >= table[i * (m + 1) + j + 1])) offA += ta[i++].length
      else offB += tb[j++].length
    }
  }
  flush()
  return [left, right]
}
