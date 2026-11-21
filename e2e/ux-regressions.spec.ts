import { expect, type Page, test } from '@playwright/test'

const root = '/Users/me/code/demo'
const repo = `repo=${encodeURIComponent(root)}`

async function overrideIpc(page: Page, responses: Record<string, unknown>, delayCommand?: string) {
  await page.addInitScript(({ responses, delayCommand }) => {
    type Invoke = (command: string, args?: unknown, options?: unknown) => Promise<unknown>
    let invoke: Invoke
    const internals = Object.defineProperty({}, 'invoke', {
      get: () => invoke,
      set: (original: Invoke) => {
        invoke = async (command, args, options) => {
          if (command === delayCommand) {
            await new Promise<void>((resolve, reject) => {
              Object.assign(window, { __releaseIpc: (error?: string) => (error ? reject(new Error(error)) : resolve()) })
            })
          }
          return command in responses ? responses[command] : original(command, args, options)
        }
      },
    })
    Object.assign(window, { __TAURI_INTERNALS__: internals })
  }, { responses, delayCommand })
}

async function calls(page: Page, name: string) {
  return page.evaluate((name) => {
    const w = window as unknown as { __ipcCalls: string[]; __ipcArgs: Record<string, unknown>[] }
    return w.__ipcArgs.filter((_, i) => w.__ipcCalls[i] === name)
  }, name)
}

test('Stage All Merge confirms files with remaining conflict markers', async ({ page }) => {
  await overrideIpc(page, { read_text_file: { text: '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n', markerSize: 7 } })
  await page.goto('/?window=panel&views=scm&status=merge')
  const merge = page.getByRole('treeitem', { name: /^Merge Changes,/ })
  await merge.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Stage All Merge Changes' }).click()
  await expect(page.getByText('Are you sure you want to stage app.ts with merge conflicts?')).toBeVisible()
  await page.keyboard.press('Escape')
  expect(await calls(page, 'git_stage')).toEqual([])
  await merge.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Stage All Merge Changes' }).click()
  await page.getByRole('button', { name: 'Stage Changes', exact: true }).click()
  await expect.poll(() => calls(page, 'git_stage')).toMatchObject([{ root, paths: ['src/app.ts'] }])
})

test('merging from a graph branch label passes the selected full ref', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 })
  await page.goto(`/#/detail/graph?${repo}`)
  await page.getByTitle('feature/tray', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Merge Branch into Current Branch/ }).click()
  await page.getByText('Fast-forward Merge', { exact: true }).click()
  await expect.poll(() => calls(page, 'git_exec')).toMatchObject([{ root, args: ['merge', '--ff-only', 'refs/heads/feature/tray'] }])
})

