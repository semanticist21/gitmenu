// Pane heights for the view container, computed like VS Code's splitview in the sidebar.

export const MIN_EXPANDED = 64
/** `--pane-header-size` */
export const HEADER = 22

/** VS Code's pane layout: headers keep their size, expanded panes share the rest by weight,
 * each at least MIN_EXPANDED tall. Returns pane heights in px (border-box). */
export function paneHeights(ids: string[], collapsed: ReadonlySet<string>, weights: Record<string, number>, total: number): Map<string, number> {
  const header = (index: number) => HEADER + (index > 0 ? 1 : 0)
  const heights = new Map(ids.map((id, i) => [id, header(i)]))
  const open = ids.filter((id) => !collapsed.has(id))
  if (open.length === 0) return heights
  const minBody = MIN_EXPANDED - HEADER
  const available = Math.max(0, total - ids.reduce((sum, _, i) => sum + header(i), 0))
  // Proportional shares, then lift any pane under the minimum and take it from the others
  const weightOf = (id: string) => Math.max(1, weights[id] ?? 1)
  let bodies = new Map(open.map((id) => [id, 0]))
  let flexible = [...open]
  let remaining = available
  for (let pass = 0; pass < open.length; pass++) {
    const sum = flexible.reduce((s, id) => s + weightOf(id), 0)
    const small = flexible.filter((id) => (remaining * weightOf(id)) / sum < minBody)
    if (small.length === 0 || small.length === flexible.length) {
      for (const id of flexible) bodies.set(id, Math.max(minBody, (remaining * weightOf(id)) / sum))
      break
    }
    for (const id of small) bodies.set(id, minBody)
    remaining -= small.length * minBody
    flexible = flexible.filter((id) => !small.includes(id))
  }
  // Whole pixels; the rounding remainder goes to the last expanded pane
  bodies = new Map([...bodies].map(([id, h]) => [id, Math.floor(h)]))
  const used = [...bodies.values()].reduce((a, b) => a + b, 0)
  const last = open[open.length - 1]
  bodies.set(last, Math.max(minBody, (bodies.get(last) ?? 0) + available - used))
  for (const id of open) heights.set(id, (heights.get(id) ?? HEADER) + (bodies.get(id) ?? 0))
  return heights
}
