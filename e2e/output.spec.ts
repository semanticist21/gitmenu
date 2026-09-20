// Operations and the Git output (mocked backend, see src/dev/mock.ts).
import { expect, type Page, test } from '@playwright/test'

type TestWindow = Window & {
  __emit: (event: string, payload: unknown) => Promise<void>
  __logEntry: (entry: Record<string, unknown>) => void
}

const navigate = (page: Page, route: string) => page.evaluate((r) => (window as unknown as TestWindow).__emit('detail://navigate', r), route)

test('Stage All and Unstage stay enabled while a non-blocking operation runs', async ({ page }) => {
  await page.goto('/?window=panel&op=stage')
  await page.waitForTimeout(500)
  await page.getByRole('treeitem', { name: /^Changes/ }).hover()
  await expect(page.getByRole('button', { name: 'Stage All Changes' })).toBeEnabled()
  await page.getByRole('treeitem', { name: /^usage\.md/ }).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Unstage Changes' })).toBeEnabled()
})

test('git commands are disabled while a blocking operation runs', async ({ page }) => {
  await page.goto('/?window=panel&op=pull')
  await page.waitForTimeout(500)
  await page.getByRole('treeitem', { name: /^Changes/ }).hover()
  await expect(page.getByRole('button', { name: 'Stage All Changes' })).toBeDisabled()
})

test('the Git output shows commands that ran while its tab was closed', async ({ page }) => {
  await page.goto('/#/detail/output')
  const log = page.getByRole('log')
  await expect(log).toContainText('> git pull --tags origin main')
  await navigate(page, '/detail/settings')
  await expect(log).toHaveCount(0)
  await page.evaluate(() =>
    (window as unknown as TestWindow).__logEntry({ op: 10, time: Date.now(), repo: '/r', args: ['push', 'origin', 'main'], durationMs: 5, code: 0, cancelled: false, stderr: '' }),
  )
  await navigate(page, '/detail/output')
  await expect(page.getByRole('log')).toContainText('> git push origin main')
})

test('a new command appends to the Git output instead of reading the whole log again', async ({ page }) => {
  await page.goto('/#/detail/output')
  const log = page.getByRole('log')
  await expect(log).toContainText('> git pull --tags origin main')
  const reads = () => page.evaluate(() => (window as unknown as { __ipcCalls: string[] }).__ipcCalls.filter((c) => c === 'git_log_entries').length)
  const before = await reads()
  await page.evaluate(() =>
    (window as unknown as TestWindow).__logEntry({ op: 10, time: Date.now(), repo: '/r', args: ['push', 'origin', 'main'], durationMs: 5, code: 0, cancelled: false, stderr: '' }),
  )
  await expect(log).toContainText('> git push origin main')
  expect(await reads()).toBe(before)
})

test('a full Git output renders only the lines on screen', async ({ page }) => {
  await page.goto('/?log=500#/detail/output')
  const log = page.getByRole('log')
  // The log opens at its end, on the newest command
  await expect(log).toContainText('> git pull --tags origin main')
  const shape = await page.evaluate(() => {
    const el = document.querySelector('[role=log]') as HTMLElement
    return { rows: el.querySelectorAll(':scope > div > div').length, height: el.scrollHeight, elements: document.querySelectorAll('*').length }
  })
  // 500 fetches of six stderr lines are 3,500 lines, and every one can be scrolled to...
  expect(shape.height).toBeGreaterThan(3500 * 18)
  // ...but only the ones on screen are rendered, so the window stays a small document
  expect(shape.rows).toBeLessThanOrEqual(80)
  expect(shape.elements).toBeLessThan(2000)
})

test('Show Command Output opens the failed command and its stderr', async ({ page }) => {
  await page.goto('/?window=panel&toast=error')
  await page.getByRole('button', { name: 'Show Command Output' }).click()
  const route = await page.evaluate(() => {
    const w = window as unknown as { __ipcCalls: string[]; __ipcArgs: { route?: string }[] }
    return w.__ipcArgs[w.__ipcCalls.lastIndexOf('detail_open')].route
  })
  expect(route).toContain('failure=launch-9')
  await page.goto(`/#${route}`)
  await expect(page.getByRole('log')).toContainText('fatal: Need to specify how to reconcile divergent branches.')
  await navigate(page, '/detail/output?failure=earlier-launch-3')
  await expect(page.getByRole('log')).toContainText('no longer available')
})

test('a route whose title has an encoded & opens intact in a new detail window', async ({ page }) => {
  await page.goto(`/#/detail/output?${new URLSearchParams({ failure: 'launch-9', title: 'Pull & Push' })}`)
  await expect(page.getByRole('tab', { name: 'Pull & Push' })).toBeVisible()
  await expect(page.getByRole('log')).toContainText('fatal: Need to specify')
})
