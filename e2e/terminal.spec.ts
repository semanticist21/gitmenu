// Terminal tabs in the detail window (mocked shell, see src/dev/mock.ts).
import { expect, type Page, test } from '@playwright/test'

type TestWindow = Window & {
  __ipcCalls: string[]
  __ipcArgs: Record<string, unknown>[]
  __emit: (event: string, payload: unknown) => Promise<void>
  __terminalOutput: (key: string, text: string) => void
  __terminalBusy: Set<string>
  __clipboard: string
}

/** One argument of every call to `command`, in order */
const argsOf = (page: Page, command: string, arg = 'key') =>
  page.evaluate(
    ([cmd, name]) => {
      const w = window as unknown as TestWindow
      return w.__ipcCalls.flatMap((c, i) => (c === cmd ? [w.__ipcArgs[i][name] as string | null] : []))
    },
    [command, arg],
  )
const keysOf = async (page: Page, command: string) => (await argsOf(page, command)) as string[]
const called = (page: Page, command: string) =>
  page.evaluate((cmd) => (window as unknown as TestWindow).__ipcCalls.filter((c) => c === cmd).length, command)
const print = (page: Page, key: string, text: string) =>
  page.evaluate(([k, s]) => (window as unknown as TestWindow).__terminalOutput(k, s), [key, text] as const)
/** Prints a mode change and waits until xterm has taken it (it parses output asynchronously). */
async function setMode(page: Page, key: string, sequence: string, marker: string) {
  await print(page, key, sequence + marker)
  await expect(page.locator('.xterm-rows')).toContainText(marker)
}
const emit = (page: Page, event: string, payload: unknown) =>
  page.evaluate(([e, p]) => (window as unknown as TestWindow).__emit(e, p), [event, payload] as const)
const setBusy = (page: Page, key: string) => page.evaluate((k) => (window as unknown as TestWindow).__terminalBusy.add(k), key)

// The detail window's size, so a tab's close button isn't at the edge of a scrolled strip
test.use({ viewport: { width: 900, height: 600 } })

// Without WebGL the terminal falls back to xterm's DOM renderer, whose rows the tests can read
test.beforeEach(async ({ page }, info) => {
  if (info.title.includes('WebGL')) return
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return type === 'webgl2' ? null : (getContext as (...args: unknown[]) => unknown).call(this, type, ...rest)
    } as typeof getContext
  })
})

/** Opens a terminal next to the Settings tab; returns its key once the prompt shows. */
async function openTerminal(page: Page) {
  await page.goto('/#/detail/settings')
  await page.getByRole('button', { name: 'New Terminal' }).click()
  await expect(page.locator('.xterm-rows')).toContainText('$')
  return (await keysOf(page, 'terminal_open'))[0]
}

test('New Terminal opens a shell that keeps its screen across tab switches, and ⌘W ends it', async ({ page }) => {
  await page.goto('/#/detail/settings')
  await page.getByRole('button', { name: 'New Terminal' }).click()
  const tab = page.getByRole('tab', { name: 'zsh' })
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  const screen = page.locator('.xterm-rows')
  await expect(screen).toContainText('$')
  // The new terminal has the keyboard
  await page.keyboard.type('echo hi')
  await expect(screen).toContainText('$ echo hi')
  // Keys the shell needs get to it, not to the app's shortcuts
  await page.keyboard.press('Control+c')
  await expect.poll(() => argsOf(page, 'terminal_write', 'data')).toContain('\x03')

  await page.getByRole('tab', { name: 'Settings' }).click()
  await expect(screen).toHaveCount(0)
  // The shell keeps printing to the terminal while its tab is away
  const opened = await keysOf(page, 'terminal_open')
  await print(page, opened[0], ' while away')
  await tab.click()
  await expect(screen).toContainText('$ echo hi while away')
  // Coming back shows the same session, still connected: no second shell, no second channel
  expect(await keysOf(page, 'terminal_open')).toEqual(opened)
  expect(opened).toHaveLength(1)
  // It starts with LANG for the UI language
  expect(await argsOf(page, 'terminal_open', 'locale')).toEqual(['en'])

  // A shell running nothing closes without asking
  await page.keyboard.press('Meta+w')
  await expect(tab).toHaveCount(0)
  await expect.poll(() => keysOf(page, 'terminal_kill')).toEqual([opened[0]])
})

