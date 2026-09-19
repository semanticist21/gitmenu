import { expect, test } from 'bun:test'
import { paneHeights } from './paneHeights'

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)

test('expanded panes share the space by weight and fill it exactly', () => {
  const h = paneHeights(['scm', 'commits', 'tags'], new Set(), { scm: 3, commits: 2, tags: 1 }, 600)
  expect(sum(h)).toBe(600)
  expect(h.get('scm')!).toBeGreaterThan(h.get('commits')!)
  expect(h.get('commits')!).toBeGreaterThan(h.get('tags')!)
})

test('collapsed panes are just their header (plus the top border after the first)', () => {
  const h = paneHeights(['scm', 'commits', 'tags'], new Set(['commits']), { scm: 1, tags: 1 }, 600)
  expect(h.get('commits')).toBe(23)
  expect(sum(h)).toBe(600)
})

test('no expanded pane shrinks below the minimum', () => {
  const h = paneHeights(['scm', 'commits'], new Set(), { scm: 1000, commits: 1 }, 400)
  expect(h.get('commits')!).toBeGreaterThanOrEqual(64)
  expect(sum(h)).toBe(400)
})

test('all collapsed: headers only', () => {
  const h = paneHeights(['scm', 'commits'], new Set(['scm', 'commits']), {}, 400)
  expect([...h.values()]).toEqual([22, 23])
})
