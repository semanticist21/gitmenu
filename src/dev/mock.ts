// Browser preview without the Rust backend: `VITE_MOCK=1 bun run dev`, then open
// http://localhost:1420/?window=panel (or #/detail/settings). Used for UI checks and the
// Playwright tests; never bundled into the app (main.tsx imports it only when VITE_MOCK is set).
import type { Channel } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { resolveMenu, title } from '@/commands/registry'

const root = '/Users/me/code/demo'
const projects = [
  {
    id: root,
    name: 'demo',
    missing: false,
    dirty: false,
    scanning: false,
    scanTruncated: false,
    parentCandidate: null,
    repos: [{ root, gitDir: `${root}/.git`, commonDir: `${root}/.git`, kind: 'root', name: 'demo' }],
  },
  { id: '/Users/me/code/other', name: 'other', missing: false, dirty: true, scanning: false, scanTruncated: false, parentCandidate: null, repos: [] },
]

const status = {
  head: { branch: 'main', commit: '8f3c2a1d9e0b7c6a5f4e3d2c1b0a9f8e7d6c5b4a', detached: false },
  upstream: { name: 'origin/main', remote: 'origin', ahead: 2, behind: 1, gone: false },
  operation: null,
  merge: [],
  index: [
    { path: 'src/queue.rs', originalPath: null, status: 'indexModified', submodule: false },
    { path: 'docs/usage.md', originalPath: null, status: 'indexAdded', submodule: false },
  ],
  workingTree: [
    { path: 'src/main.tsx', originalPath: null, status: 'modified', submodule: false },
    { path: 'src/old.ts', originalPath: null, status: 'deleted', submodule: false },
    { path: 'README.md', originalPath: null, status: 'modified', submodule: false },
  ],
  untracked: [{ path: 'notes/todo.txt', originalPath: null, status: 'untracked', submodule: false }],
  remotes: ['origin'],
  fetchedAt: Math.floor(Date.now() / 1000) - 120,
  total: 6,
  hitLimit: false,
}

const authors = [
  ['Ada Lovelace', 'ada@example.com'],
  ['Grace Hopper', '1234+grace@users.noreply.github.com'],
  ['Linus Torvalds', 'linus@example.com'],
]
const subjects = ['feat: add queue', 'fix: retry index.lock', 'refactor: split read module', 'docs: explain askpass', 'chore: bump gix', 'feat(ui): commits view']

function commits(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const [name, email] = authors[i % authors.length]
    const time = Math.floor(Date.now() / 1000) - i * 5400 - 300
    return {
      id: (i + 1).toString(16).padStart(8, '0').repeat(5),
      parents: [(i + 2).toString(16).padStart(8, '0').repeat(5)],
      author: { name, email, time },
      committer: { name, email, time },
      subject: subjects[i % subjects.length],
      path: null,
      status: null,
      originalPath: null,
    }
  })
}

const scenario = new URLSearchParams(window.location.search)

// Sizes the lists that have to stay virtualized: `?refs=N` a release-heavy ref list (the
// checkout quick pick), `?incoming=N` an unread upstream (the Commits view's Incoming node),
// `?changes=N` a monorepo-sized working tree spread over folders (the SCM tree view).
const refCount = Math.max(0, Number(scenario.get('refs')) || 0)
const incomingCount = Math.max(0, Number(scenario.get('incoming')) || 0)
const changeCount = Math.max(0, Number(scenario.get('changes')) || 0)
const manyRefs = Array.from({ length: refCount }, (_, i) => {
  const kind = i % 3 === 0 ? 'branch' : i % 3 === 1 ? 'remote' : 'tag'
  const short = kind === 'branch' ? `feature/issue-${i}` : kind === 'remote' ? `origin/feature/issue-${i}` : `v1.${i}.0`
  const prefix = kind === 'branch' ? 'refs/heads' : kind === 'remote' ? 'refs/remotes' : 'refs/tags'
  return { name: `${prefix}/${short}`, short, kind, commit: (i + 1).toString(16).padStart(8, '0').repeat(5), time: 1_700_000_000 - i * 3600, subject: subjects[i % subjects.length] }
})
const manyChanges = Array.from({ length: changeCount }, (_, i) => ({
  path: `packages/pkg-${i % 50}/src/module-${Math.floor(i / 50) % 50}/file-${i}.ts`,
  originalPath: null,
  status: 'modified',
  submodule: false,
}))

