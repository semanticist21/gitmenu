// Turns two texts and their hunks into display rows for side-by-side or inline diffs.
import type { Hunk } from './patch'

export type RowKind = 'same' | 'change'

/** Side-by-side row: a line on each side (either may be missing inside a change). */
export interface PairRow {
  kind: RowKind
  left: number | null
  right: number | null
  /** Index of the hunk this row belongs to; set on every row of a change */
  hunk: number | null
  /** First row of its hunk (where block actions go) */
  hunkStart: boolean
}

/** Inline row: one line from one side. */
export interface InlineRow {
  side: 'left' | 'right' | 'both'
  left: number | null
  right: number | null
  hunk: number | null
  hunkStart: boolean
}

export function pairRows(leftCount: number, rightCount: number, hunks: Hunk[]): PairRow[] {
  const rows: PairRow[] = []
  let l = 0
  let r = 0
  hunks.forEach((hunk, index) => {
    while (l < hunk.leftStart && r < hunk.rightStart) rows.push({ kind: 'same', left: l++, right: r++, hunk: null, hunkStart: false })
    const height = Math.max(hunk.leftCount, hunk.rightCount)
    for (let i = 0; i < height; i++) {
      rows.push({
        kind: 'change',
        left: i < hunk.leftCount ? hunk.leftStart + i : null,
        right: i < hunk.rightCount ? hunk.rightStart + i : null,
        hunk: index,
        hunkStart: i === 0,
      })
    }
    l = hunk.leftStart + hunk.leftCount
    r = hunk.rightStart + hunk.rightCount
  })
  while (l < leftCount || r < rightCount) {
    rows.push({ kind: 'same', left: l < leftCount ? l++ : null, right: r < rightCount ? r++ : null, hunk: null, hunkStart: false })
  }
  return rows
}

export function inlineRows(leftCount: number, rightCount: number, hunks: Hunk[]): InlineRow[] {
  const rows: InlineRow[] = []
  let l = 0
  let r = 0
  hunks.forEach((hunk, index) => {
    while (l < hunk.leftStart && r < hunk.rightStart) rows.push({ side: 'both', left: l++, right: r++, hunk: null, hunkStart: false })
    let first = true
    for (let i = 0; i < hunk.leftCount; i++) {
      rows.push({ side: 'left', left: hunk.leftStart + i, right: null, hunk: index, hunkStart: first })
      first = false
    }
    for (let i = 0; i < hunk.rightCount; i++) {
      rows.push({ side: 'right', left: null, right: hunk.rightStart + i, hunk: index, hunkStart: first })
      first = false
    }
    l = hunk.leftStart + hunk.leftCount
    r = hunk.rightStart + hunk.rightCount
  })
  while (l < leftCount || r < rightCount) {
    rows.push({ side: 'both', left: l < leftCount ? l++ : null, right: r < rightCount ? r++ : null, hunk: null, hunkStart: false })
  }
  return rows
}
