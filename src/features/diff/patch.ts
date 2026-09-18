// Builds unified patches for part of a file's change (a block or selected lines), to apply
// with `git apply --cached` (stage), `--cached -R` (unstage) or `-R` (revert in the worktree).
//
// The patch goes from `left` to `right` text. Lines of the change that aren't selected stay
// as they are on the left: unselected removals become context, unselected additions are
// dropped. `git apply --recount` fixes the hunk header counts.

export interface Hunk {
  leftStart: number
  leftCount: number
  rightStart: number
  rightCount: number
}

/** Selected lines, 0-based, per side. A hunk is fully selected when all its lines are. */
export interface LineSelection {
  left: Set<number>
  right: Set<number>
}

const CONTEXT = 3

export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  // A trailing newline ends the last line rather than starting an empty one
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function header(path: string, originalPath?: string) {
  const a = originalPath ?? path
  return `diff --git a/${a} b/${path}\n--- a/${a}\n+++ b/${path}\n`
}

/**
 * A patch containing only `selection` of `hunks`. Returns `null` when nothing is selected.
 * `leftText`/`rightText` are the full files (left = the base the patch applies to).
 */
export function buildPatch(
  path: string,
  leftText: string,
  rightText: string,
  hunks: Hunk[],
  selection: LineSelection,
  originalPath?: string,
): string | null {
  const left = splitLines(leftText)
  const right = splitLines(rightText)
  const leftEndsWithNewline = leftText === '' || leftText.endsWith('\n')
  const rightEndsWithNewline = rightText === '' || rightText.endsWith('\n')
  let body = ''

  // Only the selected part of each hunk
  const picked = hunks
    .map((hunk) => {
      const removed = new Set<number>()
      const added: number[] = []
      for (let i = 0; i < hunk.leftCount; i++) if (selection.left.has(hunk.leftStart + i)) removed.add(hunk.leftStart + i)
      for (let i = 0; i < hunk.rightCount; i++) if (selection.right.has(hunk.rightStart + i)) added.push(hunk.rightStart + i)
      return { hunk, removed, added }
    })
    .filter((p) => p.removed.size > 0 || p.added.length > 0)

  // Hunks whose context would overlap become one patch hunk, or git rejects the patch
  const groups: (typeof picked)[] = []
  for (const p of picked) {
    const last = groups.at(-1)?.at(-1)
    if (last && p.hunk.leftStart - (last.hunk.leftStart + last.hunk.leftCount) <= 2 * CONTEXT) groups.at(-1)!.push(p)
    else groups.push([p])
  }

  let delta = 0
  for (const group of groups) {
    const first = group[0].hunk
    const lastHunk = group[group.length - 1].hunk
    const before = Math.max(0, first.leftStart - CONTEXT)
    const after = Math.min(left.length, lastHunk.leftStart + lastHunk.leftCount + CONTEXT)
    const lines: string[] = []
    const context = (from: number, to: number) => {
      for (let i = from; i < to; i++) lines.push(` ${left[i]}`)
    }
    let cursor = before
    for (const { hunk, removed, added } of group) {
      context(cursor, hunk.leftStart)
      for (let i = hunk.leftStart; i < hunk.leftStart + hunk.leftCount; i++) {
        // Unselected removals stay in the file: they become context
        lines.push(removed.has(i) ? `-${left[i]}` : ` ${left[i]}`)
      }
      for (const i of added) lines.push(`+${right[i]}`)
      cursor = hunk.leftStart + hunk.leftCount
    }
    context(cursor, after)

    // "\ No newline at end of file" after a side's last line when that side has none
    const lastLeft = lines.findLastIndex((l) => l[0] !== '+')
    const lastRight = lines.findLastIndex((l) => l[0] === '+')
    const lastAdded = group.at(-1)!.added.at(-1)
    const withMarkers: string[] = []
    lines.forEach((line, i) => {
      withMarkers.push(line)
      const endsLeft = i === lastLeft && after === left.length && !leftEndsWithNewline
      const endsRight = i === lastRight && lastAdded === right.length - 1 && !rightEndsWithNewline
      if (endsLeft || endsRight) withMarkers.push('\\ No newline at end of file')
    })

    const oldCount = lines.filter((l) => l[0] === ' ' || l[0] === '-').length
    const newCount = lines.filter((l) => l[0] === ' ' || l[0] === '+').length
    const oldStart = oldCount === 0 ? before : before + 1
    const newStart = (newCount === 0 ? before : before + 1) + delta
    delta += newCount - oldCount
    body += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${withMarkers.join('\n')}\n`
  }
  return body ? header(path, originalPath) + body : null
}

/** Selection covering whole hunks. */
export function selectHunks(hunks: Hunk[]): LineSelection {
  const selection: LineSelection = { left: new Set(), right: new Set() }
  for (const hunk of hunks) {
    for (let i = 0; i < hunk.leftCount; i++) selection.left.add(hunk.leftStart + i)
    for (let i = 0; i < hunk.rightCount; i++) selection.right.add(hunk.rightStart + i)
  }
  return selection
}
