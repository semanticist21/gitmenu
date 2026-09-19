// Keyboard focus lands only on visible controls and moves through tabs as in VS Code.
import { expect, test } from '@playwright/test'

test('Left/Right move between project tabs and open them', async ({ page }) => {
  await page.goto('/?window=panel')
  await page.getByRole('tab', { name: /demo/ }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: /other/ })).toBeFocused()
  const activated = await page.evaluate(() => {
    const w = window as unknown as { __ipcCalls: string[] }
    return w.__ipcCalls.includes('project_activate')
  })
  expect(activated).toBe(true)
})

test('a diff gutter button shows while it has keyboard focus', async ({ page }) => {
  await page.goto('/#/detail/diff?repo=%2FUsers%2Fme%2Fcode%2Fgitmenu&path=src%2Fmain.tsx&group=workingTree')
  const stage = page.getByRole('button', { name: 'Stage Block' }).first()
  await stage.focus()
  await expect.poll(() => stage.evaluate((el) => getComputedStyle(el.closest('.absolute.left-0') as Element).opacity)).toBe('1')
})