// `?repos=N` opens one project holding N repositories, as opening a folder of checkouts does
const repoCount = Math.max(0, Number(scenario.get('repos')) || 0)
const codeRoot = '/Users/me/code'
const repoNames = ['api-server', 'web-dashboard', 'mobile-app', 'infra', 'docs-site', 'design-tokens', 'cli', 'sdk-js', 'sdk-rs', 'playground']
const manyRepos = Array.from({ length: repoCount }, (_, i) => {
  const round = Math.floor(i / repoNames.length)
  const name = round ? `${repoNames[i % repoNames.length]}-${round}` : repoNames[i % repoNames.length]
  const repoRoot = `${codeRoot}/${name}`
  return { root: repoRoot, gitDir: `${repoRoot}/.git`, commonDir: `${repoRoot}/.git`, kind: 'nested', name }
})
const codeProject = { id: codeRoot, name: 'code', missing: false, dirty: true, scanning: false, scanTruncated: Boolean(scenario.get('truncated')), parentCandidate: null, repos: manyRepos }

// `?scanning=1` opens a folder that is still being scanned: the tab is there with no
// repositories, then they stream in over `projects://changed`, as project.rs does.
// `?repos=0&scanning=1` is the part of a scan that has not found anything yet.
const scanning = scenario.get('scanning') !== null
const scanFindsNothing = scanning && repoCount === 0
let scannedRepos = scanning ? [] : manyRepos
function streamScan() {
  const steps = [manyRepos.slice(0, Math.ceil(manyRepos.length / 2)), manyRepos]
  steps.forEach((repos, i) => {
    setTimeout(
      () => {
        scannedRepos = repos
        void emit('projects://changed', [[{ ...codeProject, scanning: i < steps.length - 1, repos }], codeRoot])
      },
      200 * (i + 1),
    )
  })
}

const statusFiles = ['src/index.ts', 'src/app.tsx', 'README.md', 'package.json', 'src/lib/util.ts', 'test/e2e.spec.ts', 'docs/api.md']

// Oversized repositories, for the tests that check long lists stay virtualized:
// `?files=N` makes every commit touch N files, `?lines=N&hunks=M` makes every diff N lines per
// side with M single-line changes (`?lines=N` alone is one big file with one change).
const bigFiles = Math.max(0, Number(scenario.get('files')) || 0)
const bigLines = Math.max(0, Number(scenario.get('lines')) || 0)
const bigHunks = Math.min(bigLines, Math.max(1, Number(scenario.get('hunks')) || 1))
// `?log=N` starts the Git output with N earlier commands, as a long session leaves it (Rust
// keeps the last 500), each with the stderr a fetch prints
const logCount = Math.max(0, Number(scenario.get('log')) || 0)

function commitFiles(count: number) {
  const kinds = ['modified', 'added', 'deleted', 'renamed']
  return Array.from({ length: count }, (_, i) => ({
    path: `src/generated/module-${String(i).padStart(5, '0')}/index.ts`,
    originalPath: null,
    status: kinds[i % kinds.length],
  }))
}

/** Two texts of `bigLines` lines that differ on `bigHunks` evenly spread single lines. */
function bigDiff() {
  const step = Math.floor(bigLines / bigHunks)
  const left: string[] = []
  const right: string[] = []
  const hunks: { leftStart: number; leftCount: number; rightStart: number; rightCount: number }[] = []
  for (let i = 0; i < bigLines; i++) {
    const changed = i % step === 0 && hunks.length < bigHunks
    left.push(`export const value${i} = { id: ${i}, name: 'row ${i}' }`)
    right.push(changed ? `export const value${i} = { id: ${i + 1}, name: 'row ${i}' }` : left[i])
    if (changed) hunks.push({ leftStart: i, leftCount: 1, rightStart: i, rightCount: 1 })
  }
  const text = (lines: string[]) => `${lines.join('\n')}\n`
  return { left: text(left), right: text(right), hunks }
}

