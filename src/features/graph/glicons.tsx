// GitLens glyphs that codicons lack, drawn from GitLens's images/icons/*.svg (MIT) at the
// codicon size (16px, currentColor): `gitlens-graph`, `gitlens-gitlens`, `gitlens-gitlens-filled`.
import type { SVGProps } from 'react'
import { cn } from '@/lib/utils'

type GlyphProps = Omit<SVGProps<SVGSVGElement>, 'children'>

function Glyph({ viewBox, className, children, ...props }: GlyphProps & { viewBox: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox={viewBox}
      fill="currentColor"
      aria-hidden
      className={cn('inline-block size-4 shrink-0', className)}
      {...props}
    >
      {children}
    </svg>
  )
}

/** `$(gitlens-graph)`: Show Commit Graph. */
export function GraphIcon(props: GlyphProps) {
  return (
    <Glyph viewBox="0 0 16 16" {...props}>
      <path d="M3 10.5V5.5H4V10.5H3ZM3 15.5V14.5H4V15.5H3Z" />
      <path d="M11 11V9.5H12V11C12 11.663 11.7366 12.2989 11.2678 12.7678C10.7989 13.2366 10.163 13.5 9.5 13.5H8V15.5H7V13.5H5.5V12.5H7V1H8V12.5H9.5C9.89782 12.5 10.2794 12.342 10.5607 12.0607C10.842 11.7794 11 11.3978 11 11Z" />
      <path d="M3.5 5C2.67157 5 2 4.32843 2 3.5C2 2.67157 2.67157 2 3.5 2C4.32843 2 5 2.67157 5 3.5C5 4.32843 4.32843 5 3.5 5ZM3.5 6C4.88071 6 6 4.88071 6 3.5C6 2.11929 4.88071 1 3.5 1C2.11929 1 1 2.11929 1 3.5C1 4.88071 2.11929 6 3.5 6Z" />
      <path d="M11.5 9C10.6716 9 10 8.32843 10 7.5C10 6.67157 10.6716 6 11.5 6C12.3284 6 13 6.67157 13 7.5C13 8.32843 12.3284 9 11.5 9ZM11.5 10C12.8807 10 14 8.88071 14 7.5C14 6.11929 12.8807 5 11.5 5C10.1193 5 9 6.11929 9 7.5C9 8.88071 10.1193 10 11.5 10Z" />
      <path d="M3.5 14C2.67157 14 2 13.3284 2 12.5C2 11.6716 2.67157 11 3.5 11C4.32843 11 5 11.6716 5 12.5C5 13.3284 4.32843 14 3.5 14ZM3.5 15C4.88071 15 6 13.8807 6 12.5C6 11.1193 4.88071 10 3.5 10C2.11929 10 1 11.1193 1 12.5C1 13.8807 2.11929 15 3.5 15Z" />
    </Glyph>
  )
}

/** `$(gitlens-gitlens)`: Toggle File Blame (not annotated). */
export function GitLensIcon(props: GlyphProps) {
  return (
    <Glyph viewBox="0 0 24 24" {...props}>
      <path d="M14.44 11.5 11 8.06 12.06 7l3.44 3.44-1.06 1.06ZM9.5 16V8H11v8H9.5Z" />
      <path d="M10.25 20a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM16.25 14.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM10.25 8.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" />
      <path d="M12 1.25a10.75 10.75 0 1 0 0 21.5 10.75 10.75 0 0 0 0-21.5ZM0 12a12 12 0 1 1 24 0 12 12 0 0 1-24 0Z" />
    </Glyph>
  )
}

/** `$(gitlens-gitlens-filled)`: the same action while the file is annotated. */
export function GitLensFilledIcon(props: GlyphProps) {
  return (
    <Glyph viewBox="0 0 24 24" {...props}>
      <path d="M12 24a12 12 0 1 0 0-24 12 12 0 0 0 0 24Zm-.78-15.72c-.07.03-.14.07-.22.09v7.26a2.25 2.25 0 1 1-1.5 0V8.37a2.25 2.25 0 1 1 2.78-1.15l3 3a2.25 2.25 0 1 1-1.06 1.06l-3-3Z" />
    </Glyph>
  )
}
