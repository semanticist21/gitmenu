// The `GitLogEntry` type reaches modules that use `import.meta.glob`; tsconfig.test.json gives
// the test project Bun's types only, so Vite's come from here
/// <reference types="vite/client" />
import { expect, test } from 'bun:test'
import type { GitLogEntry } from '@/lib/ipc'
import { appendEntry, BLOCK, commandLines, highlightRange, KEEP, logLines } from './log'

const entry = (over: Partial<GitLogEntry> = {}): GitLogEntry => ({
  op: 1,
  // 2026-09-19 19:40:12.000 local time
  time: new Date(2026, 8, 19, 19, 40, 12).getTime(),
  repo: '/r',
  args: ['pull'],
  durationMs: 123,
  code: 0,
  cancelled: false,
  stderr: '',
  ...over,
})

test('a command is logged when it exits, with its duration', () => {
  expect(logLines([entry()])).toEqual(['2026-09-19 19:40:12.123 [info] > git pull [123ms]'])
  expect(logLines([entry({ cancelled: true })])).toEqual(['2026-09-19 19:40:12.123 [info] > git pull [123ms] (cancelled)'])
})

test('each stderr line is its own line, so one line is one row', () => {
  expect(logLines([entry({ stderr: 'hint: one\nhint: two\n' })])).toEqual([
    '2026-09-19 19:40:12.123 [info] > git pull [123ms]',
    '2026-09-19 19:40:12.123 [info] hint: one',
    'hint: two',
  ])
})

test('Show Command Output separates commands with a blank line', () => {
  expect(commandLines([entry({ args: ['fetch'], stderr: 'a' }), entry({ args: ['pull'], stderr: 'b' })])).toEqual([
    '> git fetch',
    'a',
    '',
    '> git pull',
    'b',
  ])
})

test('an entry is appended, and the oldest drop at the Rust log size', () => {
  const full = Array.from({ length: KEEP }, (_, i) => entry({ op: i }))
  expect(appendEntry(undefined, entry({ op: 7 })).map((e) => e.op)).toEqual([7])
  expect(appendEntry(full.slice(0, 3), entry({ op: 7 })).map((e) => e.op)).toEqual([0, 1, 2, 7])
  const capped = appendEntry(full, entry({ op: 7 }))
  expect(capped).toHaveLength(KEEP)
  expect(capped[0].op).toBe(1)
  expect(capped[KEEP - 1].op).toBe(7)
  // The entries that stay are the same objects: appending copies the list, not the log
  expect(capped[0]).toBe(full[1])
})

test('only whole blocks around the rows on screen are tokenized', () => {
  expect(highlightRange(null, 0)).toEqual([0, 0])
  expect(highlightRange(null, 10_000)).toEqual([0, BLOCK])
  expect(highlightRange({ startIndex: 0, endIndex: 40 }, 10_000)).toEqual([0, BLOCK])
  // Scrolling inside a block keeps the same range, so nothing is tokenized again
  expect(highlightRange({ startIndex: 10, endIndex: 50 }, 10_000)).toEqual([0, BLOCK])
  expect(highlightRange({ startIndex: 250, endIndex: 290 }, 10_000)).toEqual([BLOCK, 2 * BLOCK])
  expect(highlightRange({ startIndex: 190, endIndex: 230 }, 10_000)).toEqual([0, 2 * BLOCK])
  // Never past the last line
  expect(highlightRange({ startIndex: 9990, endIndex: 10_050 }, 10_000)).toEqual([9800, 10_000])
})
