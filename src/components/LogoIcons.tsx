// gitmenu's logo mark (scripts/tray/body.svg: a branch leaving a trunk, three commits) as
// codicon-sized glyphs in currentColor. It is the Commit Graph's icon, and, in a ring, the file
// blame toggle's (GitLens marks both with its own logo).
import { type SVGProps, useId } from 'react'
import { cn } from '@/lib/utils'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'viewBox'>

/** The mark on the 24px grid of body.svg, centered on (12, 12) */
function Mark({ color, transform }: { color: string; transform?: string }) {
  return (
    <g transform={transform} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <g transform="translate(1.5 0)">
        <path d="M6 4.5v15" />
        <path d="M6 12h6a3 3 0 0 0 3-3V7.5" />
        <circle cx="6" cy="4.5" r="2.2" fill={color} stroke="none" />
        <circle cx="6" cy="19.5" r="2.2" fill={color} stroke="none" />
        <circle cx="15" cy="6" r="2.2" fill={color} stroke="none" />
      </g>
    </g>
  )
}

function Svg({ className, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('inline-block size-icon shrink-0', className)} {...props}>
      {children}
    </svg>
  )
}

/** The mark itself: Show Commit Graph */
export function LogoMarkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <Mark color="currentColor" />
    </Svg>
  )
}

/** The mark scaled into the badge ring */
const IN_BADGE = 'translate(12 12) scale(0.75) translate(-12 -12)'

/** The mark in a ring: Toggle File Blame while the file isn't annotated */
export function LogoBadgeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="11.375" fill="none" stroke="currentColor" strokeWidth={1.25} />
      <Mark color="currentColor" transform={IN_BADGE} />
    </Svg>
  )
}

/** A filled disc with the mark cut out: the same toggle while the file is annotated */
export function LogoBadgeFilledIcon(props: IconProps) {
  const mask = useId()
  return (
    <Svg {...props}>
      <mask id={mask}>
        <circle cx="12" cy="12" r="12" fill="white" />
        <Mark color="black" transform={IN_BADGE} />
      </mask>
      <circle cx="12" cy="12" r="12" fill="currentColor" mask={`url(#${mask})`} />
    </Svg>
  )
}
