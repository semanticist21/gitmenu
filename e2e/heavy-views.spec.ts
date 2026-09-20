// The detail window's heavy views stay bounded on a repository that is far bigger than the
// mock's default one: a commit touching 20,000 files, a diff with 10,000 hunks, and the whole
// command table. Each check is structural (rendered rows, DOM nodes, IPC calls); timings live
// in the measurement scripts, not here.
import { expect, type Page, test } from '@playwright/test'

test.use({ viewport: { width: 1200, height: 800 } })

const repo = encodeURIComponent('/Users/me/code/demo')
const nodes = (page: Page) => page.evaluate(() => document.getElementsByTagName('*').length)
const ipcCalls = (page: Page) => page.evaluate(() => (window as unknown as { __ipcCalls: string[] }).__ipcCalls)

test('Commit Details renders a page of a 20,000-file commit, not all of it', async ({ page }) => {
  await page.goto(`/?files=20000#/detail/graph?repo=${repo}`)
  await page.getByRole('grid', { name: 'Commit Graph' }).waitFor()
  await page.locator('[role=row][aria-rowindex="3"]').click()

  const files = page.getByRole('tree', { name: '20000 files changed' })
  await expect(files).toBeVisible()
  // The header still names every file, while only a screenful of rows exists
  const rows = files.getByRole('treeitem')
  await expect.poll(() => rows.count()).toBeGreaterThan(0)
  expect(await rows.count()).toBeLessThan(60)
  expect(await nodes(page)).toBeLessThan(3000)

  // Scrolling the pane brings later files in without growing the list
  await files.evaluate((el) => {
    const scroller = el.parentElement as HTMLElement
    scroller.scrollTop = scroller.scrollHeight / 2
  })
  await expect.poll(() => rows.first().getAttribute('title')).not.toContain('module-00000')
  expect(await rows.count()).toBeLessThan(60)

  // A row still opens its diff
  await rows.first().click()
  expect(await ipcCalls(page)).toContain('detail_open')
})

test('the diff overview ruler draws its marks instead of building one element per hunk', async ({ page }) => {
  await page.goto(`/?lines=20000&hunks=10000#/detail/diff?repo=${repo}&path=${encodeURIComponent('notes/todo.txt')}&group=workingTree`)
  await page.getByRole('document', { name: 'notes/todo.txt' }).waitFor()

  await expect(page.locator('canvas')).toHaveCount(1)
  expect(await nodes(page)).toBeLessThan(2500)
  // Painted, not blank: the canvas holds the removed and added marks
  const drawn = await page.locator('canvas').evaluate((el: HTMLCanvasElement) => {
    const data = el.getContext('2d')?.getImageData(0, 0, el.width, el.height).data
    let painted = 0
    for (let i = 3; data && i < data.length; i += 4) if (data[i] > 0) painted++
    return painted
  })
  expect(drawn).toBeGreaterThan(0)

  // Clicking the ruler still scrolls the diff to that place
  const box = (await page.locator('canvas').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.75)
  await expect.poll(() => page.getByRole('document', { name: 'notes/todo.txt' }).evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
})

test('Keyboard Shortcuts renders a screenful of rows and still searches and navigates', async ({ page }) => {
  await page.goto('/#/detail/keyboard-shortcuts')
  const table = page.getByRole('grid', { name: 'Keyboard Shortcuts' })
  await table.waitFor()
  const rows = table.getByRole('row').and(page.locator('[data-row]'))
  await expect.poll(() => rows.count()).toBeGreaterThan(0)
  const rendered = await rows.count()
  expect(rendered).toBeLessThan(60)
  // Far more rows exist than are rendered: the table scrolls well past the viewport
  expect(await table.evaluate((el) => el.scrollHeight)).toBeGreaterThan(rendered * 24 + 200)

  // A command that is not in the first screenful is still findable
  await page.getByRole('textbox', { name: /search/i }).fill('Show Commit Graph')
  await expect(table.getByRole('row').filter({ hasText: 'Show Commit Graph' })).toHaveCount(1)

  // Arrow keys move the selection through the virtualized rows
  await page.getByRole('textbox', { name: /search/i }).fill('')
  await table.click({ position: { x: 200, y: 60 } })
  await page.keyboard.press('ArrowDown')
  await expect(table.locator('[data-selected]')).toHaveCount(1)
  expect(await rows.count()).toBeLessThan(60)
})