test('Open File History sets the selected file before revealing the pane', async ({ page }) => {
  await page.goto('/?window=panel&views=scm,commits')
  await page.getByRole('treeitem', { name: /^README\.md/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open File History' }).click()
  const history = page.getByRole('tree', { name: 'File History', exact: true })
  await expect(history.getByRole('treeitem', { name: 'README.md', exact: true })).toBeVisible()
  await expect.poll(() => calls(page, 'repo_log')).toEqual(expect.arrayContaining([expect.objectContaining({ query: expect.objectContaining({ path: 'README.md' }) })]))
})

test('Reset Setting updates the displayed value and blur does not save it again', async ({ page }) => {
  await overrideIpc(page, { settings_get: { 'git.defaultBranchName': 'trunk' } })
  await page.setViewportSize({ width: 900, height: 600 })
  await page.goto('/#/detail/settings')
  await page.getByRole('textbox', { name: /Search settings/i }).fill('default branch name')
  const value = page.getByRole('textbox', { name: 'Default Branch Name' })
  await expect(value).toHaveValue('trunk')
  await page.getByRole('button', { name: 'Reset Setting', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Reset Setting', exact: true }).click()
  await expect(value).toHaveValue('main')
  await value.focus()
  await value.blur()
  expect(await calls(page, 'settings_set')).toMatchObject([{ key: 'git.defaultBranchName', value: null }])
})

test('Record Keys captures a shortcut immediately after clicking it', async ({ page }) => {
  await page.goto('/#/detail/keyboard-shortcuts')
  await page.getByRole('button', { name: 'Record Keys' }).click()
  const search = page.getByRole('textbox', { name: /Search keybindings/i })
  await expect(search).toBeFocused()
  await page.keyboard.press('Meta+Shift+P')
  await expect(search).toHaveValue('"shift+cmd+p"')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('Initialize Repository uses the configured default branch', async ({ page }) => {
  await overrideIpc(page, { settings_get: { 'git.defaultBranchName': 'trunk' } })
  await page.goto('/?window=panel&project=norepo')
  await page.getByRole('button', { name: 'Initialize Repository' }).click()
  await expect.poll(() => calls(page, 'project_init_repo')).toMatchObject([{ id: root, branch: 'trunk' }])
})

test('Open Recent re-reads the list when opening the project menu', async ({ page }) => {
  await page.goto('/?window=panel')
  const open = page.locator('header').getByRole('button', { name: 'Open Project…' })
  await open.click()
  await expect(page.getByRole('menuitem', { name: /archived/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    type Invoke = (command: string, args?: unknown, options?: unknown) => Promise<unknown>
    const { __TAURI_INTERNALS__: internals } = window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } }
    const original = internals.invoke
    internals.invoke = async (command, args, options) =>
      command === 'projects_recent' ? ['/Users/me/code/newly-closed'] : original(command, args, options)
  })
  await open.click()
  await expect(page.getByRole('menuitem', { name: /newly-closed/ })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /archived/ })).toHaveCount(0)
})

test('explicit Commit and Commit & Sync override a default of Push', async ({ page }) => {
  await overrideIpc(page, { settings_get: { 'git.postCommitCommand': 'push' } })
  await page.goto('/?window=panel&views=scm')
  const scm = page.getByRole('region', { name: 'Source Control', exact: true })
  const message = scm.getByRole('textbox', { name: 'Message', exact: true })
  const main = page.getByRole('button', { name: 'Commit & Push', exact: true })
  const more = scm.getByRole('group').filter({ has: main }).getByRole('button', { name: 'More Actions...' })
  await expect(main).toBeVisible()
  await message.fill('local only')
  await more.click()
  await page.getByRole('menuitem', { name: 'Commit', exact: true }).click()
  await expect(message).toHaveValue('')
  expect(await calls(page, 'git_commit')).toMatchObject([{ message: 'local only' }])

  await message.fill('sync this')
  await more.click()
  await page.getByRole('menuitem', { name: 'Commit & Sync', exact: true }).click()
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(async () => (await calls(page, 'git_exec')).map(({ args }) => (args as string[])[0])).toEqual(['pull', 'push'])
})

test('smart commit leaves hidden untracked files out of the commit', async ({ page }) => {
  await overrideIpc(page, {
    settings_get: { 'git.untrackedChanges': 'hidden', 'git.enableSmartCommit': true },
    repo_status: {
      head: { branch: 'main', commit: 'a'.repeat(40), detached: false },
      upstream: null, operation: null, merge: [], index: [], remotes: [], total: 2, hitLimit: false,
      workingTree: [{ path: 'tracked.txt', status: 'modified' }],
      untracked: [{ path: 'hidden.txt', status: 'untracked' }],
    },
  })
  await page.goto('/?window=panel&views=scm')
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('tracked update')
  await page.getByRole('group').getByRole('button', { name: 'Commit', exact: true }).click()
  await expect.poll(() => calls(page, 'git_commit')).toMatchObject([{ message: 'tracked update' }])
  expect(await calls(page, 'git_stage')).toMatchObject([{ paths: ['tracked.txt'] }])
})

test('Changes shows loading before files, then displays the actual file list', async ({ page }) => {
  await overrideIpc(page, {}, 'repo_status')
  await page.goto(`/#/detail/changes?${repo}&group=workingTree`)
  await expect(page.getByRole('progressbar').first()).toBeVisible()
  await expect(page.getByText('No changes.', { exact: true })).toHaveCount(0)
  await page.evaluate(() => (window as unknown as { __releaseIpc: () => void }).__releaseIpc())
  await expect(page.getByRole('listbox', { name: 'Changes' }).getByRole('option', { name: /main\.tsx/ })).toBeVisible()
})

test('Changes reports a status failure without claiming a clean working tree', async ({ page }) => {
  await overrideIpc(page, {}, 'repo_status')
  await page.goto(`/#/detail/changes?${repo}&group=workingTree`)
  await expect(page.getByRole('progressbar').first()).toBeVisible()
  await page.evaluate(() => (window as unknown as { __releaseIpc: (error: string) => void }).__releaseIpc('Repository is unavailable'))
  await expect(page.getByText('Repository is unavailable', { exact: true })).toBeVisible()
  await expect(page.getByText('No changes.', { exact: true })).toHaveCount(0)
})

test('scrolling reaches the last view when every pane is expanded', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 400 })
  await page.goto('/?window=panel&views=scm,commits,fileHistory,lineHistory,searchCompare,stashes,branches,remotes,tags,worktrees,contributors')
  const first = page.getByRole('region', { name: 'Source Control', exact: true })
  const last = page.getByRole('region', { name: 'Contributors', exact: true }).getByRole('button', { name: 'Contributors', exact: true })
  await expect(last).not.toBeInViewport()
  await first.getByRole('button', { name: 'Source Control', exact: true }).hover()
  await page.mouse.wheel(0, 1000)
  await expect(last).toBeInViewport()
})

