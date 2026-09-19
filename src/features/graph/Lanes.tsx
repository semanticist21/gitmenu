// One row of the commit graph's lanes: lines passing through, lines joining the commit's node
// from above, lines leaving it for its parents, and the node. As in GitLens (`gitlens.graph.avatars`),
// a commit's node is its author's avatar ringed in the lane color; merges are small dots and
// stashes squares.
import type { GraphRow } from '@/lib/git'
import { ICON_SIZE, ROW_HEIGHT } from '@/theme/metrics'
import { Avatar } from '../avatars/Avatar'

export const LANE_WIDTH = 16

// GitLens's gitlens.graphLane1Color…graphLane10Color
const LIGHT = ['#15a0bf', '#0669f7', '#8e00c2', '#c517b6', '#d90171', '#cd0101', '#f25d2e', '#f2ca33', '#7bd938', '#2ece9d']
const DARK = ['#18d1d1', '#45c6fe', '#98b5fe', '#c9a1fe', '#f58fd7', '#fe949d', '#fe9b5e', '#e0b027', '#a6c750', '#4dd494']

export const laneColor = (lane: number, dark: boolean) => (dark ? DARK : LIGHT)[lane % LIGHT.length]

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

export function Lanes({ root, row, width, dark, avatars }: { root: string; row: GraphRow; width: number; dark: boolean; avatars: boolean }) {
  const color = laneColor(row.lane, dark)
  const merge = row.parents.length > 1
  const avatarNode = avatars && !merge && !row.stash
  return (
    <div className="relative shrink-0" style={{ width, height: ROW_HEIGHT }}>
      <svg width={width} height={ROW_HEIGHT} className="absolute inset-0 overflow-visible" aria-hidden>
        {row.pass.map((lane) => (
          <path key={`p${lane}`} d={edge(lane, 0, lane, ROW_HEIGHT)} stroke={laneColor(lane, dark)} strokeWidth={2} fill="none" />
        ))}
        {row.continues && <path d={edge(row.lane, 0, row.lane, MID)} stroke={color} strokeWidth={2} fill="none" />}
        {row.into.map((lane) => (
          <path key={`i${lane}`} d={edge(lane, 0, row.lane, MID)} stroke={laneColor(lane, dark)} strokeWidth={2} fill="none" />
        ))}
        {row.out.map((lane) => (
          <path key={`o${lane}`} d={edge(row.lane, MID, lane, ROW_HEIGHT)} stroke={laneColor(lane, dark)} strokeWidth={2} fill="none" />
        ))}
        {row.stash ? (
          <rect x={x(row.lane) - 4.5} y={MID - 4.5} width={9} height={9} rx={2} className="fill-editor" stroke={color} strokeWidth={2} />
        ) : merge ? (
          <circle cx={x(row.lane)} cy={MID} r={4} fill={color} />
        ) : (
          !avatarNode && <circle cx={x(row.lane)} cy={MID} r={5} className="fill-editor" stroke={color} strokeWidth={2} />
        )}
      </svg>
      {avatarNode && (
        <span
          className="absolute flex size-icon items-center justify-center overflow-hidden rounded-full"
          style={{ left: x(row.lane) - ICON_SIZE / 2, top: MID - ICON_SIZE / 2, backgroundColor: color }}
        >
          <Avatar root={root} name={row.author.name} email={row.author.email} sha={row.id} className="size-3" />
        </span>
      )}
    </div>
  )
}
