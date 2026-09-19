// A codicon, the icon font VS Code draws its UI with (`@vscode/codicons`, imported once in
// index.css). 16px, colored by `currentColor`; size it with a font-size class.
import type * as React from 'react'
import { cn } from '@/lib/utils'

export interface IconProps extends Omit<React.ComponentProps<'span'>, 'children'> {
  /** Codicon id without the prefix, e.g. `sync`, `chevron-right` */
  name: string
  /** Rotates the glyph (`codicon-modifier-spin`), for `loading` and `sync` */
  spin?: boolean
}

export function Icon({ name, spin = false, className, ...props }: IconProps) {
  const labelled = props['aria-label'] !== undefined
  return (
    <span
      aria-hidden={labelled ? undefined : true}
      role={labelled ? 'img' : undefined}
      className={cn('codicon shrink-0', `codicon-${name}`, spin && 'codicon-modifier-spin', className)}
      {...props}
    />
  )
}

export { Icon as Codicon }