/** Every repository of a `?repos=N` project reports its own branch, sync counts and changes. */
function repoStatus(root: string) {
  const i = manyRepos.findIndex((r) => r.root === root)
  if (i < 0) return status
  const group = (from: number, count: number, code: string) =>
    Array.from({ length: count }, (_, k) => ({ path: statusFiles[(from + k) % statusFiles.length], originalPath: null, status: code, submodule: false }))
  const branch = i % 7 === 0 ? 'main' : `feature/${manyRepos[i].name}`
  return {
    head: { branch, commit: (i + 1).toString(16).padStart(8, '0').repeat(5), detached: false },
    upstream: i % 5 === 4 ? null : { name: `origin/${branch}`, remote: 'origin', ahead: i % 4, behind: i % 3, gone: false },
    operation: null,
    merge: [],
    index: group(i, i % 3, 'indexModified'),
    workingTree: group(i + 1, i % 5, 'modified'),
    untracked: group(i + 2, i % 2, 'untracked'),
    remotes: ['origin'],
    fetchedAt: Math.floor(Date.now() / 1000) - 60 * (i + 1),
    total: (i % 3) + (i % 5) + (i % 2),
    hitLimit: false,
  }
}

const ui: Record<string, unknown> = { loginItemAsked: !scenario.get('login'), 'views.layout': new URLSearchParams(window.location.search).get('views') ? { visible: new URLSearchParams(window.location.search).get('views')!.split(','), collapsed: [], weights: {} } : { visible: ['scm', 'commits', 'fileHistory', 'searchCompare'], collapsed: [], weights: { scm: 2, commits: 3, fileHistory: 1, searchCompare: 1 } }, 'fileHistory.target': { root, path: 'src/main.tsx' }, [`searchCompare.${root}`]: [{ id: 'compare:main..feature/login', kind: 'compare', base: 'main', head: 'feature/login' }] }
if (scenario.get('many')) {
  const file = (path: string) => `/detail/diff?repo=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}&group=workingTree`
  ui['detail.tabs'] = ['/detail/settings', ...['src/main.tsx', 'README.md', 'src/queue.rs', 'docs/usage.md', 'src/old.ts', 'notes/todo.txt'].map(file), '/detail/keyboard-shortcuts']
  ui['detail.active'] = file('README.md')
}
const settings: Record<string, unknown> = {}

