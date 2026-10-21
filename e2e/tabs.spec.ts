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

test('many tabs and long file names stay within the detail window', async ({ page }) => {
  await page.goto('/#/detail/settings')
  await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toBeVisible()

  for (let i = 0; i < 20; i++) {
    const path = `src/${'long-file-name-'.repeat(10)}${i}.tsx`
    await page.evaluate(
      (route) => (window as unknown as { __emit: (event: string, payload: string) => Promise<void> }).__emit('detail://navigate', route),
      diffUrl(path).slice(1),
    )
    await expect(page.getByRole('tab')).toHaveCount(i + 2)
  }

  const strip = page.getByRole('tablist')
  const last = strip.getByRole('tab').last()
  await expect.poll(() => strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  for (const width of [900, 640, 1280]) {
    await page.setViewportSize({ width, height: 600 })
    await expect.poll(() => page.locator('header').evaluate((el) => el.getBoundingClientRect().width)).toBe(width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await expect.poll(() => last.evaluate((el) => el.getBoundingClientRect().width <= el.parentElement!.clientWidth)).toBe(true)
    await expect(page.getByRole('button', { name: 'New Terminal' })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Keep on Top', exact: true })).toBeInViewport()
  }

  await last.focus()
  await expect(last.getByRole('button', { name: 'Close Editor' })).toBeInViewport()
  await page.keyboard.press('Home')
  await expect(strip.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(strip.getByRole('tab', { name: 'Settings', exact: true })).toBeInViewport()
  await page.keyboard.press('End')
  await expect(last).toHaveAttribute('aria-selected', 'true')
  await expect(last.getByRole('button', { name: 'Close Editor' })).toBeInViewport()
  await last.getByRole('button', { name: 'Close Editor' }).click()
  await expect(page.getByRole('tab')).toHaveCount(20)
})
