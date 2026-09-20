// GitLens commands on branch, remote, tag, stash, worktree and contributor rows. Destructive
// ones ask first, like GitLens's git command flows.
import { registerHandler } from '@/commands/registry'
import { showInputBox, showQuickPick } from '@/components/dialogs/dialogs'
import { gl } from '@/i18n'
import { git, type RefInfo } from '@/lib/git'
import { ipc } from '@/lib/ipc'
import { addResult, copy, pickProvider } from '../history/handlers'
import { providerFor, type RemoteSetting } from '../remote/providers'
import { confirm, exec, guard, setting } from '../scm/handlers'
import { getCommitInput, setCommitInput } from '../scm/state'
import type { ContributorArg, RefArg, RemoteArg, StashArg, WorktreeArg } from './views'

const isRef = (arg: unknown): arg is RefArg => typeof arg === 'object' && arg !== null && 'ref' in arg
const isRemote = (arg: unknown): arg is RemoteArg => typeof arg === 'object' && arg !== null && 'remote' in arg && 'url' in arg
const isStash = (arg: unknown): arg is StashArg => typeof arg === 'object' && arg !== null && 'stash' in arg
const isWorktree = (arg: unknown): arg is WorktreeArg => typeof arg === 'object' && arg !== null && 'worktree' in arg
const isContributor = (arg: unknown): arg is ContributorArg => typeof arg === 'object' && arg !== null && 'contributor' in arg

/** `origin/feature/x` → `['origin', 'feature/x']` */
function splitRemote(ref: RefInfo): [string, string] {
  const i = ref.short.indexOf('/')
  return [ref.short.slice(0, i), ref.short.slice(i + 1)]
}

async function switchTo(arg: unknown) {
  if (!isRef(arg)) return
  const { root, ref } = arg
  if (ref.kind === 'branch') return guard(() => exec(root, 'checkout', gl('Switch'), ['switch', ref.short]))
  if (ref.kind === 'tag') {
    if (!(await confirm(gl('Switch to {0}? You will be in a detached HEAD state.', ref.short), gl('Switch')))) return
    return guard(() => exec(root, 'checkout', gl('Switch'), ['switch', '--detach', ref.short]))
  }
  // A remote branch: switch to its local branch, creating one that tracks it if needed
  const [, name] = splitRemote(ref)
  const locals = await git.refs(root)
  const existing = locals.some((r) => r.kind === 'branch' && r.short === name)
  const args = existing ? ['switch', name] : ['switch', '--track', ref.short]
  return guard(() => exec(root, 'checkout', gl('Switch'), args))
}

async function mergeIntoCurrent(arg: unknown) {
  if (!isRef(arg)) return
  const { root, ref } = arg
  const mode = await showQuickPick(
    [
      { label: gl('Merge'), detail: gl('Will merge {0} into the current branch', ref.short), value: [] as string[] },
      { label: gl('Fast-forward Merge'), detail: gl('Will fast-forward merge {0} into the current branch', ref.short), value: ['--ff-only'] },
      { label: gl('No Fast-forward Merge'), detail: gl('Will create a merge commit when merging {0} into the current branch', ref.short), value: ['--no-ff'] },
      { label: gl('Squash Merge'), detail: gl('Will squash all commits when merging {0} into the current branch', ref.short), value: ['--squash'] },
    ],
    { placeholder: gl('Choose a merge command') },
  )
  if (mode) await guard(() => exec(root, 'other', gl('Merge'), ['merge', ...mode, ref.short]))
}

async function rebaseCurrentOnto(arg: unknown) {
  if (!isRef(arg)) return
  const { root, ref } = arg
  if (!(await confirm(gl('Rebase the current branch onto {0}?', ref.short), gl('Rebase')))) return
  await guard(() => exec(root, 'other', gl('Rebase'), ['rebase', ref.short]))
}

async function renameBranch(arg: unknown) {
  if (!isRef(arg)) return
  const { root, ref } = arg
  const name = await showInputBox({ title: gl('Rename Branch'), prompt: gl('Please provide a new name for the branch'), value: ref.short })
  if (name?.trim() && name.trim() !== ref.short) await guard(() => exec(root, 'other', gl('Rename Branch'), ['branch', '-m', ref.short, name.trim()]))
}

async function deleteBranch(arg: unknown) {
  if (!isRef(arg)) return
  const { root, ref } = arg
  if (ref.kind === 'remote') {
    const [remote, name] = splitRemote(ref)
    if (!(await confirm(gl('Delete the remote branch {0}?', ref.short), gl('Delete'), { destructive: true }))) return
    // Not a blocking Push: VS Code runs remote ref deletion as its own, non-blocking operation
    return guard(() => exec(root, 'other', gl('Delete Branch'), ['push', remote, '--delete', name]))
  }
  const mode = await showQuickPick(
    [
      { label: gl('Delete Branch'), detail: gl('Will delete {0}', ref.short), value: '-d' },
      { label: gl('Force Delete Branch'), detail: gl('Will forcibly delete {0}, even if it has unmerged changes', ref.short), value: '-D' },
    ],
    { placeholder: gl('Choose a delete command') },
  )
  if (mode) await guard(() => exec(root, 'other', gl('Delete Branch'), ['branch', mode, ref.short]))
}

