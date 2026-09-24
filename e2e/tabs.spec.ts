// Hidden editor tabs stay mounted (the most recent MOUNTED_TAB_CAP), so coming back to a tab
// shows it as it was — same scroll, same data — without reading the diff again, the way VS Code
// keeps editors alive. Terminals are the exception: their screen lives in the session, so only
// the active one is mounted.
import { expect, type Page, test } from '@playwright/test'

test.use({ viewport: { width: 900, height: 600 } })

const repo = encodeURIComponent('/Users/me/code/gitmenu')
const diffUrl = (path: string) => `#/detail/diff?repo=${repo}&path=${encodeURIComponent(path)}&group=workingTree`

const called = (page: Page, command: string) =>
  page.evaluate((cmd) => (window as unknown as { __ipcCalls: string[] }).__ipcCalls.filter((c) => c === cmd).length, command)

test('a diff tab keeps its scroll and data across switches, without refetching', async ({ page }) => {
  await page.goto(`/${diffUrl('src/main.tsx')}`)
  // An attribute selector, on purpose: hidden editors are out of the accessibility tree, and the
  // whole point is to assert the editor is still in the DOM while its tab is away
  const doc = page.locator('[role="document"][aria-label="src/main.tsx"]')
  await doc.waitFor()

  // Scroll the diff somewhere distinctive
  await doc.evaluate((el) => {
    el.scrollTop = el.scrollHeight / 2
  })
  await expect.poll(() => doc.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  const scrolled = await doc.evaluate((el) => el.scrollTop)
  const reads = await called(page, 'repo_diff')

  // Opening a second tab hides the diff's editor inside a hidden wrapper, without unmounting it
  await page.getByRole('button', { name: 'New Terminal' }).click()
  await expect(page.getByRole('tab', { name: /zsh/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('main > div.invisible')).toHaveCount(1)
  await expect(doc).toHaveCount(1)
  await expect(doc).not.toBeVisible()

  // Coming back shows the editor as it was: same scroll, and repo_diff was not called again
  await page.getByRole('tab', { name: /main\.tsx/ }).click()
  await expect(doc).toBeVisible()
  await expect.poll(() => doc.evaluate((el) => el.scrollTop)).toBe(scrolled)
  expect(await called(page, 'repo_diff')).toBe(reads)
})
