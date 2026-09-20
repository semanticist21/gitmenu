// The Shiki worker's message protocol, shared by the worker and its caller. Kept apart from
// shiki.worker.ts so importing it costs neither Shiki nor a Worker.

export interface HighlightRequest {
  id: number
  text: string
  lang: string
  theme: 'light-plus' | 'dark-plus'
  maxLineLength: number
}

/** Drops a request whose result is no longer wanted, so its remaining blocks are never posted. */
export interface CancelRequest {
  cancel: number
}

/** [content, color, fontStyle] per token, per line */
export type TokenLine = [string, string, number][]

/** One block of a result: `lines` starts at line `offset`, and `done` marks the last block. */
export interface HighlightResponse {
  id: number
  offset: number
  lines: TokenLine[] | null
  done: boolean
}

// A file's tokens are a few hundred thousand small arrays, and structured clone materializes
// them all in one main-thread task — hundreds of milliseconds on a large file. They go back a
// block at a time instead, with a turn of the worker's event loop between blocks, so the first
// screen paints straight away and a newer request is served without waiting for the rest.
export const CHUNK = 4000

/** The blocks `count` lines are posted in; always at least one, so an empty file still answers. */
export function blocks(count: number, size = CHUNK): { offset: number; done: boolean }[] {
  const result: { offset: number; done: boolean }[] = []
  for (let offset = 0; offset < count; offset += size) result.push({ offset, done: offset + size >= count })
  if (result.length === 0) result.push({ offset: 0, done: true })
  return result
}

/** Writes one block into the result being assembled, and returns it as a new array. */
export function merge(into: TokenLine[], offset: number, lines: TokenLine[]): TokenLine[] {
  for (let i = 0; i < lines.length; i++) into[offset + i] = lines[i]
  // A new array every block: callers compare the result by identity
  return [...into]
}