test('⌃⇧` starts in the active tab\'s repository, also from a terminal, and a shell that exits closes its tab', async ({ page }) => {
  const repo = '/Users/me/code/demo'
  await page.goto(`/#/detail/diff?${new URLSearchParams({ repo, path: 'src/main.tsx', group: 'workingTree' })}`)
  const diff = page.getByRole('tab', { name: 'main.tsx' })
  await expect(diff).toBeVisible()
  await page.keyboard.press('Control+Shift+Backquote')
  const tabs = page.getByRole('tab', { name: 'zsh' })
  await expect(tabs).toHaveCount(1)
  expect(await argsOf(page, 'terminal_open', 'cwd')).toEqual([repo])
  // In a focused terminal the shortcut still opens another one (VS Code's commandsToSkipShell)
  await expect(page.locator('.xterm-rows')).toContainText('$')
  await page.keyboard.press('Control+Shift+Backquote')
  await expect(tabs).toHaveCount(2)
  await expect.poll(() => keysOf(page, 'terminal_open')).toHaveLength(2)
  const [first, second] = await keysOf(page, 'terminal_open')
  // Past the launch: these shells ran, rather than failed to start
  await page.waitForTimeout(600)

  // Exit code 0 closes the tab quietly; another code also says so (terminal.integrated.showExitAlert)
  await emit(page, 'terminal://exit', { key: second, code: 0 })
  await expect(tabs).toHaveCount(1)
  await emit(page, 'terminal://exit', { key: first, code: 2 })
  await expect(tabs).toHaveCount(0)
  await expect(page.getByText('The terminal process terminated with exit code: 2.')).toBeVisible()
  await expect(page.getByText(/exit code: 0/)).toHaveCount(0)
  await expect(diff).toHaveAttribute('aria-selected', 'true')
  // Their shells are gone already
  expect(await keysOf(page, 'terminal_kill')).toEqual([])
})

test('a shell that fails to launch in the only tab keeps the window open until its alert goes', async ({ page }) => {
  await page.goto('/#/detail/terminal?key=only')
  await expect(page.locator('.xterm-rows')).toContainText('$')
  await emit(page, 'terminal://exit', { key: 'only', code: 1 })
  await expect(page.getByRole('tab')).toHaveCount(0)
  const alert = page.getByText('The terminal process failed to launch (exit code: 1).')
  await expect(alert).toBeVisible()
  expect(await called(page, 'plugin:window|close')).toBe(0)
  await alert.hover()
  await page.getByRole('button', { name: 'Clear Notification' }).click()
  await expect.poll(() => called(page, 'plugin:window|close')).toBe(1)
})

test('closing a terminal that runs something asks first: ⌘W, the close button and the window', async ({ page }) => {
  const key = await openTerminal(page)
  await setBusy(page, key)
  const tab = page.getByRole('tab', { name: 'zsh' })
  const question = page.getByText('Do you want to terminate running processes?')

  const terminate = page.getByRole('button', { name: 'Terminate' })
  await page.keyboard.press('Meta+w')
  await expect(question).toBeVisible()
  await expect(page.getByText('Closing will terminate the running processes in this terminal.')).toBeVisible()
  await expect(terminate).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(question).toHaveCount(0)
  await expect(tab).toHaveCount(1)
  expect(await keysOf(page, 'terminal_kill')).toEqual([])

  // Closing the window asks too, and stays open on Cancel
  await emit(page, 'tauri://close-requested', null)
  await expect(question).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).filter({ hasText: 'Cancel' }).click()
  await expect(question).toHaveCount(0)
  expect(await called(page, 'plugin:window|destroy')).toBe(0)
  await emit(page, 'tauri://close-requested', null)
  await terminate.click()
  await expect.poll(() => called(page, 'plugin:window|destroy')).toBe(1)

  await tab.getByRole('button', { name: 'Close Editor' }).click()
  await terminate.click()
  await expect(tab).toHaveCount(0)
  await expect.poll(() => keysOf(page, 'terminal_kill')).toEqual([key])
})

