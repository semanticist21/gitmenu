import { describe, expect, test } from 'bun:test'
import { blocks, CHUNK, merge, type TokenLine } from './tokens'

const file = (count: number): TokenLine[] =>
  Array.from({ length: count }, (_, i): TokenLine => [
    ['const', '#0000FF', 0],
    [` value${i} = ${i}`, '#000000', i % 3],
  ])

/** What the worker posts and the caller assembles, without Shiki or a Worker. */
function roundTrip(lines: TokenLine[], size = CHUNK) {
  const assembled: TokenLine[] = []
  const posts = blocks(lines.length, size).map(({ offset, done }) => {
    const block = lines.slice(offset, offset + size)
    return { offset, done, result: merge(assembled, offset, block) }
  })
  return posts
}

describe('blocks', () => {
  test('an empty file still answers once', () => {
    expect(blocks(0, 4)).toEqual([{ offset: 0, done: true }])
  })

  test('a file under one block is a single done block', () => {
    expect(blocks(3, 4)).toEqual([{ offset: 0, done: true }])
    expect(blocks(4, 4)).toEqual([{ offset: 0, done: true }])
  })

  test('longer files split, and only the last block is done', () => {
    expect(blocks(9, 4)).toEqual([
      { offset: 0, done: false },
      { offset: 4, done: false },
      { offset: 8, done: true },
    ])
  })
})

describe('merge', () => {
  test('assembles exactly the lines a single message would have carried', () => {
    const lines = file(9)
    const posts = roundTrip(lines, 4)
    expect(posts.map((p) => p.offset)).toEqual([0, 4, 8])
    expect(posts.at(-1)?.result).toEqual(lines)
  })

  test('each block resolves the lines so far, and never a later one', () => {
    const lines = file(10)
    const posts = roundTrip(lines, 4)
    expect(posts[0].result).toEqual(lines.slice(0, 4))
    expect(posts[1].result).toEqual(lines.slice(0, 8))
    expect(posts[2].result).toEqual(lines)
  })

  test('a new array per block, so callers comparing by identity re-render', () => {
    const posts = roundTrip(file(10), 4)
    expect(posts[0].result).not.toBe(posts[1].result)
    expect(posts[1].result).not.toBe(posts[2].result)
  })

  test('a whole file at the real block size round-trips unchanged', () => {
    const lines = file(CHUNK * 2 + 7)
    const posts = roundTrip(lines)
    expect(posts).toHaveLength(3)
    expect(posts.at(-1)?.result).toEqual(lines)
  })
})