async function createBranchFrom(arg: unknown) {
  if (!isRef(arg)) return
  const { root, ref } = arg
  const name = await showInputBox({ title: gl('Create Branch'), prompt: gl('Please provide a name for the new branch'), placeholder: gl('Branch name') })
  if (!name?.trim()) return
  const andSwitch = await showQuickPick(
    [
      { label: gl('Create Branch'), detail: gl('Will create a new branch named {0} from {1}', name.trim(), ref.short), value: false },
      { label: gl('Create & Switch to Branch'), detail: gl('Will create and switch to a new branch named {0} from {1}', name.trim(), ref.short), value: true },
    ],
    { placeholder: gl('Choose options') },
  )
  if (andSwitch === undefined) return
  await guard(() =>
    andSwitch
      ? exec(root, 'checkout', gl('Create & Switch to Branch'), ['switch', '-c', name.trim(), ref.short])
      : exec(root, 'other', gl('Create Branch'), ['branch', name.trim(), ref.short]),
  )
}

async function pushRef(arg: unknown) {
  if (!isRef(arg)) return
  const { root, ref } = arg
  if (ref.kind === 'tag') {
    const status = await git.status(root)
    const remote = status.remotes.includes('origin') ? 'origin' : status.remotes[0]
    if (remote) await guard(() => exec(root, 'push', gl('Push'), ['push', remote, `refs/tags/${ref.short}`]))
    return
  }
  const branch = ref as RefArg['ref'] & { upstream?: { remote: string } | null }
  const remote = branch.upstream?.remote
  await guard(() => (remote ? exec(root, 'push', gl('Push'), ['push', remote, ref.short]) : exec(root, 'push', gl('Publish Branch'), ['push', '-u', 'origin', ref.short])))
}

async function openRefOnRemote(arg: unknown, copyOnly: boolean) {
  if (!isRef(arg)) return
  const { root, ref } = arg
  const provider = await pickProvider(root)
  if (!provider) return
  const name = ref.kind === 'remote' ? splitRemote(ref)[1] : ref.short
  const url = ref.kind === 'tag' ? provider.branch(name).replace('/tree/', '/releases/tag/') : provider.branch(name)
  if (copyOnly) await copy(url)
  else await ipc.openPath(url)
}

async function deleteTag(arg: unknown) {
  if (!isRef(arg)) return
  const { root, ref } = arg
  if (!(await confirm(gl('Delete the tag {0}?', ref.short), gl('Delete'), { destructive: true }))) return
  await guard(() => exec(root, 'other', gl('Delete Tag'), ['tag', '-d', ref.short]))
}

async function stashCommand(arg: unknown, action: 'apply' | 'pop' | 'drop') {
  if (!isStash(arg)) return
  const { root, stash } = arg
  const name = `stash@{${stash.index}}`
  if (action === 'drop' && !(await confirm(gl('Delete the stash {0}? It can’t be restored.', name), gl('Delete'), { destructive: true }))) return
  const label = { apply: gl('Apply Stash'), pop: gl('Pop Stash'), drop: gl('Delete Stash') }[action]
  await guard(() => exec(root, 'other', label, ['stash', action, name]))
}

async function stashOpenAll(arg: unknown) {
  if (!isStash(arg)) return
  const { root, stash } = arg
  const details = await git.commitDetails(root, stash.commit)
  for (const file of details.files) {
    const params = new URLSearchParams({ repo: root, path: file.path })
    params.set('left', file.status === 'added' ? 'empty' : `commit:${details.parents[0]}`)
    params.set('right', file.status === 'deleted' ? 'empty' : `commit:${stash.commit}`)
    void ipc.detailOpen(`/detail/diff?${params}`)
  }
}

async function worktreeCommand(arg: unknown, action: 'open' | 'finder' | 'terminal' | 'delete' | 'lock' | 'unlock') {
  if (!isWorktree(arg)) return
  const { root, worktree } = arg
  switch (action) {
    case 'open':
      await ipc.projectOpen(worktree.path)
      return
    case 'finder':
      await ipc.revealInFinder(worktree.path)
      return
    case 'terminal':
      await ipc.openInTerminal(worktree.path)
      return
    case 'lock':
    case 'unlock':
      await guard(() => exec(root, 'other', action === 'lock' ? gl('Lock Worktree') : gl('Unlock Worktree'), ['worktree', action, worktree.path]))
      return
    case 'delete': {
      const mode = await showQuickPick(
        [
          { label: gl('Delete Worktree'), detail: gl('Will delete the worktree in {0}', worktree.path), value: [] as string[] },
          { label: gl('Force Delete Worktree'), detail: gl('Will forcibly delete the worktree in {0}, even with uncommitted changes', worktree.path), value: ['--force'] },
        ],
        { placeholder: gl('Choose a delete command') },
      )
      if (mode) await guard(() => exec(root, 'other', gl('Delete Worktree'), ['worktree', 'remove', ...mode, worktree.path]))
    }
  }
}