test('⌘V drops one trailing newline and asks before pasting lines, unless the shell takes bracketed paste', async ({ page }) => {
  const key = await openTerminal(page)
  const writes = () => argsOf(page, 'terminal_write', 'data')
  const paste = async (text: string) => {
    await page.evaluate((s) => ((window as unknown as TestWindow).__clipboard = s), text)
    await page.keyboard.press('Meta+v')
  }

  await paste('echo hi\n')
  await expect.poll(writes).toEqual(['echo hi'])

  await paste('a\nb\nc\nd')
  await expect(page.getByText('Are you sure you want to paste 4 lines of text into the terminal?')).toBeVisible()
  await expect(page.getByText(/^Preview:\na\nb\nc\n…$/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Paste', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await paste('a\nb\nc\nd')
  await page.getByRole('button', { name: 'Paste as one line' }).click()
  await expect.poll(writes).toEqual(['echo hi', 'abcd'])
  // The dialog gave the keyboard back to the terminal
  await page.keyboard.type('!')
  await expect.poll(writes).toEqual(['echo hi', 'abcd', '!'])

  await setMode(page, key, '\x1b[?2004h', '[bracketed]')
  await paste('x\ny\n')
  await expect.poll(writes).toEqual(['echo hi', 'abcd', '!', '\x1b[200~x\ry\r\x1b[201~'])
})

test('macOS editing and scroll keys, and mouse reports in the default encoding', async ({ page }) => {
  const key = await openTerminal(page)
  const writes = () => argsOf(page, 'terminal_write', 'data')
  const sent: string[] = []
  for (const [press, data] of [
    ['Alt+ArrowLeft', '\x1bb'],
    ['Alt+ArrowRight', '\x1bf'],
    ['Alt+ArrowUp', '\x1b[1;5A'],
    ['Alt+ArrowDown', '\x1b[1;5B'],
    ['Control+Shift+Digit2', '\x00'],
    ['Control+Shift+Digit6', '\x1e'],
  ]) {
    await page.keyboard.press(press)
    sent.push(data)
    await expect.poll(writes).toEqual(sent)
  }

  // In the normal buffer PageUp scrolls the terminal; a full-screen program gets it
  await page.keyboard.press('PageUp')
  await page.keyboard.press('Meta+Home')
  await setMode(page, key, '\x1b[?1049h', '[alternate]')
  await page.keyboard.press('PageUp')
  sent.push('\x1b[5~')
  await expect.poll(writes).toEqual(sent)

  // X10 mouse reports (mode 1000 without 1006) go out as bytes, not text
  await setMode(page, key, '\x1b[?1000h', '[mouse]')
  await page.locator('.xterm-screen').click({ position: { x: 40, y: 20 } })
  await expect.poll(async () => ((await argsOf(page, 'terminal_write_binary', 'data')) as unknown as number[][]).length).toBe(2)
  const [press] = (await argsOf(page, 'terminal_write_binary', 'data')) as unknown as number[][]
  expect(press.slice(0, 4)).toEqual([0x1b, 0x5b, 0x4d, 0x20])
})

test('the tab shows the process in the terminal\'s foreground', async ({ page }) => {
  const key = await openTerminal(page)
  await emit(page, 'terminal://title', { key, title: 'vim' })
  await expect(page.getByRole('tab', { name: 'vim' })).toHaveAttribute('aria-selected', 'true')
  await emit(page, 'terminal://title', { key, title: 'zsh' })
  await expect(page.getByRole('tab', { name: 'zsh' })).toBeVisible()
})

test('the keyboard comes back to the terminal after the palette and a click on its tab', async ({ page }) => {
  await openTerminal(page)
  const writes = () => argsOf(page, 'terminal_write', 'data')
  await page.keyboard.press('Meta+Shift+p')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.type('x')
  await expect.poll(writes).toEqual(['x'])

  await page.getByRole('tab', { name: 'zsh' }).click()
  await page.keyboard.type('y')
  await expect.poll(writes).toEqual(['x', 'y'])
})

test('the terminal draws with WebGL when it can, like VS Code\'s GPU renderer', async ({ page }) => {
  await page.goto('/#/detail/settings')
  await page.getByRole('button', { name: 'New Terminal' }).click()
  await expect(page.locator('.xterm-screen canvas')).not.toHaveCount(0)
  await expect(page.locator('.xterm-rows')).toHaveCount(0)
  // Typing still reaches the shell
  await page.keyboard.type('ls')
  await expect.poll(() => argsOf(page, 'terminal_write', 'data')).toEqual(['l', 's'])
})

test('New Terminal from the panel opens it in the detail window', async ({ page }) => {
  await page.goto('/?window=panel')
  await page.getByRole('tree').first().waitFor()
  await page.keyboard.press('Control+Shift+Backquote')
  const route = await page.evaluate(() => {
    const w = window as unknown as TestWindow
    return w.__ipcArgs[w.__ipcCalls.lastIndexOf('detail_open')]?.route as string | undefined
  })
  expect(route).toMatch(/^\/detail\/terminal\?key=[0-9a-f-]{36}$/)
})
