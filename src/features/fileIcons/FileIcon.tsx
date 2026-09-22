// The file icon drawn next to a path, from Catppuccin Icons (see scripts/icons/files.ts).
// VS Code resolves a file name first and its extension second, longest extension first
// (`.d.ts` before `.ts`); unknown files fall back to the codicon every row used before.
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { BY_EXTENSION, BY_FILENAME, GLYPHS } from './icons.gen'

export function fileIconName(path: string): string | undefined {
  const name = (path.split('/').pop() ?? path).toLowerCase()
  const byName = BY_FILENAME[name]
  if (byName) return byName
  // `archive.tar.gz` tries `tar.gz` before `gz`
  for (let i = name.indexOf('.'); i >= 0; i = name.indexOf('.', i + 1)) {
    const icon = BY_EXTENSION[name.slice(i + 1)]
    if (icon) return icon
  }
  return undefined
}

export function FileIcon({ path, className }: { path: string; className?: string }) {
  const glyph = fileIconName(path)
  if (!glyph) return <Icon name="file" className={className} />
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={cn('size-4 shrink-0', className)}
      // Generated at build time from a pinned release, never from anything a repository holds
      dangerouslySetInnerHTML={{ __html: GLYPHS[glyph] }}
    />
  )
}
