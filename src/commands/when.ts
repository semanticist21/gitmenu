// VS Code `when` clause evaluation: `a && !b || c == 'x'`, `=~ /re/`, `in`, `not in`, comparisons.
export type Context = Record<string, unknown>

type Token =
  | { type: 'op'; value: string }
  | { type: 'word'; value: string }
  | { type: 'string'; value: string }
  | { type: 'regex'; value: RegExp }

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const lastSignificant = () => tokens[tokens.length - 1]
  while (i < input.length) {
    const c = input[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    const two = input.slice(i, i + 2)
    const three = input.slice(i, i + 3)
    if (three === '===' || three === '!==') {
      tokens.push({ type: 'op', value: three.slice(0, 2) })
      i += 3
    } else if (['&&', '||', '==', '!=', '=~', '<=', '>='].includes(two)) {
      tokens.push({ type: 'op', value: two })
      i += 2
    } else if ('!()<>'.includes(c)) {
      tokens.push({ type: 'op', value: c })
      i++
    } else if (c === "'" || c === '"') {
      const end = input.indexOf(c, i + 1)
      const stop = end === -1 ? input.length : end
      tokens.push({ type: 'string', value: input.slice(i + 1, stop) })
      i = stop + 1
    } else if (c === '/' && lastSignificant()?.type === 'op' && lastSignificant()?.value === '=~') {
      let j = i + 1
      while (j < input.length && input[j] !== '/') j += input[j] === '\\' ? 2 : 1
      const flags = /^[gimsuy]*/.exec(input.slice(j + 1))?.[0] ?? ''
      try {
        tokens.push({ type: 'regex', value: new RegExp(input.slice(i + 1, j), flags) })
      } catch {
        tokens.push({ type: 'regex', value: /$^/ })
      }
      i = j + 1 + flags.length
    } else {
      const match = /^[^\s!()<>=&|'"]+/.exec(input.slice(i))
      const word = match ? match[0] : c
      tokens.push({ type: 'word', value: word })
      i += word.length
    }
  }
  return tokens
}

type Node =
  | { kind: 'and' | 'or'; left: Node; right: Node }
  | { kind: 'not'; expr: Node }
  | { kind: 'key'; key: string }
  | { kind: 'literal'; value: boolean }
  | { kind: 'cmp'; op: string; key: string; value: string | number | boolean }
  | { kind: 'regex'; key: string; re: RegExp }
  | { kind: 'in'; key: string; container: string; negate: boolean }

function parse(tokens: Token[]): Node {
  let pos = 0
  const peek = () => tokens[pos]
  const isOp = (value: string) => peek()?.type === 'op' && peek()?.value === value
  const isWord = (value: string) => peek()?.type === 'word' && peek()?.value === value

  const value = (): string | number | boolean => {
    const token = tokens[pos++]
    if (!token) return ''
    if (token.type === 'string') return token.value
    if (token.type === 'word') {
      if (token.value === 'true') return true
      if (token.value === 'false') return false
      const n = Number(token.value)
      return Number.isNaN(n) ? token.value : n
    }
    return ''
  }

  const primary = (): Node => {
    if (isOp('(')) {
      pos++
      const node = or()
      if (isOp(')')) pos++
      return node
    }
    const token = tokens[pos++]
    if (!token || token.type !== 'word') return { kind: 'literal', value: false }
    if (token.value === 'true') return { kind: 'literal', value: true }
    if (token.value === 'false') return { kind: 'literal', value: false }
    const key = token.value
    const next = peek()
    if (next?.type === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(next.value)) {
      pos++
      return { kind: 'cmp', op: next.value, key, value: value() }
    }
    if (next?.type === 'op' && next.value === '=~') {
      pos++
      const re = tokens[pos++]
      return { kind: 'regex', key, re: re?.type === 'regex' ? re.value : new RegExp(String(re?.value ?? '')) }
    }
    if (isWord('in')) {
      pos++
      return { kind: 'in', key, container: String(tokens[pos++]?.value ?? ''), negate: false }
    }
    if (isWord('not') && tokens[pos + 1]?.type === 'word' && tokens[pos + 1]?.value === 'in') {
      pos += 2
      return { kind: 'in', key, container: String(tokens[pos++]?.value ?? ''), negate: true }
    }
    return { kind: 'key', key }
  }

  const not = (): Node => {
    if (isOp('!')) {
      pos++
      return { kind: 'not', expr: not() }
    }
    return primary()
  }

  const and = (): Node => {
    let left = not()
    while (isOp('&&')) {
      pos++
      left = { kind: 'and', left, right: not() }
    }
    return left
  }

  const or = (): Node => {
    let left = and()
    while (isOp('||')) {
      pos++
      left = { kind: 'or', left, right: and() }
    }
    return left
  }

  return or()
}

function evaluate(node: Node, ctx: Context): boolean {
  switch (node.kind) {
    case 'and':
      return evaluate(node.left, ctx) && evaluate(node.right, ctx)
    case 'or':
      return evaluate(node.left, ctx) || evaluate(node.right, ctx)
    case 'not':
      return !evaluate(node.expr, ctx)
    case 'literal':
      return node.value
    case 'key':
      return Boolean(ctx[node.key])
    case 'regex': {
      const v = ctx[node.key]
      return v !== undefined && v !== null && node.re.test(String(v))
    }
    case 'in': {
      const container = ctx[node.container]
      const v = ctx[node.key]
      let hit = false
      if (Array.isArray(container)) hit = container.includes(v)
      else if (container && typeof container === 'object') hit = String(v) in container
      return node.negate ? !hit : hit
    }
    case 'cmp': {
      const v = ctx[node.key]
      switch (node.op) {
        // VS Code compares `==` loosely: `scmProvider == git` matches the string 'git'
        case '==':
          return v == node.value || String(v) === String(node.value)
        case '!=':
          return !(v == node.value || String(v) === String(node.value))
        case '<':
          return Number(v) < Number(node.value)
        case '<=':
          return Number(v) <= Number(node.value)
        case '>':
          return Number(v) > Number(node.value)
        case '>=':
          return Number(v) >= Number(node.value)
      }
      return false
    }
  }
}

const cache = new Map<string, Node>()

export function matchesWhen(when: string | undefined, ctx: Context): boolean {
  if (!when) return true
  let node = cache.get(when)
  if (!node) {
    node = parse(tokenize(when))
    cache.set(when, node)
  }
  return evaluate(node, ctx)
}
