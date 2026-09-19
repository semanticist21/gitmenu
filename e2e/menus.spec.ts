import { expect, type Page, test } from '@playwright/test'

declare global {
  interface Window {
    __menuLabels: (menu: string, context: Record<string, unknown>) => string[]
  }
}

async function menuTexts(page: Page) {
  const items = page.locator('[role="menu"] [role="menuitem"]')
  await expect(items.first()).toBeVisible()
  return (await items.allInnerTexts()).map((t) => t.split('\n')[0].trim())
}

test('Source Control file menu follows the registry', async ({ page }) => {
  await page.goto('/?window=panel')
  await page.getByRole('treeitem', { name: /^main\.tsx/ }).click({ button: 'right' })
  const expected = await page.evaluate(() =>
    window.__menuLabels('scm/resourceState/context', { scmProvider: 'git', scmResourceGroup: 'workingTree', scmResourceState: 'worktree' }),
  )
  expect(await menuTexts(page)).toEqual(expected)
})

test('commit menu in Commits follows the registry', async ({ page }) => {
  await page.goto('/?window=panel&views=commits')
  await page.getByRole('treeitem').filter({ hasText: 'fix: retry index.lock' }).first().click({ button: 'right' })
  const expected = await page.evaluate(() => window.__menuLabels('view/item/context', { view: 'gitmenu.views.commits', viewItem: 'gitlens:commit+current' }))
  expect(await menuTexts(page)).toEqual(expected)
})

test('the command palette opens with its shortcut', async ({ page }) => {
  await page.goto('/?window=panel')
  await page.getByRole('tree').first().waitFor()
  await page.keyboard.press('Meta+Shift+P')
  await expect(page.getByRole('dialog')).toBeVisible()
})

declare global {
  interface Window {
    __ipcCalls: string[]
  }
}

test('Escape closes an open menu without hiding the panel', async ({ page }) => {
  await page.goto('/?window=panel')
  await page.getByRole('treeitem', { name: /^main\.tsx/ }).click({ button: 'right' })
  await expect(page.locator('[role="menu"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[role="menu"]')).toHaveCount(0)
  expect(await page.evaluate(() => window.__ipcCalls.filter((c) => c === 'panel_hide').length)).toBe(0)
  await page.getByRole('tree').first().focus()
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => window.__ipcCalls.filter((c) => c === 'panel_hide').length)).toBe(1)
})

test('⌘W closes the active detail tab', async ({ page }) => {
  await page.goto('/#/detail/settings')
  await expect(page.getByRole('tab', { name: /Settings/ })).toBeVisible()
  await page.keyboard.press('Meta+w')
  await expect(page.getByRole('tab', { name: /Settings/ })).toHaveCount(0)
})

test('detach is in the panel menu', async ({ page }) => {
  await page.goto('/?window=panel')
  await page.getByRole('button', { name: 'More' }).click()
  await expect(page.getByRole('menuitem', { name: 'Detach into a Window' })).toBeVisible()
})

test('every header menu opens without a render error', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/?window=panel')
  const header = page.locator('header')
  for (const name of ['Open Project…', 'More']) {
    await header.getByRole('button', { name }).click()
    await expect(page.locator('[role="menu"]')).toBeVisible()
    await page.keyboard.press('Escape')
  }
  expect(errors).toEqual([])
})

test('Sync pulls and then pushes even when the pull refreshes the views', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/?window=panel&slow=1&status=clean')
  await page.getByRole('button', { name: /Sync Changes/ }).click()
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __gitExec?: string[][] }).__gitExec?.map((a) => a[0]) ?? [])).toEqual(['pull', 'push'])
  await expect(page.getByText('CancelledError')).toHaveCount(0)
  expect(errors).toEqual([])
})