const person = { name: 'GitMenu', email: 'review@example.invalid', time: 1700000000 }
const stash = { index: 2, commit: 'a'.repeat(40), message: 'Stashed edits', time: person.time }
const stashGraph = {
  lanes: 1, total: 1, more: false,
  rows: [{
    id: stash.commit, author: person, committer: person, parents: [], subject: stash.message,
    lane: 0, into: [], out: [], pass: [], continues: false, stash: true, current: false,
    refs: [{ name: 'stash@{2}', kind: 'stash' }],
  }],
}

test('Apply Stash from a graph row targets that stash', async ({ page }) => {
  await overrideIpc(page, { repo_graph: stashGraph, repo_stashes: [stash] })
  await page.setViewportSize({ width: 900, height: 600 })
  await page.goto(`/#/detail/graph?${repo}`)
  await page.getByRole('gridcell', { name: 'Stashed edits' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Apply Stash', exact: true }).click()
  await expect.poll(() => calls(page, 'git_exec')).toMatchObject([{ root, args: ['stash', 'apply', stash.commit] }])
})

test('Delete Stash does not drop another stash after its position changes', async ({ page }) => {
  await overrideIpc(page, { repo_graph: stashGraph })
  await page.setViewportSize({ width: 900, height: 600 })
  await page.goto(`/?staleStash=1#/detail/graph?${repo}`)
  await page.getByRole('gridcell', { name: stash.message }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^Delete Stash/ }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('The stash list changed. Select the stash again.')).toBeVisible()
  expect(await calls(page, 'git_exec')).toEqual([])
  expect(await calls(page, 'git_stash_selected')).toMatchObject([{ root, action: 'drop', expected: { index: stash.index, commit: stash.commit } }])
})

test('Accept All Incoming replaces only marked conflict blocks without staging the file', async ({ page }) => {
  await overrideIpc(page, { read_text_file: { text: 'manual edit\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\nauto-merged edit\n', markerSize: 7 } })
  await page.goto('/?window=panel&views=scm&status=merge')
  await page.getByRole('treeitem', { name: /^app\.ts/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Accept All Incoming' }).click()
  await expect.poll(() => calls(page, 'git_apply')).toMatchObject([{
    root, cached: false, patch: expect.stringContaining(' manual edit\n-<<<<<<< HEAD\n-ours\n-=======\n-theirs\n->>>>>>> branch\n+theirs\n auto-merged edit\n'),
  }])
  expect(await calls(page, 'git_stage')).toEqual([])
})

test('Undo after discarding one file requests only that file from the recovery snapshot', async ({ page }) => {
  const recovery = 'd'.repeat(40)
  await overrideIpc(page, { git_discard: { recovery, trashed: [], trashError: null } })
  await page.goto('/?window=panel&views=scm')
  await page.getByRole('treeitem', { name: /^README\.md/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Discard Changes', exact: true }).click()
  await page.getByRole('button', { name: 'Discard File', exact: true }).click()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => calls(page, 'git_undo_discard')).toMatchObject([{ root, recovery, paths: ['README.md'] }])
  expect(await calls(page, 'git_exec')).toEqual([])
})

test('a staged diff sends the selected Index lines and original path to Line History', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 })
  await page.goto(`/#/detail/diff?${repo}&path=src%2Frenamed.ts&original=src%2Fold.ts&group=index`)
  const line = page.getByRole('button', { name: 'Select line 2', exact: true }).first()
  await expect(line).toBeVisible()
  await page.evaluate(() => {
    type Invoke = (command: string, args?: { event?: string; payload?: unknown }, options?: unknown) => Promise<unknown>
    const { __TAURI_INTERNALS__: internals } = window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } }
    const original = internals.invoke
    internals.invoke = async (command, args, options) => {
      if (command === 'plugin:event|emit' && args?.event === 'lineHistory://select') Object.assign(window, { __lineSelection: args.payload })
      return original(command, args, options)
    }
  })
  await line.click()
  const selection = await page.evaluate(() => (window as unknown as { __lineSelection: unknown }).__lineSelection)
  expect(selection).toEqual({ root, path: 'src/renamed.ts', originalPath: 'src/old.ts', ranges: [{ start: 2, end: 2 }], side: { kind: 'index' } })

  await page.goto('/?window=panel&views=lineHistory')
  await expect(page.getByText(/no editors open that can provide line history/i)).toBeVisible()
  await page.evaluate((target) => (window as unknown as { __emit: (event: string, value: unknown) => Promise<void> }).__emit('lineHistory://select', target), selection)
  await expect.poll(() => calls(page, 'repo_line_history')).toMatchObject([selection])
})