function addCoauthor(arg: unknown) {
  if (!isContributor(arg)) return
  const { root, contributor } = arg
  const trailer = `Co-authored-by: ${contributor.name} <${contributor.email}>`
  const input = getCommitInput(root)
  if (input.includes(trailer)) return
  setCommitInput(root, input.trim() ? `${input.trimEnd()}\n\n${trailer}` : `\n\n${trailer}`)
}

export function registerRefHandlers() {
  const handlers: Record<string, (arg?: unknown) => unknown> = {
    'gitmenu.views.switchToBranch': switchTo,
    'gitmenu.views.switchToTag': switchTo,
    'gitmenu.views.merge': mergeIntoCurrent,
    'gitmenu.views.rebaseOntoBranch': rebaseCurrentOnto,
    'gitmenu.views.renameBranch': renameBranch,
    'gitmenu.views.deleteBranch': deleteBranch,
    'gitmenu.views.createBranchFrom': createBranchFrom,
    'gitmenu.views.pushBranch': pushRef,
    'gitmenu.views.pushTag': pushRef,
    'gitmenu.views.deleteTag': deleteTag,
    'gitmenu.views.compareRefWithHead': async (arg) => {
      if (isRef(arg)) await addResult(arg.root, { id: `compare:${arg.ref.short}..HEAD`, kind: 'compare', base: arg.ref.short, head: 'HEAD' })
    },
    'gitmenu.openBranchOnRemote': (arg) => openRefOnRemote(arg, false),
    'gitmenu.copyRemoteBranchUrl': (arg) => openRefOnRemote(arg, true),
    'gitmenu.views.copyRefName': (arg) => (isRef(arg) ? copy(arg.ref.short) : undefined),

    'gitmenu.views.fetchRemote': (arg) => (isRemote(arg) ? guard(() => exec(arg.root, 'fetch', gl('Fetch'), ['fetch', arg.remote])) : undefined),
    'gitmenu.views.pruneRemote': (arg) => (isRemote(arg) ? guard(() => exec(arg.root, 'fetch', gl('Prune'), ['remote', 'prune', arg.remote])) : undefined),
    'gitmenu.views.removeRemote': async (arg) => {
      if (!isRemote(arg)) return
      if (!(await confirm(gl('Remove the remote {0}?', arg.remote), gl('Remove'), { destructive: true }))) return
      await guard(() => exec(arg.root, 'other', gl('Remove Remote'), ['remote', 'remove', arg.remote]))
    },
    'gitmenu.openRemoteOnRemote': async (arg) => {
      if (!isRemote(arg) || !arg.url) return
      const provider = providerFor(arg.url, setting<RemoteSetting[] | null>('gitmenu.remotes') ?? [])
      if (provider) await ipc.openPath(provider.repository())
    },
    'gitmenu.views.copyRemoteUrl': (arg) => (isRemote(arg) && arg.url ? copy(arg.url) : undefined),

    'gitmenu.views.stash.apply': (arg) => stashCommand(arg, 'apply'),
    'gitmenu.views.stash.pop': (arg) => stashCommand(arg, 'pop'),
    'gitmenu.views.stash.delete': (arg) => stashCommand(arg, 'drop'),
    'gitmenu.views.stash.openAll': stashOpenAll,

    'gitmenu.views.openWorktree': (arg) => worktreeCommand(arg, 'open'),
    'gitmenu.views.revealWorktreeInFinder': (arg) => worktreeCommand(arg, 'finder'),
    'gitmenu.views.openWorktreeInTerminal': (arg) => worktreeCommand(arg, 'terminal'),
    'gitmenu.views.deleteWorktree': (arg) => worktreeCommand(arg, 'delete'),
    'gitmenu.views.lockWorktree': (arg) => worktreeCommand(arg, 'lock'),
    'gitmenu.views.unlockWorktree': (arg) => worktreeCommand(arg, 'unlock'),

    'gitmenu.views.addAuthor': addCoauthor,
    'gitmenu.views.copyEmail': (arg) => (isContributor(arg) ? copy(arg.contributor.email) : undefined),
  }
  for (const [id, handler] of Object.entries(handlers)) registerHandler(id, handler)
}
