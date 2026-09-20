// Opening a folder that holds many repositories: the tab shows before the scan finishes, the
// repositories stream in without another `projects_list`, and the list stays virtualized.
import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    __ipcCalls: string[]
  }
}

test('the Repositories list only renders the rows it shows', async ({ page }) => {
  await page.goto('/?window=panel&repos=300')
  const options = page.getByRole('option')
  await expect(options.first()).toBeVisible()
  const rendered = await options.count()
  expect(rendered).toBeGreaterThan(0)
  expect(rendered).toBeLessThan(40)
})

test('a folder still being scanned shows progress and fills in without another projects_list', async ({ page }) => {
  await page.goto('/?window=panel&repos=20&scanning=1')
  await expect(page.getByRole('progressbar').first()).toBeVisible()
  await expect(page.getByRole('option').first()).toBeVisible()
  // Every repository arrived, and the progress bar went away with `scanning`
  await expect.poll(() => page.getByRole('option').count()).toBeGreaterThan(5)
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  // The event carries the list, so the streamed results cost no extra IPC
  const listCalls = await page.evaluate(() => window.__ipcCalls.filter((c) => c === 'projects_list').length)
  expect(listCalls).toBe(1)
})

test('a truncated scan says so under the Repositories header, in full', async ({ page }) => {
  await page.goto('/?window=panel&repos=12&truncated=1')
  const note = page.getByRole('status').filter({ hasText: /git\.repositoryScanIgnoredFolders/ })
  await expect(note).toBeVisible()
  // The advice is the only one the user gets, so none of it may be cut off
  const clipped = await note.evaluate((el) => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight)
  expect(clipped).toBe(false)
})

test('a scan shows progress before it has found its first repository', async ({ page }) => {
  await page.goto('/?window=panel&repos=0&scanning=1')
  await expect(page.getByRole('progressbar')).toHaveCount(1)
  // "No repository" waits for the scan to finish, so nothing else may claim the panel either
  await expect(page.getByRole('button', { name: /Initialize Repository/i })).toHaveCount(0)
})
