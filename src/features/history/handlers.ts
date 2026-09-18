// GitLens commands on commits and files in the history views, remote links, and the
// Search & Compare commands (which reveal that view).
import { emit } from '@tauri-apps/api/event'
import { executeCommand, registerHandler } from '@/commands/registry'
import { setContext } from '@/commands/context'
import { type QuickPickItem, showInputBox, showQuickPick } from '@/components/dialogs/dialogs'
import { toastManager } from '@/components/ui/toast'
import { gl } from '@/i18n'
import { git } from '@/lib/git'
import { ipc } from '@/lib/ipc'
import { readUiState, writeUiState } from '@/lib/uiState'
import { providerFor, type Provider, type RemoteSetting } from '../remote/providers'
import { confirm, exec, guard, offerUndo, refresh, setting } from '../scm/handlers'
import { isSelection, repoFrom, scmQueryClient } from '../scm/state'
import { toggleView } from '../views/ViewContainer'
import { DEFAULT_LAYOUT, type ViewLayout } from '../views/views'
import { type CommitArg, type FileArg, openFileChange, shortSha } from './nodes'
import { pickReference, type ResultArg, type SearchCompareItem } from './SearchCompareView'
import { type FileTarget, SHOW_FILE_EVENT } from './state'

const isCommitArg = (arg: unknown): arg is CommitArg => typeof arg === 'object' && arg !== null && 'commit' in arg
const isFileArg = (arg: unknown): arg is FileArg => typeof arg === 'object' && arg !== null && 'file' in arg && 'sha' in arg

async function revealView(id: string) {
  const client = scmQueryClient()
  const layout = (await readUiState<ViewLayout>(client, 'views.layout')) ?? DEFAULT_LAYOUT
  const shown = toggleView(layout, id, true)
  writeUiState(client, 'views.layout', { ...shown, collapsed: shown.collapsed.filter((c) => c !== id) })
}

// ——— Search & Compare ———

async function addResult(root: string, item: SearchCompareItem) {
  const client = scmQueryClient()
  const key = `searchCompare.${root}`
  const items = (await readUiState<SearchCompareItem[]>(client, key)) ?? []
  writeUiState(client, key, [item, ...items.filter((i) => i.id !== item.id)])
  await revealView('searchCompare')
}

async function updateResults(root: string, fn: (items: SearchCompareItem[]) => SearchCompareItem[]) {
  const client = scmQueryClient()
  const key = `searchCompare.${root}`
  writeUiState(client, key, fn((await readUiState<SearchCompareItem[]>(client, key)) ?? []))
}

async function searchCommits(arg: unknown) {
  const root = repoFrom(arg)
  if (!root) return
  const query = await showInputBox({
    title: gl('Search Commits'),
    placeholder: gl('e.g. "Updates dependencies" author:eamodio'),
    prompt: gl('Use message: author: commit: file: change: (or =: @: #: ?: ~:) to search by fields'),
  })
  if (query?.trim()) await addResult(root, { id: `search:${query.trim()}`, kind: 'search', query: query.trim() })
}

async function compareReferences(arg: unknown) {
  const root = repoFrom(arg)
  if (!root) return
  const base = await pickReference(root, gl('Choose a reference (branch, tag, etc) to compare'))
  if (!base) return
  const head = await pickReference(root, gl('Choose a reference (branch, tag, etc) to compare with {0}', base), base)
  if (head) await addResult(root, { id: `compare:${base}..${head}`, kind: 'compare', base, head })
}

let selectedForCompare: { root: string; ref: string } | null = null

// ——— remotes ———

async function pickProvider(root: string): Promise<Provider | undefined> {
  const [remotes, status] = await Promise.all([git.remotes(root), git.status(root)])
  const settings = setting<RemoteSetting[] | null>('gitside.remotes') ?? []
  const withProvider = remotes
    .map((r) => ({ remote: r, provider: r.fetchUrl ? providerFor(r.fetchUrl, settings) : null }))
    .filter((r): r is { remote: typeof r.remote; provider: Provider } => r.provider !== null)
  if (withProvider.length === 0) {
    toastManager.add({ type: 'info', title: gl('No remote providers found') })
    return undefined
  }
  const preferred = withProvider.find((r) => r.remote.name === status.upstream?.remote) ?? withProvider.find((r) => r.remote.name === 'origin')
  if (withProvider.length === 1 || preferred) return (preferred ?? withProvider[0]).provider
  const items: QuickPickItem<Provider>[] = withProvider.map((r) => ({ label: r.remote.name, description: `${r.provider.name} · ${r.provider.path}`, value: r.provider }))
  return showQuickPick(items, { placeholder: gl('Choose which remote to open on') })
}

