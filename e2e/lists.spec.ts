// The panel's long lists and the quick pick: they draw a screenful whatever the repository
// holds, and they stop re-deriving rows they already have (mocked backend, see src/dev/mock.ts).
import { expect, type Page, test } from '@playwright/test'

type TestWindow = Window & {
  __emit: (event: string, payload: unknown) => Promise<void>
  __viewTreeBuilds?: number
  __ipcCalls: string[]
  __ipcArgs: { paths?: string[]; args?: string[] }[]
}

/** A screenful of 22px rows plus the virtualizers' 12-row overscan at each end, with room to spare. */
const DRAWN = 80

const emit = (page: Page, event: string, payload: unknown) =>
  page.evaluate(([e, p]) => (window as unknown as TestWindow).__emit(e as string, p), [event, payload])

const builds = (page: Page) => page.evaluate(() => (window as unknown as TestWindow).__viewTreeBuilds ?? 0)

/** What one IPC command was last invoked with. */
const lastArgs = (page: Page, command: string) =>
  page.evaluate((cmd) => {
    const w = window as unknown as TestWindow
    const i = w.__ipcCalls.lastIndexOf(cmd)
    return i < 0 ? null : w.__ipcArgs[i]
  }, command)

/** The paths a staged folder row handed to `git_stage`, in order. */
const staged = async (page: Page) => (await lastArgs(page, 'git_stage'))?.paths ?? []

test('expanding 1000 incoming commits builds the rows once, not once per render', async ({ page }) => {
  await page.goto('/?window=panel&views=commits&incoming=1000')
  await page.getByRole('treeitem', { name: /Incoming/ }).click()
  // The 1000 commits arrive and are turned into rows exactly once
  await expect.poll(() => builds(page)).toBe(1)
  const rows = page.getByRole('treeitem')
  expect(await rows.count()).toBeLessThan(DRAWN)

  // Scrolling re-renders the tree on every frame and the file watcher's `repo://changed`
  // invalidates the repository's queries; neither may rebuild the 1000 child nodes
  await page.mouse.move(180, 400)
  for (let i = 0; i < 20; i += 1) await page.mouse.wheel(0, 120)
  await emit(page, 'repo://changed', '/Users/me/code/demo')
  await emit(page, 'repo://changed', '/Users/me/code/demo')
  await expect.poll(() => builds(page)).toBe(1)
  expect(await rows.count()).toBeLessThan(DRAWN)
})

test('kept child rows are rebuilt when the language changes', async ({ page }) => {
  await page.goto('/?window=panel&views=commits&incoming=1000')
  await page.getByRole('treeitem', { name: /Incoming/ }).click()
  const first = page.getByRole('treeitem').nth(1)
  await expect(first).toContainText('minutes ago')
  await emit(page, 'settings://changed', { 'gitmenu.language': 'ko' })
  await expect(first).toContainText('분 전')
  expect(await builds(page)).toBe(2)
})

test('a folder row of a 10,000-change tree stages exactly the files under it', async ({ page }) => {
  await page.goto('/?window=panel&views=scm&changes=10000')
  await page.getByRole('treeitem').first().waitFor()
  await emit(page, 'settings://changed', { 'scm.defaultViewMode': 'tree' })
  await expect(page.getByRole('treeitem', { name: 'module-0' })).toBeVisible()
  expect(await page.getByRole('treeitem').count()).toBeLessThan(DRAWN)

  await page.getByRole('treeitem', { name: 'module-0' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Stage Changes' }).click()
  await expect
    .poll(() => staged(page))
    .toEqual([
      'packages/pkg-0/src/module-0/file-0.ts',
      'packages/pkg-0/src/module-0/file-2500.ts',
      'packages/pkg-0/src/module-0/file-5000.ts',
      'packages/pkg-0/src/module-0/file-7500.ts',
    ])
})

test('a compacted folder row stages its whole subtree', async ({ page }) => {
  await page.goto('/?window=panel&views=scm&changes=10000')
  await page.getByRole('treeitem').first().waitFor()
  await emit(page, 'settings://changed', { 'scm.defaultViewMode': 'tree' })
  await page.getByRole('treeitem', { name: 'pkg-0/src' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Stage Changes' }).click()
  // Every 50th change lives under packages/pkg-0/, and nothing else may come along
  await expect.poll(async () => (await staged(page)).length).toBe(200)
  expect((await staged(page)).every((path) => path.startsWith('packages/pkg-0/src/'))).toBe(true)
})

test('the ref quick pick draws a screenful of 5,000 refs and still filters and navigates', async ({ page }) => {
  await page.goto('/?window=panel&refs=5000')
  await page.getByRole('button', { name: /Checkout Branch\/Tag/ }).click()
  const options = page.getByRole('option')
  await options.first().waitFor()
  expect(await options.count()).toBeLessThan(DRAWN)
  // The list stays complete for the keyboard and for assistive tech although it is not drawn
  await expect(options.first()).toHaveAttribute('aria-setsize', '5003')

  const input = page.getByRole('combobox')
  for (let i = 0; i < 40; i += 1) await input.press('ArrowDown')
  const highlighted = page.locator('[role=option][data-highlighted]')
  await expect(highlighted).toHaveAttribute('aria-posinset', '41')
  await expect(highlighted).toBeInViewport()
  expect(await options.count()).toBeLessThan(DRAWN)

  await input.fill('feature/issue-4998')
  await expect(options).toHaveCount(1)
  await input.press('Enter')
  await expect.poll(async () => (await lastArgs(page, 'git_exec'))?.args).toEqual(['checkout', '-q', 'feature/issue-4998'])
})

test('Enter picks the highlighted ref after the list was scrolled away from it', async ({ page }) => {
  await page.goto('/?window=panel&refs=5000')
  await page.getByRole('button', { name: /Checkout Branch\/Tag/ }).click()
  await page.getByRole('option').first().waitFor()
  const input = page.getByRole('combobox')
  // The first three rows are Create new branch…; the fourth is the first ref
  for (let i = 0; i < 3; i += 1) await input.press('ArrowDown')
  const highlighted = page.locator('[role=option][data-highlighted]')
  await expect(highlighted).toHaveAttribute('aria-posinset', '4')

  // A wheel scroll moves the rows, not the highlight, so the highlighted row leaves the
  // drawn window — and Enter still has to accept it
  await page.evaluate(() => {
    const list = document.querySelector('[data-slot=command-list]') as HTMLElement
    list.scrollTop = list.scrollHeight
  })
  await expect(highlighted).not.toBeInViewport()
  expect(await page.getByRole('option').count()).toBeLessThan(DRAWN)
  await input.press('Enter')
  await expect.poll(async () => (await lastArgs(page, 'git_exec'))?.args).toEqual(['checkout', '-q', 'feature/issue-0'])
})

test('the quick pick says so when nothing matches', async ({ page }) => {
  await page.goto('/?window=panel&refs=5000')
  await page.getByRole('button', { name: /Checkout Branch\/Tag/ }).click()
  await page.getByRole('option').first().waitFor()
  await page.getByRole('combobox').fill('no-such-ref-anywhere')
  await expect(page.getByRole('option')).toHaveCount(0)
  await expect(page.getByText('No matching commands')).toBeVisible()
})
