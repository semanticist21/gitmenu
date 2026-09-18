// Checks patches against real git: build a fixture, `git apply --cached --recount`, compare.
import { afterAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPatch, type Hunk, selectHunks } from './patch'

const dirs: string[] = []
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

function repo(left: string) {
  const dir = mkdtempSync(join(tmpdir(), 'gitside-patch-'))
  dirs.push(dir)
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' })
  git('init', '-q')
  writeFileSync(join(dir, 'f.txt'), left)
  git('add', '.')
  git('commit', '-qm', 'base')
  return { dir, git }
}

function apply(dir: string, patch: string, args: string[]) {
  execFileSync('git', ['apply', '--whitespace=nowarn', '--recount', ...args, '-'], { cwd: dir, input: patch })
}

function staged(git: (...a: string[]) => string) {
  return git('show', ':f.txt')
}

const left = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n'
const right = 'a\nB\nc\nd\ne\nf\ng\nh\nI\nj\nk\n'
// b→B, i→I, +k
const hunks: Hunk[] = [
  { leftStart: 1, leftCount: 1, rightStart: 1, rightCount: 1 },
  { leftStart: 8, leftCount: 1, rightStart: 8, rightCount: 1 },
  { leftStart: 10, leftCount: 0, rightStart: 10, rightCount: 1 },
]

describe('buildPatch', () => {
  test('stages one block of several', () => {
    const { dir, git } = repo(left)
    writeFileSync(join(dir, 'f.txt'), right)
    apply(dir, buildPatch('f.txt', left, right, hunks, selectHunks([hunks[1]]))!, ['--cached'])
    expect(staged(git)).toBe('a\nb\nc\nd\ne\nf\ng\nh\nI\nj\n')
  })

  test('stages all blocks', () => {
    const { dir, git } = repo(left)
    writeFileSync(join(dir, 'f.txt'), right)
    apply(dir, buildPatch('f.txt', left, right, hunks, selectHunks(hunks))!, ['--cached'])
    expect(staged(git)).toBe(right)
  })

  test('stages only the selected added line of a replacement', () => {
    const base = 'x\nold1\nold2\ny\n'
    const next = 'x\nnew1\nnew2\ny\n'
    const { dir, git } = repo(base)
    writeFileSync(join(dir, 'f.txt'), next)
    const h: Hunk[] = [{ leftStart: 1, leftCount: 2, rightStart: 1, rightCount: 2 }]
    // Remove old1 and add new1; old2 stays and new2 stays unstaged. Kept lines come first,
    // then the selected additions (what `git add -p` line editing produces)
    const patch = buildPatch('f.txt', base, next, h, { left: new Set([1]), right: new Set([1]) })!
    apply(dir, patch, ['--cached'])
    expect(staged(git)).toBe('x\nold2\nnew1\ny\n')
  })

  test('reverts a block in the worktree', () => {
    const { dir } = repo(left)
    writeFileSync(join(dir, 'f.txt'), right)
    apply(dir, buildPatch('f.txt', left, right, hunks, selectHunks([hunks[0]]))!, ['-R'])
    expect(readFileSync(join(dir, 'f.txt'), 'utf8')).toBe('a\nb\nc\nd\ne\nf\ng\nh\nI\nj\nk\n')
  })

  test('handles a missing trailing newline', () => {
    const base = 'a\nb'
    const next = 'a\nb\nc'
    const { dir, git } = repo(base)
    writeFileSync(join(dir, 'f.txt'), next)
    const h: Hunk[] = [{ leftStart: 1, leftCount: 1, rightStart: 1, rightCount: 2 }]
    apply(dir, buildPatch('f.txt', base, next, h, selectHunks(h))!, ['--cached'])
    expect(staged(git)).toBe(next)
  })

  test('returns null for an empty selection', () => {
    expect(buildPatch('f.txt', left, right, hunks, { left: new Set(), right: new Set() })).toBeNull()
  })
})
