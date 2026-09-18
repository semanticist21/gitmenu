// Browser preview without the Rust backend: `VITE_MOCK=1 bun run dev`, then open
// http://localhost:1420/?window=panel (or #/detail/settings). Used for UI checks and the
// Playwright tests; never bundled into the app (main.tsx imports it only when VITE_MOCK is set).
import { emit } from '@tauri-apps/api/event'
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'

const root = '/Users/me/code/demo'
const projects = [
  {
    id: root,
    name: 'demo',
    missing: false,
    dirty: false,
    parentCandidate: null,
    repos: [{ root, gitDir: `${root}/.git`, commonDir: `${root}/.git`, kind: 'root', name: 'demo' }],
  },
  { id: '/Users/me/code/other', name: 'other', missing: false, dirty: true, parentCandidate: null, repos: [] },
]

const status = {
  head: { branch: 'main', commit: '8f3c2a1d9e0b7c6a5f4e3d2c1b0a9f8e7d6c5b4a', detached: false },
  upstream: { name: 'origin/main', remote: 'origin', ahead: 2, behind: 1 },
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

const ui: Record<string, unknown> = { loginItemAsked: true, 'views.layout': { visible: ['scm', 'commits', 'fileHistory', 'searchCompare'], collapsed: [], weights: { scm: 2, commits: 3, fileHistory: 1, searchCompare: 1 } }, 'fileHistory.target': { root, path: 'src/main.tsx' }, [`searchCompare.${root}`]: [{ id: 'compare:main..feature/login', kind: 'compare', base: 'main', head: 'feature/login' }] }
const settings: Record<string, unknown> = {}

export function installMocks() {
  const params = new URLSearchParams(window.location.search)
  mockWindows(window.location.hash.startsWith('#/detail') ? 'detail' : (params.get('window') ?? 'panel'))
  mockIPC(
    (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>
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
        case 'projects_list':
          return [projects, root]
        case 'projects_recent':
          return ['/Users/me/code/archived']
        case 'env_status':
          return { ready: true, git: '/usr/bin/git', gitVersion: 'git version 2.50.1' }
        case 'repo_status':
          return status
        case 'repo_refs':
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
          const all = commits(q.revs?.[0] === 'origin/main' ? 1 : q.revs?.[0] === 'HEAD' && (a.query as { hide?: string[] })?.hide?.length ? 2 : 45)
          const page = all.slice(q.skip ?? 0, (q.skip ?? 0) + q.limit)
          return { commits: q.path ? page.map((c) => ({ ...c, path: q.path, status: 'modified' })) : page, more: (q.skip ?? 0) + q.limit < all.length }
        }
        case 'repo_commit':
          return {
            ...commits(1)[0],
            id: a.rev,
            message: 'feat: add queue\n\nRuns writes one at a time per worktree.',
            files: [
              { path: 'src-tauri/src/queue.rs', originalPath: null, status: 'modified' },
              { path: 'src/lib/ops.ts', originalPath: null, status: 'added' },
              { path: 'src/lib/old-ops.ts', originalPath: null, status: 'deleted' },
              { path: 'docs/queue.md', originalPath: 'docs/ops.md', status: 'renamed' },
            ],
          }
        case 'repo_compare':
          return { base: 'aaa', head: 'bbb', mergeBase: 'ccc', ahead: 3, behind: 1, files: [{ path: 'src/main.tsx', originalPath: null, status: 'modified' }] }
        case 'repo_remotes':
          return [{ name: 'origin', fetchUrl: 'git@github.com:me/demo.git', pushUrl: 'git@github.com:me/demo.git' }]
        case 'avatars_resolve':
          return {}
        case 'ai_availability':
          return 'available'
        case 'ai_commit_message':
          return 'feat(scm): add commit and push to the action button'
        case 'terminal_apps':
          return ['Terminal', 'Ghostty']
        case 'login_item_status':
          return 'disabled'
        default:
          console.info('[mock ipc]', cmd, a)
          return null
      }
    },
    { shouldMockEvents: true },
  )
}
