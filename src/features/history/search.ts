// GitLens's commit search syntax: `message:` (`=:`), `author:` (`@:`), `commit:` (`#:`),
// `file:` (`?:`), `change:` (`~:`); text without an operator searches messages. Values may be
// quoted to include spaces.
import type { Search } from '@/lib/git'

const OPERATORS: Record<string, keyof Omit<Search, 'matchCase'>> = {
  'message:': 'message',
  '=:': 'message',
  'author:': 'author',
  '@:': 'author',
  'commit:': 'commit',
  '#:': 'commit',
  'file:': 'file',
  '?:': 'file',
  'change:': 'changes',
  '~:': 'changes',
}

export function parseSearch(query: string, matchCase = false): Search {
  const search: Required<Search> = { message: [], author: [], commit: [], file: [], changes: [], matchCase }
  const tokens = query.match(/(?:[^\s"]+:)?"[^"]*"|\S+/g) ?? []
  for (const token of tokens) {
    const op = Object.keys(OPERATORS).find((o) => token.startsWith(o))
    const raw = op ? token.slice(op.length) : token
    const value = raw.replace(/^"(.*)"$/, '$1')
    if (!value) continue
    const field = op ? OPERATORS[op] : /^[0-9a-f]{7,40}$/i.test(value) && tokens.length === 1 ? 'commit' : 'message'
    search[field].push(value)
  }
  return search
}
