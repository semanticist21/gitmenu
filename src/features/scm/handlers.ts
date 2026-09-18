// Implementations of the VS Code git commands declared in contribution.ts. Messages and
// safety prompts follow the git extension (same text, so its translations apply).
import { registerHandler } from '@/commands/registry'
import { type QuickPickItem, showInputBox, showMessage, showQuickPick } from '@/components/dialogs/dialogs'
import { toastManager } from '@/components/ui/toast'
import { t, vs, vsb } from '@/i18n'
import { type CommitOptions, type FileChange, git, type OpKind, type RefInfo, type RepoStatus } from '@/lib/git'
import { errorMessage, ipc, isIpcError } from '@/lib/ipc'
import { settingsQuery, settingDefault } from '@/settings/settings'
import { statusQuery } from './api'
import {
  type GroupId,
  getCommitInput,
  isSelection,
  repoFrom,
  type ScmSelection,
  scmQueryClient,
  setCommitInput,
} from './state'

// ——— helpers ———

function setting<T>(key: string): T {
  const values = scmQueryClient().getQueryData<Record<string, unknown>>(settingsQuery.queryKey) ?? {}
  return (key in values ? values[key] : settingDefault(key)) as T
}

async function setSetting(key: string, value: unknown) {
  await ipc.settingsSet(key, value)
}

async function freshStatus(root: string): Promise<RepoStatus> {
  return scmQueryClient().fetchQuery({ ...statusQuery(root), staleTime: 0 })
}

function refresh(root: string) {
  void scmQueryClient().invalidateQueries({ queryKey: ['repo', root] })
}

// Errors from queued git commands are shown by the ops bar; everything else is shown here
const REPORTED = new Set(['git', 'indexLocked', 'cancelled', 'gitMissing'])

async function guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (error) {
    if (!(isIpcError(error) && REPORTED.has(error.kind))) {
      toastManager.add({ type: 'error', title: errorMessage(error) })
    }
    return undefined
  }
}

/** A modal yes/no in VS Code's style; `neverAgainSetting` adds "Don't Show Again". */
async function confirm(message: string, ok: string, options: { detail?: string; neverAgainSetting?: string; destructive?: boolean } = {}) {
  const buttons = [{ label: ok, value: 'ok', variant: options.destructive ? ('destructive' as const) : undefined }]
  if (options.neverAgainSetting) buttons.push({ label: vsb("OK, Don't Show Again"), value: 'never', variant: undefined })
  const answer = await showMessage({ message, detail: options.detail, buttons })
  if (!answer) return false
  if (answer.value === 'never' && options.neverAgainSetting) await setSetting(options.neverAgainSetting, false)
  return true
}

function requireRepo(arg: unknown): string | null {
  const root = repoFrom(arg)
  if (!root) toastManager.add({ type: 'info', title: t('project.empty.title') })
  return root
}

function selections(args: unknown[]): ScmSelection[] {
  const flat = args.flat()
  return flat.filter(isSelection)
}

function pathsOf(changes: FileChange[]): string[] {
  const paths = new Set<string>()
  for (const change of changes) {
    paths.add(change.path)
    if (change.originalPath) paths.add(change.originalPath)
  }
  return [...paths]
}

function basename(path: string) {
  return path.split('/').pop() ?? path
}

async function exec(root: string, kind: OpKind, label: string, args: string[]) {
  const out = await git.exec(root, kind, label, args)
  refresh(root)
  return out
}

/** Offers an undo for a recovery point made before a destructive change. */
function offerUndo(root: string, recovery: string | null, title: string) {
  if (!recovery) return
  toastManager.add({
    type: 'success',
    title,
    actionProps: {
      children: t('scm.undo'),
      onClick: () =>
        void guard(async () => {
          await exec(root, 'other', t('scm.undo'), ['stash', 'apply', '--index', recovery])
        }),
    },
  })
}

const hasConflictMarkers = (text: string) => /^<{7}(?: |$)|^={7}$|^>{7}(?: |$)/m.test(text)

// ——— pickers ———

async function refs(root: string): Promise<RefInfo[]> {
  const list = await git.refs(root)
  const byDate = setting<string>('git.branchSortOrder') === 'committerdate'
  return list.sort((a, b) => (byDate ? (b.time ?? 0) - (a.time ?? 0) : a.short.localeCompare(b.short)))
}

function refItem(ref: RefInfo): QuickPickItem<RefInfo> {
  const kind =
    ref.kind === 'remote'
      ? vsb('Remote branch at {0}', ref.commit?.slice(0, 8) ?? '')
      : ref.kind === 'tag'
        ? vsb('Tag at {0}', ref.commit?.slice(0, 8) ?? '')
        : ref.commit?.slice(0, 8)
  return { label: ref.short, description: kind, detail: ref.subject ?? undefined, value: ref }
}

async function pickRef(root: string, placeholder: string, kinds: RefInfo['kind'][], exclude?: string) {
  const list = (await refs(root)).filter((r) => kinds.includes(r.kind) && r.short !== exclude)
  return showQuickPick(list.map(refItem), { placeholder })
}

async function pickRemote(root: string, placeholder: string): Promise<string | undefined> {
  const status = await freshStatus(root)
  if (status.remotes.length === 0) {
    toastManager.add({ type: 'info', title: vsb('Your repository has no remotes.') })
    return undefined
  }
  if (status.remotes.length === 1) return status.remotes[0]
  return showQuickPick(
    status.remotes.map((r) => ({ label: r, value: r })),
    { placeholder },
  )
}

