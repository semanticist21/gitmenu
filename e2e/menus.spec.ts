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
  const expected = await page.evaluate(() => window.__menuLabels('view/item/context', { view: 'gitside.views.commits', viewItem: 'gitlens:commit+current' }))
  expect(await menuTexts(page)).toEqual(expected)
})

test('the command palette opens with its shortcut', async ({ page }) => {
  await page.goto('/?window=panel')
  await page.getByRole('tree').first().waitFor()
  await page.keyboard.press('Meta+Shift+P')
  await expect(page.getByRole('dialog')).toBeVisible()
})