export function installMocks() {
  // For the e2e tests: the labels a registry menu should show, in order
  Object.assign(window, {
    __menuLabels: (menu: string, context: Record<string, unknown>) =>
      resolveMenu(menu, context)
        .filter((g) => g.group !== 'inline')
        .flatMap((g) => g.items.map((i) => (i.command ? title(i.command.title) : i.submenu ? title(i.submenu.label) : ''))),
  })
  const params = new URLSearchParams(window.location.search)
  mockWindows(window.location.hash.startsWith('#/detail') ? 'detail' : (params.get('window') ?? 'panel'))
  // The Git output log; e2e tests add commands with __logEntry
  const now = Date.now()
  const logRepo = '/Users/me/code/gitmenu'
  const gitLog = [
    ...Array.from({ length: logCount }, (_, i) => ({
      // Past the operation ids the entries below use, so Show Command Output still finds op 9
      op: 1000 + i,
      time: now - 120_000 - (logCount - i) * 1_000,
      repo: logRepo,
      args: ['fetch', '--prune', 'origin'],
      durationMs: 300 + (i % 700),
      code: 0,
      cancelled: false,
      stderr: `remote: Enumerating objects: ${i + 12}, done.\nremote: Counting objects: 100% (${i + 12}/${i + 12}), done.\nremote: Compressing objects: 100% (7/7), done.\nremote: Total 12 (delta 6), reused 9 (delta 4), pack-reused 0\nFrom github.com:me/gitmenu\n   ${i.toString(16).padStart(7, '0')}..${(i + 1).toString(16).padStart(7, '0')}  main       -> origin/main`,
    })),
    { op: 7, time: now - 60_000, repo: logRepo, args: ['fetch', '--all'], durationMs: 812, code: 0, cancelled: false, stderr: 'From github.com:me/gitmenu\n   3f2a1c9..8b7d6e5  main       -> origin/main' },
    { op: 8, time: now - 30_000, repo: logRepo, args: ['add', '-A', '--', 'src/main.tsx'], durationMs: 41, code: 0, cancelled: false, stderr: '' },
    {
      op: 9,
      time: now - 5_000,
      repo: logRepo,
      args: ['pull', '--tags', 'origin', 'main'],
      durationMs: 1234,
      code: 128,
      cancelled: false,
      stderr:
        'hint: You have divergent branches and need to specify how to reconcile them.\nhint: You can do so by running one of the following commands sometime before\nhint: your next pull:\nhint:\nhint:   git config pull.rebase false  # merge\nhint:   git config pull.rebase true   # rebase\nhint:   git config pull.ff only       # fast-forward only\nfatal: Need to specify how to reconcile divergent branches.',
    },
  ]
  Object.assign(window, {
    __emit: emit,
    __logEntry: (entry: (typeof gitLog)[number]) => {
      gitLog.push(entry)
      void emit('git-log://entry', entry)
    },
  })
  // For the e2e tests: every command the UI invoked, in order, and their arguments
  const calls: string[] = []
  const callArgs: Record<string, unknown>[] = []
  Object.assign(window, { __ipcCalls: calls, __ipcArgs: callArgs })
  // Terminal sessions by key, as terminal.rs keeps them: each writes to the channel it was last
  // opened with, and the "shell" prints a prompt and echoes what it is sent. e2e tests print
  // with __terminalOutput, mark shells as running something in __terminalBusy, and set what
  // ⌘V pastes in __clipboard
  const terminals = new Map<string, Channel<ArrayBuffer>>()
  const output = (key: string, text: string) => terminals.get(key)?.onmessage(new TextEncoder().encode(text).buffer)
  const busy = new Set<string>()
  Object.assign(window, { __terminalOutput: output, __terminalBusy: busy, __clipboard: 'pasted' })
  mockIPC(
    (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>
      calls.push(cmd)
      callArgs.push(a)
      switch (cmd) {
        case 'settings_get':
          return settings
        case 'settings_set':
          if (a.value === null) delete settings[a.key as string]
          else settings[a.key as string] = a.value
          void emit('settings://changed', { ...settings })
          return null
        case 'keybindings_get':
          return []
        case 'ui_state_get':
          return ui[a.key as string] ?? null
        case 'ui_state_set':
          ui[a.key as string] = a.value
          return null
        case 'projects_list': {
          const kind = scenario.get('project')
          if (kind === 'none') return [[], null]
          if (kind === 'missing') return [[{ ...projects[0], missing: true, scanning: false, repos: [] }], root]
          if (kind === 'parent') return [[{ ...projects[0], repos: [], parentCandidate: '/Users/me/code' }], root]
          if (kind === 'norepo') return [[{ ...projects[0], repos: [] }], root]
          if (repoCount || scanning) {
            if (scanning) {
              if (!scanFindsNothing && scannedRepos.length === 0) streamScan()
              return [[{ ...codeProject, scanning: scanFindsNothing || scannedRepos.length !== manyRepos.length, repos: scannedRepos }], codeRoot]
            }
            return [[codeProject], codeRoot]
          }
          if (scenario.get('many')) {
            const names = ['api-server', 'web-dashboard', 'mobile-app', 'infra', 'docs-site', 'design-tokens']
            return [[...projects, ...names.map((name) => ({ ...projects[1], id: `/Users/me/code/${name}`, name, dirty: false }))], root]
          }
          return [projects, root]
        }
        case 'projects_recent':
          return ['/Users/me/code/archived']
        case 'env_status':
          return { ready: true, git: scenario.get('git') === 'missing' ? null : '/usr/bin/git', gitVersion: 'git version 2.50.1', shellFailed: scenario.get('git') === 'shell' }
        case 'prompt_open':
          return scenario.get('prompt') === 'askpass'
            ? [{ id: 1, kind: 'askpass', prompt: "Password for 'https://me@github.com': ", input: 'secret' }]
            : scenario.get('prompt') === 'editor'
              ? [{ id: 2, kind: 'editor', path: '/tmp/COMMIT_EDITMSG', input: 'editor' }]
              : []
        case 'prompt_read_file':
          return 'feat: add queue\n\n# Please enter the commit message for your changes.'
        case 'git_exec': {
          const id = calls.length
          const op = { id, repo: a.root, kind: a.kind, label: a.label, background: false }
          ;(window as unknown as { __gitExec: string[][] }).__gitExec = [...((window as unknown as { __gitExec?: string[][] }).__gitExec ?? []), a.args as string[]]
          void emit('op://started', op)
          return new Promise((resolve) =>
            setTimeout(() => {
              void emit('op://finished', { ...op, error: null })
              resolve({ stdout: '', stderr: '' })
              // The file watcher reports the write a moment later (debounced)
              setTimeout(() => void emit('repo://changed', a.root), 60)
            }, 30),
          )
        }
        case 'repo_status': {
          const plain = repoCount ? repoStatus(a.root as string) : status
          const base =
            incomingCount || changeCount
              ? {
                  ...plain,
                  ...(incomingCount && plain.upstream ? { upstream: { ...plain.upstream, behind: incomingCount } } : {}),
                  ...(changeCount ? { index: [], workingTree: manyChanges, untracked: [], total: changeCount } : {}),
                }
              : plain
          const next =
            scenario.get('status') === 'merge'
              ? { ...base, operation: 'merge', merge: [{ path: 'src/app.ts', originalPath: null, status: 'bothModified', submodule: false }] }
              : scenario.get('status') === 'clean'
                ? { ...base, index: [], workingTree: [], untracked: [] }
                : base
          // Real status reads take a moment; a refresh landing meanwhile must not abort a command
          return scenario.get('slow') ? new Promise((resolve) => setTimeout(() => resolve(next), 150)) : next
        }
        case 'repo_refs':
          if (refCount) return manyRefs
          return [
            { name: 'refs/heads/main', short: 'main', kind: 'branch', commit: status.head.commit, time: 1_700_000_000, subject: 'feat: add queue' },
            { name: 'refs/heads/feature/login', short: 'feature/login', kind: 'branch', commit: 'a1b2c3d4', time: 1_690_000_000, subject: 'wip' },
            { name: 'refs/remotes/origin/main', short: 'origin/main', kind: 'remote', commit: 'b2c3d4e5', time: 1_699_000_000, subject: 'fix: typo' },
            { name: 'refs/tags/v1.0.0', short: 'v1.0.0', kind: 'tag', commit: 'c3d4e5f6', time: 1_680_000_000, subject: 'release' },
          ]
        case 'repo_stashes':
          return [{ index: 0, commit: 'd4e5f6a7', message: 'On main: experiment', time: 1_700_000_000 }]
        case 'repo_diff':
        case 'repo_file': {
          if (bigLines) {
            const big = bigDiff()
            const side = (text: string, exists: boolean) => ({ exists, size: text.length, text: exists ? text : null, dataUrl: null })
            if (cmd === 'repo_file') return { kind: 'text', left: side('', false), right: side(big.right, true), hunks: [] }
            return { kind: 'text', left: side(big.left, true), right: side(big.right, true), hunks: big.hunks }
          }
          const left = 'import { createRoot } from \'react-dom/client\'\nimport App from \'./App\'\n\nconst root = document.getElementById(\'root\')\ncreateRoot(root!).render(<App />)\n\nexport function helper(a: number) {\n  return a * 2\n}\n'
          const right = 'import { StrictMode } from \'react\'\nimport { createRoot } from \'react-dom/client\'\nimport App from \'./App\'\n\nconst root = document.getElementById(\'root\')\ncreateRoot(root!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n)\n\nexport function helper(a: number) {\n  return a * 3\n}\n'
          if (cmd === 'repo_file') return { kind: 'text', left: { exists: false, size: 0, text: null, dataUrl: null }, right: { exists: true, size: right.length, text: right, dataUrl: null }, hunks: [] }
          return {
            kind: 'text',
            left: { exists: true, size: left.length, text: left, dataUrl: null },
            right: { exists: true, size: right.length, text: right, dataUrl: null },
            hunks: [
              { leftStart: 0, leftCount: 0, rightStart: 0, rightCount: 1 },
              { leftStart: 4, leftCount: 1, rightStart: 5, rightCount: 5 },
              { leftStart: 7, leftCount: 1, rightStart: 12, rightCount: 1 },
            ],
          }
        }
        case 'repo_blame':
          return {
            ranges: [
              { start: 0, len: 1, commit: null },
              { start: 1, len: 4, commit: 'a1' },
              { start: 5, len: 5, commit: null },
              { start: 10, len: 4, commit: 'b2' },
            ],
            commits: {
              a1: { id: 'a1b2c3d4e5', author: 'Ada Lovelace', email: 'ada@x', time: 1_700_000_000, summary: 'feat: render app' },
              b2: { id: 'b2c3d4e5f6', author: 'Grace Hopper', email: 'grace@x', time: 1_750_000_000, summary: 'refactor: helper' },
            },
          }
        case 'repo_log':
        case 'repo_line_history': {
          const q = (a.query ?? a) as { skip?: number; limit: number; revs?: string[]; path?: string }
          const all = commits(q.revs?.[0] === 'origin/main' ? incomingCount || 1 : q.revs?.[0] === 'HEAD' && (a.query as { hide?: string[] })?.hide?.length ? 2 : 45)
          const page = all.slice(q.skip ?? 0, (q.skip ?? 0) + q.limit)
          return { commits: q.path ? page.map((c) => ({ ...c, path: q.path, status: 'modified' })) : page, more: (q.skip ?? 0) + q.limit < all.length }
        }
        case 'repo_commit':
          return {
            ...commits(1)[0],
            id: a.rev,
            message: 'feat: add queue\n\nRuns writes one at a time per worktree.',
            files: bigFiles
              ? commitFiles(bigFiles)
              : [
                  { path: 'src-tauri/src/queue.rs', originalPath: null, status: 'modified' },
                  { path: 'src/lib/ops.ts', originalPath: null, status: 'added' },
                  { path: 'src/lib/old-ops.ts', originalPath: null, status: 'deleted' },
                  { path: 'docs/queue.md', originalPath: 'docs/ops.md', status: 'renamed' },
                ],
          }
        case 'repo_compare':
          return { base: 'aaa', head: 'bbb', mergeBase: 'ccc', ahead: 3, behind: 1, files: [{ path: 'src/main.tsx', originalPath: null, status: 'modified' }] }
        case 'repo_branches':
          return [
            { name: 'refs/heads/main', short: 'main', kind: 'branch', commit: status.head.commit, time: 1_700_000_000, subject: 'feat: add queue', current: true, upstream: status.upstream },
            { name: 'refs/heads/feature/login', short: 'feature/login', kind: 'branch', commit: 'a1b2c3d4', time: 1_690_000_000, subject: 'wip', current: false, upstream: null },
            { name: 'refs/heads/feature/tray', short: 'feature/tray', kind: 'branch', commit: 'a1b2c3d5', time: 1_689_000_000, subject: 'tray icon', current: false, upstream: { name: 'origin/feature/tray', remote: 'origin', ahead: 0, behind: 0, gone: true } },
          ]
        case 'repo_worktrees':
          return [
            { path: root, branch: 'main', commit: status.head.commit, main: true, current: true, locked: false, missing: false },
            { path: '/Users/me/code/demo-login', branch: 'feature/login', commit: 'a1b2c3d4', main: false, current: false, locked: true, missing: false },
          ]
        case 'repo_contributors':
          return authors.map(([name, email], i) => ({ name, email, commits: 40 - i * 13, latest: 'abc', latestTime: Math.floor(Date.now() / 1000) - i * 90000 }))
        case 'repo_graph': {
          const q = a.query as { skip: number; limit: number }
          const base = commits(Math.max(60, Number(scenario.get('rows')) || 0))
          const shape: [number, number[], number[], number[], boolean, { name: string; kind: string }[]][] = [
            [0, [], [0, 1], [], false, [{ name: 'main', kind: 'head' }, { name: 'origin/main', kind: 'remote' }]],
            [0, [], [0], [1], true, []],
            [1, [], [1], [0], true, [{ name: 'feature/tray', kind: 'branch' }]],
            [1, [], [0], [0], true, []],
            [0, [], [0], [], true, [{ name: 'v1.0.0', kind: 'tag' }]],
          ]
          const rows = base.map((c, i) => {
            const [lane, into, out, pass, continues, refs] = shape[i] ?? [0, [], i === 59 ? [] : [0], [], true, []]
            return { ...c, parents: out.length === 2 ? [c.parents[0], 'x'] : c.parents, lane, into, out, pass, continues, refs, stash: false, current: i !== 2 && i !== 3 }
          })
          return { rows: rows.slice(q.skip, q.skip + q.limit), more: q.skip + q.limit < rows.length, total: rows.length, lanes: 2 }
        }
        case 'repo_remotes':
          return [{ name: 'origin', fetchUrl: 'git@github.com:me/demo.git', pushUrl: 'git@github.com:me/demo.git' }]
        case 'avatars_resolve':
          return {}
        case 'ai_availability':
          return 'available'
        case 'ai_commit_message':
          return 'feat(scm): add commit and push to the action button'
        case 'git_log_entries':
          return [...gitLog]
        case 'git_log_failure':
          return a.key === 'launch-9' ? gitLog.filter((e) => e.op === 9) : null
        case 'plugin:app|version':
          return '0.1.0'
        case 'git_log_clear':
          gitLog.length = 0
          return null
        case 'terminal_apps':
          return ['Terminal', 'Ghostty']
        case 'terminal_open': {
          const key = a.key as string
          const reattached = terminals.has(key)
          // mockIPC hands over the Channel itself, not its serialized id
          terminals.set(key, a.onData as Channel<ArrayBuffer>)
          if (!reattached) setTimeout(() => output(key, '$ '))
          return { shell: 'zsh', cwd: (a.cwd as string | null) ?? root, pid: 4242, reattached }
        }
        case 'terminal_write':
          output(a.key as string, a.data === '\r' ? '\r\n$ ' : (a.data as string))
          return null
        case 'terminal_write_binary':
          return null
        case 'terminal_has_child_processes':
          return busy.has(a.key as string)
        case 'terminal_kill':
          terminals.delete(a.key as string)
          busy.delete(a.key as string)
          return null
        case 'terminal_resize':
          return null
        case 'clipboard_read':
          return (window as unknown as { __clipboard: string }).__clipboard
        case 'login_item_status':
          return 'disabled'
        default:
          console.info('[mock ipc]', cmd, a)
          return null
      }
    },
    { shouldMockEvents: true },
  )
  if (scenario.get('toast') === 'error') {
    const message = "repository 'https://github.com/semanticist21/gitmenu-sync-test-does-not-exist.git/' not found"
    setTimeout(() => void emit('op://finished', { id: 9, repo: root, kind: 'push', background: false, output: 'launch-9', error: { kind: 'git', message, stderr: `remote: Repository not found.\nfatal: ${message}` } }), 600)
  }
  // `op=1` runs a push; `op=<kind>` runs an operation of that kind, until the page closes
  const running = scenario.get('op')
  if (running) {
    const kind = running === '1' ? 'push' : running
    setTimeout(() => void emit('op://started', { id: 1, repo: root, kind, label: `git ${kind}`, background: false }), 300)
  }
}
