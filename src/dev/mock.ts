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

const ui: Record<string, unknown> = { loginItemAsked: true }
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