async function remoteUrl(arg: unknown, target: 'commit' | 'file'): Promise<string | undefined> {
  const root = repoFrom(arg)
  if (!root) return undefined
  const provider = await pickProvider(root)
  if (!provider) return undefined
  if (target === 'commit' && isCommitArg(arg)) return provider.commit(arg.commit.id)
  if (target === 'commit' && isFileArg(arg)) return provider.commit(arg.sha)
  if (target === 'file') {
    if (isFileArg(arg)) return provider.file(arg.file.path, { sha: arg.sha })
    const path = isSelection(arg) ? arg.changes[0]?.path : (arg as Partial<FileTarget> | undefined)?.path
    if (!path) return undefined
    const status = await git.status(root)
    // A pushed branch shows the file as it is on the branch; otherwise pin to the commit
    const rev = status.upstream && status.head.branch ? { branch: status.head.branch } : { sha: status.head.commit ?? 'HEAD' }
    return provider.file(path, rev)
  }
  return undefined
}

async function copy(text: string) {
  await ipc.clipboardWrite(text)
}

// ——— commit actions ———

async function cherryPick(arg: unknown) {
  if (!isCommitArg(arg)) return
  const { root, commit } = arg
  const mode = await showQuickPick(
    [
      { label: gl('Cherry Pick'), detail: gl('Will apply {0} to the current branch', shortSha(commit.id)), value: [] as string[] },
      { label: gl('Cherry Pick & Edit'), detail: gl('Will edit and apply {0} to the current branch', shortSha(commit.id)), value: ['--edit'] },
      { label: gl('Cherry Pick without Committing'), detail: gl('Will apply {0} to the current branch without committing', shortSha(commit.id)), value: ['--no-commit'] },
    ],
    { placeholder: gl('Choose a cherry-pick command') },
  )
  if (mode) await guard(() => exec(root, 'other', gl('Cherry Pick'), ['cherry-pick', ...mode, commit.id]))
}

async function revert(arg: unknown) {
  if (!isCommitArg(arg)) return
  const { root, commit } = arg
  const mode = await showQuickPick(
    [
      { label: gl('Revert'), detail: gl('Will revert {0}', shortSha(commit.id)), value: ['--no-edit'] },
      { label: gl('Revert & Edit'), detail: gl('Will revert and edit {0}', shortSha(commit.id)), value: ['--edit'] },
    ],
    { placeholder: gl('Choose a revert command') },
  )
  if (mode) await guard(() => exec(root, 'other', gl('Revert'), ['revert', ...mode, commit.id]))
}

async function reset(arg: unknown, previous: boolean) {
  if (!isCommitArg(arg)) return
  const { root, commit } = arg
  const target = previous ? `${commit.id}^` : commit.id
  const label = previous ? `${shortSha(commit.id)}^` : shortSha(commit.id)
  const mode = await showQuickPick(
    [
      { label: gl('Reset'), description: '--mixed', detail: gl('Will reset (leaves changes in the working tree) the current branch to {0}', label), value: '--mixed' },
      { label: gl('Soft Reset'), description: '--soft', detail: gl('Will soft reset (leaves changes in the index and working tree) the current branch to {0}', label), value: '--soft' },
      { label: gl('Hard Reset'), description: '--hard', detail: gl('Will hard reset (discards all changes) the current branch to {0}', label), value: '--hard' },
    ],
    { placeholder: gl('Choose how to reset the current branch') },
  )
  if (!mode) return
  await guard(async () => {
    // Hard reset throws away uncommitted work: keep a recovery point to undo with
    const recovery = mode === '--hard' ? await git.recoveryPoint(root) : null
    await exec(root, 'other', gl('Reset'), ['reset', mode, target])
    offerUndo(root, recovery, gl('Reset'))
  })
}

async function rebaseOnto(arg: unknown) {
  if (!isCommitArg(arg)) return
  const { root, commit } = arg
  if (!(await confirm(gl('Rebase the current branch onto {0}?', shortSha(commit.id)), gl('Rebase')))) return
  await guard(() => exec(root, 'other', gl('Rebase'), ['rebase', commit.id]))
}

