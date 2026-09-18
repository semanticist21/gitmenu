// One row of the commit graph's lanes: lines passing through, lines joining the commit's dot
// from above, lines leaving it for its parents, and the dot.
import type { GraphRow } from '@/lib/git'

export const LANE_WIDTH = 16
export const ROW_HEIGHT = 26

// GitLens's graph lane colors
const COLORS = ['#15a0bf', '#0669f7', '#8e00c2', '#c517b6', '#d90171', '#cd0101', '#f25d2e', '#f2ca33', '#7bd938', '#2ece9d']

export const laneColor = (lane: number) => COLORS[lane % COLORS.length]

const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2
const MID = ROW_HEIGHT / 2

/** A line between two lanes: straight when they match, otherwise a smooth S. */
function edge(fromLane: number, fromY: number, toLane: number, toY: number) {
  const x1 = x(fromLane)
  const x2 = x(toLane)
  if (x1 === x2) return `M${x1} ${fromY}L${x2} ${toY}`
  const dy = (toY - fromY) / 2
  return `M${x1} ${fromY}C${x1} ${fromY + dy} ${x2} ${toY - dy} ${x2} ${toY}`
}

export function Lanes({ row, width, selected }: { row: GraphRow; width: number; selected: boolean }) {
  const color = laneColor(row.lane)
  const merge = row.parents.length > 1
  return (
    <svg width={width} height={ROW_HEIGHT} className="shrink-0 overflow-visible" aria-hidden>
      {row.pass.map((lane) => (
        <path key={`p${lane}`} d={edge(lane, 0, lane, ROW_HEIGHT)} stroke={laneColor(lane)} strokeWidth={2} fill="none" />
      ))}
      {row.continues && <path d={edge(row.lane, 0, row.lane, MID)} stroke={color} strokeWidth={2} fill="none" />}
      {row.into.map((lane) => (
        <path key={`i${lane}`} d={edge(lane, 0, row.lane, MID)} stroke={laneColor(lane)} strokeWidth={2} fill="none" />
      ))}
      {row.out.map((lane) => (
        <path key={`o${lane}`} d={edge(row.lane, MID, lane, ROW_HEIGHT)} stroke={laneColor(lane)} strokeWidth={2} fill="none" />
      ))}
      {row.stash ? (
        <rect x={x(row.lane) - 4.5} y={MID - 4.5} width={9} height={9} rx={2} fill="var(--background)" stroke={color} strokeWidth={2} />
      ) : (
        <circle
          cx={x(row.lane)}
          cy={MID}
          r={merge ? 3.5 : 5}
          fill={merge ? color : 'var(--background)'}
          stroke={color}
          strokeWidth={selected ? 3 : 2}
        />
      )}
    </svg>
  )
}
