import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { themeTokens } from '../lib/utils'
import * as metrics from './metrics'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Every declaration of a custom property in index.css, in source order. */
function declarations(name: string): string[] {
  const escaped = name.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&')
  return [...css.matchAll(new RegExp(`(?:^|[\\s;{])${escaped}\\s*:\\s*([^;]+);`, 'g'))].map((m) => m[1].trim())
}

for (const [constant, token] of Object.entries(metrics.TOKENS)) {
  test(`${constant} matches ${token}`, () => {
    const found = declarations(token)
    // One owner: the token is declared exactly once
    expect(found).toHaveLength(1)
    const value = metrics[constant as keyof typeof metrics.TOKENS]
    if (typeof value === 'number') expect(found[0]).toBe(`${value}px`)
    else expect(found[0].replace(/\s+/g, ' ')).toBe(value)
  })
}

test('tailwind-merge knows every named theme token', () => {
  // Tailwind's own t-shirt names (xs, sm, 2xl, ...) are known to tailwind-merge already
  const tshirt = /^(\d*x[sl]|sm|md|lg|base)$/
  const namespaces: [string, string[]][] = [
    ['--transition-duration-', themeTokens.duration],
    ['--transition-delay-', themeTokens.delay],
    ...Object.entries(themeTokens.theme).map(([key, names]): [string, string[]] => [`--${key}-`, names]),
  ]
  const themeBlocks = [...css.matchAll(/@theme(?:\s+inline)?\s*\{([^}]*)\}/g)].map((m) => m[1]).join('\n')
  const missing: string[] = []
  for (const [, name] of themeBlocks.matchAll(/(--[\w-]+)\s*:/g)) {
    const match = namespaces.find(([prefix]) => name.startsWith(prefix))
    if (!match) continue
    const key = name.slice(match[0].length)
    if (key.includes('--') || tshirt.test(key)) continue
    if (!match[1].includes(key)) missing.push(name)
  }
  expect(missing).toEqual([])
})