async function switchToCommit(arg: unknown) {
  if (!isCommitArg(arg)) return
  const { root, commit } = arg
  if (!(await confirm(gl('Switch to {0}? You will be in a detached HEAD state.', shortSha(commit.id)), gl('Switch')))) return
  await guard(() => exec(root, 'checkout', gl('Switch'), ['switch', '--detach', commit.id]))
}

async function createBranchAt(arg: unknown) {
  if (!isCommitArg(arg)) return
  const { root, commit } = arg
  const name = await showInputBox({ title: gl('Create Branch'), prompt: gl('Please provide a name for the new branch'), placeholder: gl('Branch name') })
  if (!name?.trim()) return
  const mode = await showQuickPick(
    [
      { label: gl('Create Branch'), detail: gl('Will create a new branch named {0} from {1}', name.trim(), shortSha(commit.id)), value: false },
      { label: gl('Create & Switch to Branch'), detail: gl('Will create and switch to a new branch named {0} from {1}', name.trim(), shortSha(commit.id)), value: true },
    ],
    { placeholder: gl('Choose options') },
  )
  if (mode === undefined) return
  await guard(() =>
    mode
      ? exec(root, 'checkout', gl('Create & Switch to Branch'), ['switch', '-c', name.trim(), commit.id])
      : exec(root, 'other', gl('Create Branch'), ['branch', name.trim(), commit.id]),
  )
}

async function createTagAt(arg: unknown) {
  if (!isCommitArg(arg)) return
  const { root, commit } = arg
  const name = await showInputBox({ title: gl('Create Tag'), prompt: gl('Please provide a name for the new tag'), placeholder: gl('Tag name') })
  if (!name?.trim()) return
  const message = await showInputBox({ title: gl('Create Tag'), prompt: gl('Please provide an optional message to annotate the tag'), placeholder: gl('Tag message') })
  if (message === undefined) return
  const args = message.trim() ? ['tag', '-a', name.trim(), '-m', message.trim(), commit.id] : ['tag', name.trim(), commit.id]
  await guard(() => exec(root, 'other', gl('Create Tag'), args))
}

async function openAllChanges(arg: unknown, withWorking: boolean) {
  if (!isCommitArg(arg)) return
  const { root, commit } = arg
  const details = await git.commitDetails(root, commit.id)
  if (details.files.length > 10 && !(await confirm(gl('Are you sure you want to open the changes for all {0} files?', details.files.length), gl('Open Files')))) return
  for (const file of details.files) {
    if (withWorking) openWithWorking({ root, sha: commit.id, parent: commit.parents[0] ?? null, file })
    else openFileChange({ root, sha: commit.id, parent: commit.parents[0] ?? null, file })
  }
}

function openWithWorking({ root, sha, file }: FileArg) {
  const params = new URLSearchParams({ repo: root, path: file.path, left: `commit:${sha}`, right: 'worktree' })
  void ipc.detailOpen(`/detail/diff?${params}`)
}

function openRevision({ root, sha, file }: FileArg) {
  const params = new URLSearchParams({ repo: root, path: file.path, ref: sha })
  void ipc.detailOpen(`/detail/file?${params}`)
}

async function openFileHistory(arg: unknown) {
  const root = repoFrom(arg)
  if (!root) return
  const path = isFileArg(arg) ? arg.file.path : isSelection(arg) ? arg.changes[0]?.path : (arg as Partial<FileTarget> | undefined)?.path
  if (!path) return
  writeUiState(scmQueryClient(), 'fileHistory.pinned', true)
  await emit(SHOW_FILE_EVENT, { root, path })
  await revealView('fileHistory')
}