async function branchName(title: string, value = ''): Promise<string | undefined> {
  const prefix = setting<string>('git.branchPrefix')
  const whitespace = setting<string>('git.branchWhitespaceChar')
  const regex = setting<string>('git.branchValidationRegex')
  const name = await showInputBox({
    title,
    placeholder: vsb('Branch name'),
    value: value || prefix,
    validate: (input) => {
      const sanitized = input.trim().replace(/\s+/g, whitespace)
      if (!sanitized) return undefined
      if (regex && !new RegExp(regex).test(sanitized)) return vsb('Branch name needs to match regex: {0}', regex)
      if (/\.\.|[~^:?*[\\]|^[-/]|[/.]$|\.lock$|@\{/.test(sanitized)) return vsb('Invalid branch name')
      return undefined
    },
  })
  return name?.trim().replace(/\s+/g, whitespace) || undefined
}

// ——— resources ———

async function stage(args: unknown[]) {
  for (const selection of selections(args)) {
    let changes = selection.changes
    if (selection.group === 'merge') {
      // VS Code asks before staging files that still contain conflict markers
      const withMarkers: FileChange[] = []
      for (const change of changes) {
        const text = await readText(`${selection.root}/${change.path}`)
        if (text && hasConflictMarkers(text)) withMarkers.push(change)
      }
      if (withMarkers.length > 0) {
        const message =
          withMarkers.length === 1
            ? vsb('Are you sure you want to stage {0} with merge conflicts?', basename(withMarkers[0].path))
            : vsb('Are you sure you want to stage {0} files with merge conflicts?', withMarkers.length)
        if (!(await confirm(message, vs('command.stage')))) changes = changes.filter((c) => !withMarkers.includes(c))
      }
    }
    if (changes.length) await git.stage(selection.root, pathsOf(changes), vs('command.stage'))
    refresh(selection.root)
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string>('read_text_file', { path, maxBytes: 2_000_000 })
  } catch {
    return null
  }
}

async function unstage(args: unknown[]) {
  for (const selection of selections(args)) {
    await git.unstage(selection.root, pathsOf(selection.changes), vs('command.unstage'))
    refresh(selection.root)
  }
}

async function discard(root: string, changes: FileChange[], all: boolean) {
  const untracked = changes.filter((c) => c.status === 'untracked' || c.status === 'intentToAdd')
  const tracked = changes.filter((c) => !untracked.includes(c))
  if (changes.length === 0) return
  let message: string
  let ok: string
  if (changes.length === 1 && !all) {
    const name = basename(changes[0].path)
    message = untracked.length ? t('scm.trashQuestion', name) : vsb("Are you sure you want to discard changes in '{0}'?", name)
    ok = untracked.length ? vsb('Move to Trash') : vsb('Discard File')
  } else {
    message = vsb("Are you sure you want to discard ALL changes in {0} files?\n\nThis is IRREVERSIBLE!\nYour current working set will be FOREVER LOST if you proceed.", changes.length).split('\n')[0]
    ok = tracked.length && !untracked.length ? vsb('Discard All {0} Tracked Files', tracked.length) : vsb('Discard All {0} Files', changes.length)
  }
  const detail = untracked.length && setting<boolean>('git.discardUntrackedChangesToTrash') ? t('scm.trashDetail') : t('scm.recoveryDetail')
  if (!(await confirm(message, ok, { detail, destructive: true }))) return
  const result = await git.discard(root, pathsOf(tracked), untracked.map((c) => c.path), vs('command.clean'))
  refresh(root)
  offerUndo(root, result.recovery, t('scm.discarded', changes.length))
}

async function clean(args: unknown[]) {
  for (const selection of selections(args)) await discard(selection.root, selection.changes, false)
}

function groupChanges(status: RepoStatus, group: GroupId | 'all' | 'allTracked'): FileChange[] {
  const mixed = setting<string>('git.untrackedChanges') === 'mixed'
  switch (group) {
    case 'merge':
      return status.merge
    case 'index':
      return status.index
    case 'workingTree':
      return mixed ? [...status.workingTree, ...status.untracked] : status.workingTree
    case 'untracked':
      return status.untracked
    case 'allTracked':
      return status.workingTree
    case 'all':
      return mixed ? [...status.workingTree, ...status.untracked] : status.workingTree
  }
}

async function groupCommand(arg: unknown, group: GroupId | 'all' | 'allTracked', action: 'stage' | 'clean') {
  const root = requireRepo(arg)
  if (!root) return
  const status = await freshStatus(root)
  const changes = isSelection(arg) && group === arg.group ? arg.changes : groupChanges(status, group)
  if (action === 'stage') {
    if (changes.length) await git.stage(root, pathsOf(changes), vs('command.stageAll'))
    refresh(root)
  } else {
    await discard(root, changes, true)
  }
}

async function unstageAll(arg: unknown) {
  const root = requireRepo(arg)
  if (!root) return
  const status = await freshStatus(root)
  if (status.index.length) await git.unstage(root, pathsOf(status.index), vs('command.unstageAll'))
  refresh(root)
}

function openChange(args: unknown[], ref: 'change' | 'head') {
  for (const selection of selections(args)) {
    for (const change of selection.changes) {
      const params = new URLSearchParams({ repo: selection.root, path: change.path, group: selection.group })
      if (change.originalPath) params.set('original', change.originalPath)
      if (ref === 'head') params.set('ref', 'HEAD')
      void ipc.detailOpen(`/detail/${ref === 'head' ? 'file' : 'diff'}?${params}`)
    }
  }
}

function viewGroup(arg: unknown, group: GroupId) {
  const root = repoFrom(arg)
  if (!root) return
  void ipc.detailOpen(`/detail/changes?${new URLSearchParams({ repo: root, group })}`)
}

// ——— commit ———

interface CommitRequest {
  scope: 'default' | 'staged' | 'all'
  amend?: boolean
  signoff?: boolean
  noVerify?: boolean
  empty?: boolean
}

async function commit(arg: unknown, request: CommitRequest): Promise<boolean> {
  const root = requireRepo(arg)
  if (!root) return false
  const status = await freshStatus(root)
  if (status.merge.length > 0) {
    toastManager.add({ type: 'error', title: vsb('There are merge conflicts. Please resolve them before committing your changes.') })
    return false
  }
  if (request.noVerify) {
    if (!setting<boolean>('git.allowNoVerifyCommit')) {
      toastManager.add({ type: 'error', title: vsb('Commits without verification are not allowed, please enable them with the "git.allowNoVerifyCommit" setting.') })
      return false
    }
    if (
      setting<boolean>('git.confirmNoVerifyCommit') &&
      !(await confirm(
        vsb('You are about to commit your changes without verification, this skips pre-commit hooks and can be undesirable.\n\nAre you sure to continue?'),
        vsb('OK'),
        { neverAgainSetting: 'git.confirmNoVerifyCommit' },
      ))
    )
      return false
  }

  const workingChanges = [...status.workingTree, ...status.untracked]
  let stageAll = request.scope === 'all'
  if (request.scope === 'default' && status.index.length === 0 && !request.empty && !(request.amend && workingChanges.length === 0)) {
    if (workingChanges.length === 0) {
      if (!request.amend) {
        toastManager.add({ type: 'info', title: vsb('There are no changes to commit.') })
        return false
      }
    } else if (setting<boolean>('git.enableSmartCommit')) {
      stageAll = true
    } else if (setting<boolean>('git.suggestSmartCommit')) {
      const answer = await showMessage({
        message: vsb('There are no staged changes to commit.\n\nWould you like to stage all your changes and commit them directly?').split('\n')[0],
        detail: vsb('There are no staged changes to commit.\n\nWould you like to stage all your changes and commit them directly?').split('\n\n')[1],
        buttons: [
          { label: vsb('Yes'), value: 'yes' },
          { label: vsb('Always'), value: 'always' },
          { label: vsb('Never'), value: 'never', variant: 'ghost' },
        ],
      })
      if (!answer) return false
      if (answer.value === 'always') await setSetting('git.enableSmartCommit', true)
      if (answer.value === 'never') {
        await setSetting('git.suggestSmartCommit', false)
        return false
      }
      stageAll = true
    } else {
      toastManager.add({ type: 'info', title: vsb('The repository does not have any staged changes.') })
      return false
    }
  }

  if (request.empty && setting<boolean>('git.confirmEmptyCommits')) {
    if (!(await confirm(vsb('Are you sure you want to create an empty commit?'), vsb('Yes'), { neverAgainSetting: 'git.confirmEmptyCommits' }))) return false
  }

  if (stageAll) {
    // smartCommitChanges "all" includes untracked files, "tracked" only tracked ones
    const include = setting<string>('git.smartCommitChanges') === 'all' ? workingChanges : status.workingTree
    if (include.length) await git.stage(root, pathsOf(include), vs('command.stageAll'))
  }

  const message = getCommitInput(root)
  const options: CommitOptions = {
    amend: request.amend,
    signoff: request.signoff || setting<boolean>('git.alwaysSignOff'),
    noVerify: request.noVerify,
    allowEmpty: request.empty,
  }
  if (!message.trim()) {
    if (request.amend) options.noEdit = true
    else if (setting<boolean>('git.useEditorAsCommitInput')) options.edit = true
    else {
      toastManager.add({ type: 'info', title: vsb('Please provide a commit message') })
      return false
    }
  }
  const ok = await guard(() => git.commit(root, message, options, vs('command.commit')))
  refresh(root)
  if (ok === undefined) return false
  setCommitInput(root, '')

  const post = setting<string>('git.postCommitCommand')
  if (post === 'push') await push(root, {})
  else if (post === 'sync') await sync(root, false)
  return true
}

async function undoCommit(arg: unknown) {
  const root = requireRepo(arg)
  if (!root) return
  const status = await freshStatus(root)
  if (!status.head.commit) {
    toastManager.add({ type: 'info', title: vsb("Can't undo because HEAD doesn't point to any commit.") })
    return
  }
  const message = await git.headMessage(root)
  const parents = (await git.exec(root, 'other', 'git rev-list', ['rev-list', '--parents', '-n', '1', 'HEAD'])).stdout.trim().split(' ')
  if (parents.length > 2 && !(await confirm(vsb('The last commit was a merge commit. Are you sure you want to undo it?'), vsb('Undo merge commit')))) return
  // The first commit has no parent: move HEAD back to "unborn" by deleting the branch ref
  if (parents.length === 1) await exec(root, 'other', vs('command.undoCommit'), ['update-ref', '-d', 'HEAD'])
  else await exec(root, 'other', vs('command.undoCommit'), ['reset', '--soft', 'HEAD~'])
  if (message) setCommitInput(root, message)
}

// ——— sync ———

async function pull(root: string, extra: string[] = []) {
  const status = await freshStatus(root)
  if (!status.upstream && extra.length === 0) {
    if (status.remotes.length === 0) {
      toastManager.add({ type: 'info', title: vsb('Your repository has no remotes configured to pull from.') })
      return
    }
  }
  if (setting<boolean>('git.fetchOnPull')) await exec(root, 'fetch', vs('command.fetch'), ['fetch', '--all'])
  const args = ['pull']
  if (setting<boolean>('git.pullTags')) args.push('--tags')
  if (setting<boolean>('git.autoStash')) args.push('--autostash')
  await exec(root, 'pull', vs('command.pull'), [...args, ...extra])
}

async function push(root: string, options: { force?: boolean; remote?: string; branch?: string; tags?: boolean }) {
  const status = await freshStatus(root)
  if (!status.head.branch) {
    toastManager.add({ type: 'info', title: vsb('Please check out a branch to push to a remote.') })
    return
  }
  if (options.force) {
    if (!setting<boolean>('git.allowForcePush')) {
      toastManager.add({ type: 'error', title: vsb('Force push is not allowed, please enable it with the "git.allowForcePush" setting.') })
      return
    }
    if (
      setting<boolean>('git.confirmForcePush') &&
      !(await confirm(
        vsb('You are about to force push your changes, this can be destructive and could inadvertently overwrite changes made by others.\n\nAre you sure to continue?'),
        vsb('OK'),
        { neverAgainSetting: 'git.confirmForcePush', destructive: true },
      ))
    )
      return
  }
  if (!status.upstream && !options.remote) {
    const answer = await confirm(vsb('The branch "{0}" has no remote branch. Would you like to publish this branch?', status.head.branch), vsb('OK'))
    if (answer) await publish(root)
    return
  }
  const args = ['push']
  if (options.force) {
    args.push(setting<boolean>('git.useForcePushWithLease') ? '--force-with-lease' : '--force')
    if (setting<boolean>('git.useForcePushWithLease') && setting<boolean>('git.useForcePushIfIncludes')) args.push('--force-if-includes')
  }
  if (options.tags) args.push('--follow-tags')
  if (options.remote) args.push(options.remote, options.branch ?? status.head.branch)
  await exec(root, 'push', vs('command.push'), args)
}

async function publish(root: string) {
  const status = await freshStatus(root)
  const branch = status.head.branch
  if (!branch) return
  const remote = await pickRemote(root, vsb('Pick a remote to publish the branch "{0}" to:', branch))
  if (!remote) {
    if (status.remotes.length === 0) toastManager.add({ type: 'info', title: vsb('Your repository has no remotes configured to publish to.') })
    return
  }
  await exec(root, 'push', vsb('Publishing Branch "{0}".../{Locked="Branch"}Do not translate "Branch" as it is a git term', branch), ['push', '-u', remote, branch])
}

async function sync(root: string, rebase: boolean) {
  const status = await freshStatus(root)
  if (!status.upstream) {
    await push(root, {})
    return
  }
  if (setting<boolean>('git.confirmSync')) {
    const [remote, ...rest] = status.upstream.name.split('/')
    if (!(await confirm(vsb('This action will pull and push commits from and to "{0}/{1}".', remote, rest.join('/')), vsb('OK'), { neverAgainSetting: 'git.confirmSync' }))) return
  }
  const pullArgs = rebase || setting<boolean>('git.rebaseWhenSync') ? ['--rebase'] : []
  await pull(root, pullArgs)
  await push(root, { tags: setting<boolean>('git.followTagsWhenSync') })
}

async function fetch(root: string, extra: string[]) {
  const status = await freshStatus(root)
  if (status.remotes.length === 0) {
    toastManager.add({ type: 'info', title: vsb('This repository has no remotes configured to fetch from.') })
    return
  }
  const prune = setting<boolean>('git.pruneOnFetch') ? ['--prune'] : []
  await exec(root, 'fetch', vs('command.fetch'), ['fetch', ...prune, ...extra])
}

// ——— branches ———

async function checkout(root: string, detached: boolean) {
  const types = setting<string[]>('git.checkoutType')
  const kinds = (['branch', 'remote', 'tag'] as const).filter((k) =>
    types.includes(k === 'branch' ? 'local' : k === 'remote' ? 'remote' : 'tags'),
  )
  const status = await freshStatus(root)
  const list = (await refs(root)).filter((r) => kinds.includes(r.kind) && r.short !== status.head.branch)
  type Choice = { kind: 'ref'; ref: RefInfo } | { kind: 'new' } | { kind: 'newFrom' } | { kind: 'detached' }
  const items: QuickPickItem<Choice>[] = detached
    ? []
    : [
        { label: vsb('{0} Create new branch...', '').trim(), value: { kind: 'new' } },
        { label: vsb('{0} Create new branch from...', '').trim(), value: { kind: 'newFrom' } },
        { label: vsb('{0} Checkout detached...', '').trim(), value: { kind: 'detached' } },
      ]
  items.push(...list.map((r) => ({ ...refItem(r), value: { kind: 'ref' as const, ref: r } })))
  const choice = await showQuickPick(items, {
    placeholder: detached ? vsb('Select a branch to checkout in detached mode') : vsb('Select a branch or tag to checkout'),
  })
  if (!choice) return
  if (choice.kind === 'new') return createBranch(root, false)
  if (choice.kind === 'newFrom') return createBranch(root, true)
  if (choice.kind === 'detached') return checkout(root, true)
  const ref = choice.ref
  const label = vsb('Checking Out Branch/Tag...')
  if (detached) await exec(root, 'checkout', label, ['checkout', '-q', '--detach', ref.short])
  else if (ref.kind === 'remote') {
    const local = ref.short.split('/').slice(1).join('/')
    const exists = list.some((r) => r.kind === 'branch' && r.short === local)
    await exec(root, 'checkout', label, exists ? ['checkout', '-q', local] : ['checkout', '-q', '--track', ref.short])
  } else await exec(root, 'checkout', label, ['checkout', '-q', ref.short])
}

async function createBranch(root: string, from: boolean) {
  let base: string | undefined
  if (from) {
    const ref = await pickRef(root, vsb('Select a ref to create the branch from'), ['branch', 'remote', 'tag'])
    if (!ref) return
    base = ref.short
  }
  const name = await branchName(vsb('Please provide a new branch name'))
  if (!name) return
  await exec(root, 'checkout', vs('command.branch'), ['checkout', '-q', '-b', name, ...(base ? [base] : [])])
}

async function renameBranch(root: string) {
  const status = await freshStatus(root)
  const name = await branchName(vsb('Please provide a new branch name'), status.head.branch ?? '')
  if (!name || name === status.head.branch) return
  await exec(root, 'other', vs('command.renameBranch'), ['branch', '-m', name])
}

async function deleteBranch(root: string) {
  const status = await freshStatus(root)
  const ref = await pickRef(root, vsb('Select a branch to delete'), ['branch'], status.head.branch ?? undefined)
  if (!ref) return
  if (!(await confirm(vsb('Are you sure you want to delete branch "{0}"? This action will permanently remove the branch reference from the repository.', ref.short), vsb('Delete Branch'), { destructive: true }))) return
  try {
    await git.exec(root, 'other', vs('command.deleteBranch'), ['branch', '-d', ref.short])
  } catch (error) {
    if (isIpcError(error) && /not fully merged/.test(error.stderr ?? error.message)) {
      if (await confirm(vsb('The branch "{0}" is not fully merged. Delete anyway?', ref.short), vsb('Force Delete'), { destructive: true })) {
        await git.exec(root, 'other', vs('command.deleteBranch'), ['branch', '-D', ref.short])
      }
    } else throw error
  }
  refresh(root)
}

async function deleteRemoteBranch(root: string) {
  const status = await freshStatus(root)
  const ref = await pickRef(root, vsb('Select a remote branch to delete'), ['remote'], status.upstream?.name)
  if (!ref) return
  const [remote, ...rest] = ref.short.split('/')
  if (!(await confirm(vsb('Are you sure you want to delete branch "{0}"? This action will permanently remove the branch reference from the repository.', ref.short), vsb('Delete Branch'), { destructive: true }))) return
  await exec(root, 'push', vs('command.deleteRemoteBranch'), ['push', remote, '--delete', rest.join('/')])
}

async function mergeOrRebase(root: string, mode: 'merge' | 'rebase') {
  const status = await freshStatus(root)
  const ref = await pickRef(
    root,
    mode === 'merge' ? vsb('Select a branch or tag to merge from') : vsb('Select a branch to rebase onto'),
    mode === 'merge' ? ['branch', 'remote', 'tag'] : ['branch', 'remote'],
    status.head.branch ?? undefined,
  )
  if (!ref) return
  await exec(root, 'other', vs(`command.${mode}`), [mode, ref.short])
}

// ——— stash, tags, remotes, worktrees ———

async function stash(root: string, flags: string[]) {
  const status = await freshStatus(root)
  if (!status.head.commit) {
    toastManager.add({ type: 'info', title: vsb('The repository does not have any commits. Please make an initial commit before creating a stash.') })
    return
  }
  const staged = flags.includes('--staged')
  const nothing = staged ? status.index.length === 0 : status.index.length + status.workingTree.length + (flags.includes('-u') ? status.untracked.length : 0) === 0
  if (nothing) {
    toastManager.add({ type: 'info', title: staged ? vsb('There are no staged changes to stash.') : vsb('There are no changes to stash.') })
    return
  }
  const useInput = setting<boolean>('git.useCommitInputAsStashMessage') && getCommitInput(root).trim()
  const message = useInput
    ? getCommitInput(root).trim()
    : await showInputBox({ title: vsb('Stash message'), placeholder: vsb('Optionally provide a stash message') })
  if (message === undefined) return
  await exec(root, 'other', vs('command.stash'), ['stash', 'push', ...flags, ...(message ? ['-m', message] : [])])
  if (useInput) setCommitInput(root, '')
}

async function pickStash(root: string, placeholder: string): Promise<number | undefined> {
  const stashes = await git.stashes(root)
  if (stashes.length === 0) {
    toastManager.add({ type: 'info', title: vsb('There are no stashes in the repository.') })
    return undefined
  }
  return showQuickPick(
    stashes.map((s) => ({ label: `#${s.index}: ${s.message}`, value: s.index })),
    { placeholder },
  )
}

async function stashApply(root: string, pop: boolean, latest: boolean) {
  const index = latest ? 0 : await pickStash(root, pop ? vsb('Pick a stash to pop') : vsb('Pick a stash to apply'))
  if (index === undefined) return
  if (latest && (await git.stashes(root)).length === 0) {
    toastManager.add({ type: 'info', title: vsb('There are no stashes in the repository.') })
    return
  }
  await exec(root, 'other', vs(pop ? 'command.stashPop' : 'command.stashApply'), ['stash', pop ? 'pop' : 'apply', '--index', `stash@{${index}}`])
}

async function stashDrop(root: string, all: boolean) {
  if (all) {
    const count = (await git.stashes(root)).length
    if (count === 0) {
      toastManager.add({ type: 'info', title: vsb('There are no stashes in the repository.') })
      return
    }
    const message =
      count === 1
        ? vsb('Are you sure you want to drop ALL stashes? There is 1 stash that will be subject to pruning, and MAY BE IMPOSSIBLE TO RECOVER.')
        : vsb('Are you sure you want to drop ALL stashes? There are {0} stashes that will be subject to pruning, and MAY BE IMPOSSIBLE TO RECOVER.', count)
    if (!(await confirm(message, vs('command.stashDropAll'), { destructive: true }))) return
    await exec(root, 'other', vs('command.stashDropAll'), ['stash', 'clear'])
    return
  }
  const index = await pickStash(root, vsb('Pick a stash to drop'))
  if (index === undefined) return
  const stashes = await git.stashes(root)
  if (!(await confirm(vsb('Are you sure you want to drop the stash: {0}?', stashes[index]?.message ?? `stash@{${index}}`), vs('command.stashDrop'), { destructive: true }))) return
  await exec(root, 'other', vs('command.stashDrop'), ['stash', 'drop', `stash@{${index}}`])
}

async function createTag(root: string) {
  const name = await showInputBox({ title: vsb('Please provide a tag name'), placeholder: vsb('Tag name') })
  if (!name?.trim()) return
  const message = await showInputBox({ title: vsb('Please provide a message to annotate the tag') })
  if (message === undefined) return
  const args = message.trim() ? ['tag', '-a', name.trim(), '-m', message] : ['tag', name.trim()]
  await exec(root, 'other', vs('command.createTag'), args)
}

async function deleteTag(root: string) {
  const ref = await pickRef(root, vsb('Select a tag to delete'), ['tag'])
  if (!ref) return
  if (!(await confirm(vsb('Are you sure you want to delete tag "{0}"? This action will permanently remove the tag reference from the repository.', ref.short), vsb('Delete Tag'), { destructive: true }))) return
  await exec(root, 'other', vs('command.deleteTag'), ['tag', '-d', ref.short])
}

async function deleteRemoteTag(root: string) {
  const remote = await pickRemote(root, vsb('Select a remote to delete a tag from'))
  if (!remote) return
  const out = await git.exec(root, 'fetch', vs('command.deleteRemoteTag'), ['ls-remote', '--tags', '--refs', remote])
  const tags = out.stdout
    .split('\n')
    .map((l) => l.split('\t')[1]?.replace('refs/tags/', ''))
    .filter(Boolean) as string[]
  if (tags.length === 0) {
    toastManager.add({ type: 'info', title: vsb('$(info) Remote "{0}" has no tags.', remote).replace('$(info) ', '') })
    return
  }
  const tag = await showQuickPick(tags.map((tag) => ({ label: tag, value: tag })), { placeholder: vsb('Select a remote tag to delete') })
  if (!tag) return
  await exec(root, 'push', vs('command.deleteRemoteTag'), ['push', remote, '--delete', `refs/tags/${tag}`])
}

async function addRemote(root: string) {
  const url = await showInputBox({ title: vsb('Add remote from URL'), placeholder: 'https://github.com/owner/repo.git' })
  if (!url?.trim()) return
  const status = await freshStatus(root)
  const name = await showInputBox({
    title: vsb('Please provide a remote name'),
    placeholder: vsb('Remote name'),
    value: status.remotes.length === 0 ? 'origin' : '',
    validate: (v) =>
      !v.trim() ? undefined : status.remotes.includes(v.trim()) ? vsb('Remote "{0}" already exists.', v.trim()) : /\s/.test(v) ? vsb('Remote name format invalid') : undefined,
  })
  if (!name?.trim()) return
  await exec(root, 'other', vs('command.addRemote'), ['remote', 'add', name.trim(), url.trim()])
}

async function removeRemote(root: string) {
  const status = await freshStatus(root)
  if (status.remotes.length === 0) {
    toastManager.add({ type: 'info', title: vsb('Your repository has no remotes.') })
    return
  }
  const remote = await showQuickPick(status.remotes.map((r) => ({ label: r, value: r })), { placeholder: vsb('Pick a remote to remove') })
  if (!remote) return
  await exec(root, 'other', vs('command.removeRemote'), ['remote', 'remove', remote])
}

async function createWorktree(root: string) {
  const ref = await pickRef(root, vsb('Select a branch or tag to create the new worktree from'), ['branch', 'remote', 'tag'])
  if (!ref) return
  const parent = await ipc.pickFolder(vsb('Select Worktree Destination'))
  if (!parent) return
  const name = await showInputBox({ title: vsb('Please provide a worktree path'), placeholder: vsb('Worktree path'), value: `${basename(root)}.${ref.short.replace(/\//g, '-')}` })
  if (!name?.trim()) return
  const path = `${parent}/${name.trim()}`
  await exec(root, 'other', vs('command.createWorktree'), ['worktree', 'add', path, ref.short])
  await ipc.projectOpen(path)
}

async function deleteWorktree(root: string) {
  if (!(await confirm(t('scm.deleteWorktree', basename(root)), vs('command.deleteWorktree2'), { destructive: true }))) return
  try {
    await git.exec(root, 'other', vs('command.deleteWorktree2'), ['worktree', 'remove', root])
  } catch (error) {
    if (isIpcError(error) && /modified or untracked/.test(error.stderr ?? '')) {
      if (await confirm(vsb('The worktree contains modified or untracked files. Do you want to force delete?'), vsb('Force Delete'), { destructive: true }))
        await git.exec(root, 'other', vs('command.deleteWorktree2'), ['worktree', 'remove', '--force', root])
    } else throw error
  }
}

async function clone() {
  const url = await showInputBox({ title: vsb('Clone from URL'), placeholder: 'https://github.com/owner/repo.git' })
  if (!url?.trim()) return
  const parent = setting<string | null>('git.defaultCloneDirectory') || (await ipc.pickFolder(vsb('Choose a folder to clone {0} into', url.trim())))
  if (!parent) return
  const dest = await git.clone(parent, url.trim(), vs('command.clone'))
  await ipc.projectOpen(dest)
}

async function init() {
  const folder = await ipc.pickFolder(vsb('Pick workspace folder to initialize git repo in'))
  if (!folder) return
  const project = await ipc.projectOpen(folder)
  if (project.repos.length === 0) await ipc.projectInitRepo(project.id)
}

async function continueOperation(root: string) {
  const status = await freshStatus(root)
  if (status.merge.length > 0) {
    toastManager.add({ type: 'error', title: vsb('There are merge conflicts. Please resolve them before committing your changes.') })
    return
  }
  const op = status.operation
  if (op === 'merge') await exec(root, 'commit', vsb('Continuing Merge...'), ['commit', '--no-edit'])
  else if (op === 'rebase') await exec(root, 'commit', vsb('Continuing Rebase...'), ['rebase', '--continue'])
  else if (op === 'cherryPick') await exec(root, 'commit', vs('command.cherryPick'), ['cherry-pick', '--continue'])
  else if (op === 'revert') await exec(root, 'commit', 'git revert --continue', ['revert', '--continue'])
}

async function abortOperation(root: string) {
  const status = await freshStatus(root)
  const op = status.operation
  if (op === 'merge') await exec(root, 'other', 'git merge --abort', ['merge', '--abort'])
  else if (op === 'rebase') await exec(root, 'other', vs('command.rebaseAbort'), ['rebase', '--abort'])
  else if (op === 'cherryPick') await exec(root, 'other', 'git cherry-pick --abort', ['cherry-pick', '--abort'])
  else if (op === 'revert') await exec(root, 'other', 'git revert --abort', ['revert', '--abort'])
}

/** The action button's "Commit & Push" / "Commit & Sync". */
export async function commitAndThen(arg: unknown, then: 'push' | 'sync') {
  const root = repoFrom(arg)
  if (!root) return
  const committed = await commit(root, { scope: 'default' })
  if (!committed) return
  // postCommitCommand may already have pushed or synced
  if (setting<string>('git.postCommitCommand') === then) return
  await guard(() => (then === 'push' ? push(root, {}) : sync(root, false)))
}

// ——— registration ———

type Handler = (...args: unknown[]) => unknown

function withRepo(fn: (root: string, ...args: unknown[]) => Promise<unknown>): Handler {
  return (arg?: unknown, ...rest: unknown[]) => {
    const root = requireRepo(arg)
    if (root) return guard(() => fn(root, ...rest))
  }
}

export function registerScmHandlers() {
  const handlers: Record<string, Handler> = {
    'git.refresh': (arg) => {
      const root = repoFrom(arg)
      if (root) refresh(root)
    },
    'git.stage': (...args) => guard(() => stage(args)),
    'git.unstage': (...args) => guard(() => unstage(args)),
    'git.clean': (...args) => guard(() => clean(args)),
    'git.stageAll': (arg) => guard(() => groupCommand(arg, 'all', 'stage')),
    'git.stageAllTracked': (arg) => guard(() => groupCommand(arg, 'allTracked', 'stage')),
    'git.stageAllUntracked': (arg) => guard(() => groupCommand(arg, 'untracked', 'stage')),
    'git.stageAllMerge': (arg) => guard(() => groupCommand(arg, 'merge', 'stage')),
    'git.cleanAll': (arg) => guard(() => groupCommand(arg, 'all', 'clean')),
    'git.cleanAllTracked': (arg) => guard(() => groupCommand(arg, 'allTracked', 'clean')),
    'git.cleanAllUntracked': (arg) => guard(() => groupCommand(arg, 'untracked', 'clean')),
    'git.unstageAll': (arg) => guard(() => unstageAll(arg)),
    'git.openChange': (...args) => openChange(args, 'change'),
    'git.openHEADFile': (...args) => openChange(args, 'head'),
    'git.openFile': (...args) => {
      for (const s of selections(args)) for (const c of s.changes) void ipc.openPath(`${s.root}/${c.path}`)
    },
    'git.openFile2': (...args) => {
      for (const s of selections(args)) for (const c of s.changes) void ipc.openPath(`${s.root}/${c.path}`)
    },
    'git.revealFileInOS.mac': (...args) => {
      for (const s of selections(args)) for (const c of s.changes) void ipc.revealInFinder(`${s.root}/${c.path}`)
    },
    'git.ignore': (...args) =>
      guard(async () => {
        for (const s of selections(args)) {
          await git.ignore(s.root, s.changes.map((c) => c.path))
          refresh(s.root)
        }
      }),
    'git.viewChanges': (arg) => viewGroup(arg, 'workingTree'),
    'git.viewStagedChanges': (arg) => viewGroup(arg, 'index'),
    'git.viewUntrackedChanges': (arg) => viewGroup(arg, 'untracked'),

    'git.commit': (arg) => commit(arg, { scope: 'default' }),
    'git.commitStaged': (arg) => commit(arg, { scope: 'staged' }),
    'git.commitAll': (arg) => commit(arg, { scope: 'all' }),
    'git.commitNoVerify': (arg) => commit(arg, { scope: 'default', noVerify: true }),
    'git.commitStagedNoVerify': (arg) => commit(arg, { scope: 'staged', noVerify: true }),
    'git.commitAllNoVerify': (arg) => commit(arg, { scope: 'all', noVerify: true }),
    'git.commitAmend': (arg) => commit(arg, { scope: 'default', amend: true }),
    'git.commitStagedAmend': (arg) => commit(arg, { scope: 'staged', amend: true }),
    'git.commitAllAmend': (arg) => commit(arg, { scope: 'all', amend: true }),
    'git.commitAmendNoVerify': (arg) => commit(arg, { scope: 'default', amend: true, noVerify: true }),
    'git.commitStagedAmendNoVerify': (arg) => commit(arg, { scope: 'staged', amend: true, noVerify: true }),
    'git.commitAllAmendNoVerify': (arg) => commit(arg, { scope: 'all', amend: true, noVerify: true }),
    'git.commitSigned': (arg) => commit(arg, { scope: 'default', signoff: true }),
    'git.commitStagedSigned': (arg) => commit(arg, { scope: 'staged', signoff: true }),
    'git.commitAllSigned': (arg) => commit(arg, { scope: 'all', signoff: true }),
    'git.commitSignedNoVerify': (arg) => commit(arg, { scope: 'default', signoff: true, noVerify: true }),
    'git.commitStagedSignedNoVerify': (arg) => commit(arg, { scope: 'staged', signoff: true, noVerify: true }),
    'git.commitAllSignedNoVerify': (arg) => commit(arg, { scope: 'all', signoff: true, noVerify: true }),
    'git.commitEmpty': (arg) => commit(arg, { scope: 'staged', empty: true }),
    'git.undoCommit': withRepo((root) => undoCommit(root)),
    'git.rebaseAbort': withRepo((root) => exec(root, 'other', vs('command.rebaseAbort'), ['rebase', '--abort'])),
    'git.continueOperation': withRepo((root) => continueOperation(root)),
    'git.abortOperation': withRepo((root) => abortOperation(root)),

    'git.pull': withRepo((root) => pull(root)),
    'git.pullRebase': withRepo((root) => pull(root, ['--rebase'])),
    'git.pullFrom': withRepo(async (root) => {
      const remote = await pickRemote(root, vsb('Pick a remote to pull the branch from'))
      if (!remote) return
      const ref = await pickRef(root, vsb('Pick a branch to pull from'), ['remote'])
      if (!ref) return
      await pull(root, [remote, ref.short.split('/').slice(1).join('/')])
    }),
    'git.push': withRepo((root) => push(root, {})),
    'git.pushForce': withRepo((root) => push(root, { force: true })),
    'git.pushTo': withRepo(async (root) => {
      const remote = await pickRemote(root, vsb('Pick a remote to publish the branch "{0}" to:', ''))
      if (remote) await push(root, { remote })
    }),
    'git.pushToForce': withRepo(async (root) => {
      const remote = await pickRemote(root, vsb('Pick a remote to publish the branch "{0}" to:', ''))
      if (remote) await push(root, { remote, force: true })
    }),
    'git.pushTags': withRepo((root) => exec(root, 'push', vs('command.pushTags'), ['push', '--tags'])),
    'git.publish': withRepo((root) => publish(root)),
    'git.sync': withRepo((root) => sync(root, false)),
    'git.syncRebase': withRepo((root) => sync(root, true)),
    'git.fetch': withRepo((root) => fetch(root, [])),
    'git.fetchPrune': withRepo((root) => fetch(root, ['--prune'])),
    'git.fetchAll': withRepo((root) => fetch(root, ['--all'])),

    'git.checkout': withRepo((root) => checkout(root, false)),
    'git.checkoutDetached': withRepo((root) => checkout(root, true)),
    'git.branch': withRepo((root) => createBranch(root, false)),
    'git.branchFrom': withRepo((root) => createBranch(root, true)),
    'git.renameBranch': withRepo((root) => renameBranch(root)),
    'git.deleteBranch': withRepo((root) => deleteBranch(root)),
    'git.deleteRemoteBranch': withRepo((root) => deleteRemoteBranch(root)),
    'git.merge': withRepo((root) => mergeOrRebase(root, 'merge')),
    'git.rebase': withRepo((root) => mergeOrRebase(root, 'rebase')),
    'git.cherryPick': withRepo(async (root) => {
      const hash = await showInputBox({ title: vsb('Please provide the commit hash') })
      if (hash?.trim()) await exec(root, 'other', vs('command.cherryPick'), ['cherry-pick', hash.trim()])
    }),

    'git.stash': withRepo((root) => stash(root, [])),
    'git.stashIncludeUntracked': withRepo((root) => stash(root, ['-u'])),
    'git.stashStaged': withRepo((root) => stash(root, ['--staged'])),
    'git.stashApplyLatest': withRepo((root) => stashApply(root, false, true)),
    'git.stashApply': withRepo((root) => stashApply(root, false, false)),
    'git.stashPopLatest': withRepo((root) => stashApply(root, true, true)),
    'git.stashPop': withRepo((root) => stashApply(root, true, false)),
    'git.stashDrop': withRepo((root) => stashDrop(root, false)),
    'git.stashDropAll': withRepo((root) => stashDrop(root, true)),
    'git.createTag': withRepo((root) => createTag(root)),
    'git.deleteTag': withRepo((root) => deleteTag(root)),
    'git.deleteRemoteTag': withRepo((root) => deleteRemoteTag(root)),
    'git.addRemote': withRepo((root) => addRemote(root)),
    'git.removeRemote': withRepo((root) => removeRemote(root)),
    'git.createWorktree': withRepo((root) => createWorktree(root)),
    'git.deleteWorktree2': withRepo((root) => deleteWorktree(root)),
    'git.clone': () => guard(clone),
    'git.init': () => guard(init),
  }
  for (const [id, handler] of Object.entries(handlers)) registerHandler(id, handler)
}