export function registerHistoryHandlers() {
  const commitRoot = (arg: unknown) => (isCommitArg(arg) ? arg.root : repoFrom(arg))
  const handlers: Record<string, (arg?: unknown) => unknown> = {
    'gitlens.views.searchAndCompare.searchCommits': searchCommits,
    'gitlens.views.searchAndCompare.selectForCompare': compareReferences,
    'gitlens.views.searchAndCompare.clear': async (arg) => {
      const root = repoFrom(arg)
      if (root) await updateResults(root, () => [])
    },
    'gitlens.views.dismissNode': async (arg) => {
      const { root, item } = arg as ResultArg
      await updateResults(root, (items) => items.filter((i) => i.id !== item.id))
    },
    'gitlens.views.swapComparison': async (arg) => {
      const { root, item } = arg as ResultArg
      if (item.kind !== 'compare') return
      const swapped: SearchCompareItem = { id: `compare:${item.head}..${item.base}`, kind: 'compare', base: item.head, head: item.base }
      await updateResults(root, (items) => items.map((i) => (i.id === item.id ? swapped : i)))
    },
    'gitlens.views.compareWithHead': async (arg) => {
      if (!isCommitArg(arg)) return
      await addResult(arg.root, { id: `compare:${arg.commit.id}..HEAD`, kind: 'compare', base: arg.commit.id, head: 'HEAD' })
    },
    'gitlens.views.selectForCompare': (arg) => {
      if (!isCommitArg(arg)) return
      selectedForCompare = { root: arg.root, ref: arg.commit.id }
      setContext('gitlens:views:canCompare', true)
    },
    'gitlens.views.compareWithSelected': async (arg) => {
      if (!isCommitArg(arg) || !selectedForCompare || selectedForCompare.root !== arg.root) return
      const base = selectedForCompare.ref
      selectedForCompare = null
      setContext('gitlens:views:canCompare', false)
      await addResult(arg.root, { id: `compare:${base}..${arg.commit.id}`, kind: 'compare', base, head: arg.commit.id })
    },

    'gitlens.copyShaToClipboard': (arg) => {
      const sha = isCommitArg(arg) ? arg.commit.id : isFileArg(arg) ? arg.sha : null
      if (sha) return copy(sha)
    },
    'gitlens.copyMessageToClipboard': async (arg) => {
      if (!isCommitArg(arg)) return
      await copy((await git.commitDetails(arg.root, arg.commit.id)).message)
    },
    'gitlens.openCommitOnRemote': async (arg) => {
      const url = await remoteUrl(arg, 'commit')
      if (url) await ipc.openPath(url)
    },
    'gitlens.copyRemoteCommitUrl': async (arg) => {
      const url = await remoteUrl(arg, 'commit')
      if (url) await copy(url)
    },
    'gitlens.openFileOnRemote': async (arg) => {
      const url = await remoteUrl(arg, 'file')
      if (url) await ipc.openPath(url)
    },
    'gitlens.copyRemoteFileUrlToClipboard': async (arg) => {
      const url = await remoteUrl(arg, 'file')
      if (url) await copy(url)
    },
    'gitlens.openRepoOnRemote': async (arg) => {
      const root = repoFrom(arg)
      const provider = root ? await pickProvider(root) : undefined
      if (provider) await ipc.openPath(provider.repository())
    },

    'gitlens.views.cherryPick': cherryPick,
    'gitlens.views.revert': revert,
    'gitlens.views.resetToCommit': (arg) => reset(arg, false),
    'gitlens.views.resetCommit': (arg) => reset(arg, true),
    'gitlens.views.rebaseOntoCommit': rebaseOnto,
    'gitlens.views.switchToCommit': switchToCommit,
    'gitlens.views.createBranch': createBranchAt,
    'gitlens.views.createTag': createTagAt,
    'gitlens.views.openChanges': (arg) => (isFileArg(arg) ? openFileChange(arg) : openAllChanges(arg, false)),
    'gitlens.views.openChangesWithWorking': (arg) => (isFileArg(arg) ? openWithWorking(arg) : openAllChanges(arg, true)),
    'gitlens.views.openFile': (arg) => {
      if (isFileArg(arg)) void ipc.openPath(`${arg.root}/${arg.file.path}`)
    },
    'gitlens.views.openFileRevision': (arg) => {
      if (isFileArg(arg)) openRevision(arg)
    },
    'gitlens.openFileHistory': openFileHistory,

    'gitlens.views.refresh': (arg) => {
      const root = commitRoot(arg)
      if (root) refresh(root)
    },
    'gitlens.views.push': (arg) => executeCommand('git.push', repoFrom(arg)),
    'gitlens.views.pull': (arg) => executeCommand('git.pull', repoFrom(arg)),
    'gitlens.views.fetch': (arg) => executeCommand('git.fetch', repoFrom(arg)),
    'gitlens.views.publishBranch': (arg) => executeCommand('git.publish', repoFrom(arg)),
  }
  for (const [id, handler] of Object.entries(handlers)) registerHandler(id, handler)
}
