// VS Code's Source Control view for one repository (scm.css, scmViewPane.ts, the git
// extension's actionButton.ts): the commit message box and the action button (Commit / Publish /
// Sync) as the tree's first rows, the merge-or-rebase banner, and the resource groups. The
// branch and sync items live in the window's status bar (`ScmStatusBar`), as in VS Code.
import { useQuery } from '@tanstack/react-query'
import { type ReactElement, type ReactNode, useEffect, useMemo, useRef } from 'react'
import { setContext } from '@/commands/context'
import { formatKey, useEffectiveBindings } from '@/commands/keybindings'
import { executeCommand } from '@/commands/registry'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { Group as ButtonGroup, GroupSeparator } from '@/components/ui/group'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { toastManager } from '@/components/ui/toast'
import { ProgressBar } from '@/components/ui/progress'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { type RunningOp, useRunningOps } from '@/features/ops/operations'
import { ActionButton } from '@/features/views/ActionButton'
import type { ViewProps } from '@/features/views/registry'
import { viewMessageClass } from '@/features/views/ViewTree'
import { t, useLocale, vs, vsb } from '@/i18n'
import { git, type RepoStatus } from '@/lib/git'
import { cn } from '@/lib/utils'
import { setSetting, useSetting } from '@/settings/settings'
import { SCM_INPUT_LINE_HEIGHT } from '@/theme/metrics'
import { useRepoStatus } from '../api'
import { loadCommitInput, setCommitInput, useCommitInput } from '../state'
import { type Group, ResourceList } from './ResourceList'

/** The most lines the input box grows to (scmInput.ts) */
const MAX_LINES = 10
/** The inset of the rows above the changes (banner, input, action button): 8px indent + 11px,
 * 12px on the right */
const headerInset = 'ps-[19px] pe-3'

/** VS Code's `renderLabelWithIcons` as a button label: `$(name)` / `$(name~spin)` become codicons,
 * the text between them is trimmed (button.ts `getContentElements`). */
function LabelWithIcons({ text, iconClass }: { text: string; iconClass?: (name: string) => string }) {
  const parts = text.split(/\$\(([a-z0-9-]+(?:~spin)?)\)/)
  return (
    <span className="flex min-w-0 items-center justify-center">
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const [name, modifier] = part.split('~')
          return <Icon key={i} name={name} spin={modifier === 'spin'} className={iconClass?.(name) ?? 'mx-[.2em]'} />
        }
        const trimmed = part.trim()
        return trimmed ? (
          <span key={i} className="min-w-0 truncate">
            {trimmed}
          </span>
        ) : null
      })}
    </span>
  )
}

/** A text button with VS Code's hover title. */
function Hover({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  )
}

interface RepoOps {
  commit: boolean
  sync: boolean
  checkout: boolean
}

function repoOps(running: RunningOp[], root: string): RepoOps {
  const kinds = new Set(running.filter((op) => op.repo === root).map((op) => op.kind))
  return { commit: kinds.has('commit'), sync: kinds.has('sync') || kinds.has('push') || kinds.has('pull'), checkout: kinds.has('checkout') }
}

/** VS Code warns once per repository when `git.statusLimit` is hit, with Don't Show Again
 * writing `git.ignoreLimitWarning` (repository.ts `getStatus`). */
const warnedAboutLimit = new Set<string>()

function useHugeRepoWarning(root: string, hitLimit: boolean) {
  const ignore = useSetting<boolean>('git.ignoreLimitWarning')
  useEffect(() => {
    if (!hitLimit || ignore || warnedAboutLimit.has(root)) return
    warnedAboutLimit.add(root)
    toastManager.add({
      type: 'warning',
      timeout: 0,
      title: vsb('The git repository at "{0}" has too many active changes, only a subset of Git features will be enabled.', root),
      // VS Code offers OK first, so acknowledging is the easy answer and suppressing the
      // warning forever is the deliberate one (repository.ts `getStatus`)
      actionProps: { children: vsb('OK') },
      actions: [{ children: vsb("Don't Show Again"), onClick: () => void setSetting('git.ignoreLimitWarning', true) }],
    })
  }, [root, hitLimit, ignore])
}

function CommitInput({ root, branch, huge }: { root: string; branch: string | null; huge: boolean }) {
  useLocale()
  const value = useCommitInput(root)
  const ref = useRef<HTMLTextAreaElement>(null)
  const bindings = useEffectiveBindings()
  const commitKey = [...bindings].reverse().find((b) => b.command === 'git.commit')
  const aiState = useQuery({ queryKey: ['aiAvailability'], queryFn: async () => (await import('@/features/ai/api')).availability(), staleTime: 60_000 })
  // VS Code's `git.inputValidation`: warn about a long subject or long lines
  const validate = useSetting<boolean>('git.inputValidation')
  const subjectMax = useSetting<number | null>('git.inputValidationSubjectLength')
  const lineMax = useSetting<number>('git.inputValidationLength')
  const statusLimit = useSetting<number>('git.statusLimit') ?? 10000
  // VS Code puts the huge-repository warning first in `validateInput`
  let warning: string | null = huge
    ? vsb('Too many changes were detected. Only the first {0} changes will be shown below.', statusLimit)
    : null
  if (!warning && validate) {
    const lines = value.split('\n')
    const limit = (i: number) => (i === 0 && subjectMax ? subjectMax : lineMax)
    const over = lines.findIndex((line, i) => line.length > limit(i))
    if (over === 0) warning = t('scm.subjectTooLong', lines[0].length - limit(0), limit(0))
    else if (over > 0) warning = t('scm.lineTooLong', over + 1, lines[over].length - limit(over), limit(over))
  }

  useEffect(() => void loadCommitInput(root), [root])

  // One line (a 26px box) growing to ten, then it scrolls with the scrollbar hidden
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, SCM_INPUT_LINE_HEIGHT * MAX_LINES + 4)}px`
  }, [value])

  const placeholder = branch
    ? commitKey
      ? vsb('Message ({0} to commit on "{1}")', formatKey(commitKey.key), branch)
      : vsb('Message (commit on "{0}")', branch)
    : vsb('Message')

  const ai = aiState.data
  return (
    // The input row: 5px above and below (row = box + 10)
    <div className={cn('py-[5px]', headerInset)} data-context={JSON.stringify({ scmRepository: true })}>
      <div
        className={cn(
          'flex items-start rounded-control border border-input-border bg-input-background text-input-foreground',
          'focus-within:outline-solid focus-within:outline-1 focus-within:-outline-offset-1 focus-within:outline-focus',
          warning && 'outline-solid outline-1 -outline-offset-1 outline-validation-warning-border focus-within:outline-validation-warning-border',
        )}
      >
        <textarea
          ref={ref}
          rows={1}
          value={value}
          placeholder={placeholder}
          aria-label={vsb('Message')}
          spellCheck
          className="block min-h-6 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-0.5 text-ui leading-scm-input outline-none [scrollbar-width:none] placeholder:text-input-placeholder [&::-webkit-scrollbar]:hidden"
          onChange={(e) => setCommitInput(root, e.target.value)}
        />
        <div className="flex shrink-0 py-px ps-px pe-[3px]">
          <ActionButton
            icon="sparkle"
            label={ai?.available ? t('ai.generate') : (ai?.reason ?? t('ai.generate'))}
            disabled={!ai?.available}
            onClick={() => void executeCommand('gitmenu.generateCommitMessage', root)}
          />
        </div>
      </div>
      {warning && (
        <div
          role="status"
          className="flex rounded-b-xs border border-validation-warning-border border-t-0 bg-validation-warning p-0.5"
        >
          <p className="px-[3px] py-px text-label-description">{warning}</p>
        </div>
      )}
    </div>
  )
}

/** VS Code's SCM action button: Commit when there is something to commit, else Publish Branch,
 * else Sync Changes, else Commit disabled. */
function scmActionButton({
  root,
  status,
  canCommit,
  ops,
  show,
  postCommit,
}: {
  root: string
  status: RepoStatus
  canCommit: boolean
  ops: RepoOps
  show: { commit: boolean; publish: boolean; sync: boolean }
  postCommit: string
}): ReactElement | null {
  const branch = status.head.branch
  const up = status.upstream
  const pausedOp = status.operation === 'merge' || status.operation === 'rebase'

  const commit = (enabled: boolean) => {
    if (!show.commit) return null
    const title =
      postCommit === 'push' ? vsb('{0} Commit & Push', '$(check)') : postCommit === 'sync' ? vsb('{0} Commit & Sync', '$(check)') : vsb('{0} Commit', '$(check)')
    const hover = ops.commit ? vsb('Committing Changes...') : branch ? vsb('Commit Changes on "{0}"', branch) : vsb('Commit Changes')
    const disabled = !enabled || ops.commit
    return (
      <ButtonGroup className="w-full">
        <Hover label={hover}>
          <Button className="min-w-0 flex-1" disabled={disabled} onClick={() => void executeCommand('git.commit', root)}>
            <LabelWithIcons text={title} />
          </Button>
        </Hover>
        <GroupSeparator />
        <Menu>
          <Hover label={t('panel.more')}>
            <MenuTrigger render={<Button aria-label={t('panel.more')} disabled={disabled} />}>
              <Icon name="chevron-down" />
            </MenuTrigger>
          </Hover>
          <MenuPopup align="end">
            <MenuItem onClick={() => void executeCommand('git.commit', root)}>{vsb('{0} Commit', '').trim()}</MenuItem>
            <MenuItem onClick={() => void executeCommand('git.commitAmend', root)}>{vsb('{0} Commit (Amend)', '').trim()}</MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => void executeCommand('gitmenu.commitAndPush', root)}>{vsb('{0} Commit & Push', '').trim()}</MenuItem>
            <MenuItem onClick={() => void executeCommand('gitmenu.commitAndSync', root)}>{vsb('{0} Commit & Sync', '').trim()}</MenuItem>
          </MenuPopup>
        </Menu>
      </ButtonGroup>
    )
  }

  // scm.css: the sync and cloud-upload icons sit 4px before the text, the arrows are small
  const syncIcons = (name: string) => (name === 'arrow-up' || name === 'arrow-down' ? 'me-1 text-ui' : 'me-1')
  const enabled = !ops.checkout && !ops.sync

  if (canCommit) return commit(true)
  if (branch && !up && !ops.commit && !pausedOp && show.publish) {
    const icon = ops.sync ? '$(sync~spin)' : '$(cloud-upload)'
    const hover = ops.sync
      ? vsb('Publishing Branch "{0}".../{Locked="Branch"}Do not translate "Branch" as it is a git term', branch)
      : vsb('Publish Branch "{0}"/{Locked="Branch"}Do not translate "Branch" as it is a git term', branch)
    return (
      <Hover label={hover}>
        <Button className="w-full" disabled={!enabled} onClick={() => void executeCommand('git.publish', root)}>
          <LabelWithIcons text={vsb('{0} Publish Branch/{Locked="Branch"}Do not translate "Branch" as it is a git term', icon)} iconClass={syncIcons} />
        </Button>
      </Hover>
    )
  }
  if (up && (up.ahead > 0 || up.behind > 0) && !ops.commit && !pausedOp && show.sync) {
    const icon = ops.sync ? '$(sync~spin)' : '$(sync)'
    const behind = up.behind ? ` ${up.behind}$(arrow-down)` : ''
    const ahead = up.ahead ? ` ${up.ahead}$(arrow-up)` : ''
    return (
      <Hover label={ops.sync ? vsb('Synchronizing Changes...') : syncTooltip(status)}>
        <Button size="short" className="w-full" disabled={!enabled} onClick={() => void executeCommand('git.sync', root)}>
          <LabelWithIcons text={vsb('{0} Sync Changes{1}{2}', icon, behind, ahead)} iconClass={syncIcons} />
        </Button>
      </Hover>
    )
  }
  return commit(false)
}

/** repository.ts `syncTooltip` */
function syncTooltip(status: RepoStatus): string {
  const up = status.upstream
  if (!status.head.branch || !up || !(up.ahead || up.behind)) return vsb('Synchronize Changes')
  const name = up.name.startsWith(`${up.remote}/`) ? up.name.slice(up.remote.length + 1) : up.name
  if (!up.ahead) return vsb('Pull {0} commits from {1}/{2}', up.behind, up.remote, name)
  if (!up.behind) return vsb('Push {0} commits to {1}/{2}', up.ahead, up.remote, name)
  return vsb('Pull {0} and push {1} commits between {2}/{3}', up.behind, up.ahead, up.remote, name)
}

/** A merge, rebase or other paused operation, with Continue and Abort (SPEC). */
function OperationBanner({ root, operation }: { root: string; operation: string }) {
  useLocale()
  const label =
    operation === 'rebase' ? vsb('Continue Rebase') : operation === 'merge' ? vsb('Continue Merge') : t('scm.continue')
  return (
    <div role="status" className={cn('flex items-center gap-1 pt-[5px]', headerInset)}>
      <Icon name="git-branch-conflicts" className="me-0.5 text-gitlens-merging" />
      <span className="min-w-0 flex-1 truncate">{t(`scm.operation.${operation}` as never)}</span>
      <Button size="small" className="min-w-0" onClick={() => void executeCommand('git.continueOperation', root)}>
        <span className="truncate">{label}</span>
      </Button>
      <Button size="small" variant="secondary" className="min-w-0" onClick={() => void executeCommand('git.abortOperation', root)}>
        <span className="truncate">{t('scm.abort')}</span>
      </Button>
    </div>
  )
}

/** One status bar item (statusbarPart.css): 22px, 0 5px padding, 3px apart, square hover. */
function StatusItem({ icon, text, tooltip, onClick, label }: { icon?: string; text?: string; tooltip: string; onClick?: () => void; label?: string }) {
  const [name, modifier] = (icon ?? '').split('~')
  const content: ReactNode = (
    <>
      {icon && <Icon name={name} spin={modifier === 'spin'} />}
      {text && <span className="min-w-0 truncate">{text}</span>}
    </>
  )
  const className =
    'mx-[3px] flex h-full min-w-0 items-center gap-1 px-[5px] leading-status-bar outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus'
  const item = onClick ? (
    <button
      type="button"
      aria-label={label ?? tooltip}
      className={cn(className, 'cursor-pointer hover:bg-status-bar-item-hover hover:text-status-bar-item-hover-foreground')}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <span role="status" aria-label={label ?? tooltip} className={className}>
      {content}
    </span>
  )
  if (!tooltip) return item
  return (
    <Tooltip>
      <TooltipTrigger render={item} />
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  )
}

/** The git extension's status bar items (statusbar.ts): the branch (checkout) and sync or publish. */
export function ScmStatusBar({ root }: { root: string }) {
  useLocale()
  const { data: status } = useRepoStatus(root)
  const untrackedMode = useSetting<string>('git.untrackedChanges')
  const ops = repoOps(useRunningOps(), root)
  let items: ReactNode = null
  if (status) {
    const head = status.head
    const rebasing = status.operation === 'rebase'
    const paused = status.operation === 'merge' || rebasing
    const dirty = status.workingTree.length + (untrackedMode === 'hidden' ? 0 : status.untracked.length) > 0
    const staged = status.index.length > 0
    const headLabel = `${head.branch ?? head.commit?.slice(0, 8) ?? ''}${dirty ? '*' : ''}${staged ? '+' : ''}${paused ? '!' : ''}`
    const label = `${headLabel}${rebasing ? ` (${vsb('Rebasing')})` : ''}`
    let branchIcon = 'git-commit'
    if (ops.checkout) branchIcon = 'loading~spin'
    else if (head.branch)
      branchIcon = paused ? 'git-branch-conflicts' : staged ? 'git-branch-staged-changes' : dirty ? 'git-branch-changes' : 'git-branch'
    const busy = ops.checkout || ops.commit || ops.sync
    const branchTooltip = ops.checkout
      ? vsb('Checking Out Branch/Tag...')
      : ops.commit
        ? vsb('Committing Changes...')
        : ops.sync
          ? vsb('Synchronizing Changes...')
          : vsb('Checkout Branch/Tag...')

    // Sync: behind↓ ahead↑ with an upstream, cloud-upload without one or without remotes
    let syncIcon = 'sync'
    let syncText = ''
    let syncCommand: string | null = null
    let syncHover = ''
    if (status.remotes.length === 0) {
      syncIcon = 'cloud-upload'
      syncCommand = 'git.publish'
      syncHover = vsb('Publish to...')
    } else if (head.branch && head.commit) {
      if (status.upstream) {
        const up = status.upstream
        if (up.ahead || up.behind) syncText = `${up.behind}↓ ${up.ahead}↑`
        syncCommand = 'git.sync'
        syncHover = syncTooltip(status)
      } else {
        syncIcon = 'cloud-upload'
        syncCommand = 'git.publish'
        syncHover = vsb('Publish Branch')
      }
    }
    if (ops.checkout) {
      syncCommand = null
      syncHover = vsb('Checking Out Changes...')
    }
    if (ops.commit) {
      syncCommand = null
      syncHover = vsb('Committing Changes...')
    }
    if (ops.sync) {
      syncIcon = 'sync~spin'
      syncCommand = null
      syncHover = vsb('Synchronizing Changes...')
    }
    const sync = syncCommand
    items = (
      <>
        <StatusItem
          icon={branchIcon}
          text={label}
          tooltip={`${label}, ${branchTooltip}`}
          onClick={busy ? undefined : () => void executeCommand('git.checkout', root)}
        />
        <StatusItem
          icon={syncIcon}
          text={syncText}
          tooltip={syncHover}
          label={syncHover || vs('command.sync')}
          onClick={sync ? () => void executeCommand(sync, root) : undefined}
        />
      </>
    )
  }
  return (
    <footer
      data-bottom-bar
      className="flex h-status-bar shrink-0 items-center overflow-hidden border-status-bar-border border-t bg-status-bar ps-1 text-status-bar-foreground text-small"
    >
      {items}
    </footer>
  )
}

export function ScmView({ repo }: ViewProps) {
  useLocale()
  const { data: status, isPending, error } = useRepoStatus(repo.root)
  const untrackedMode = useSetting<string>('git.untrackedChanges')
  const showInput = useSetting<boolean>('git.showCommitInput')
  const showActionButton = useSetting<{ commit: boolean; publish: boolean; sync: boolean }>('git.showActionButton')
  const postCommit = useSetting<string>('git.postCommitCommand')
  const ops = repoOps(useRunningOps(), repo.root)
  // VS Code sets `scmProviderContext` to `worktree` inside a linked worktree
  const worktrees = useQuery({ queryKey: ['repo', repo.root, 'worktrees'], queryFn: () => git.worktrees(repo.root), staleTime: Infinity })
  const inWorktree = worktrees.data?.some((w) => w.current && !w.main) ?? false
  useHugeRepoWarning(repo.root, status?.hitLimit ?? false)

  useEffect(() => {
    setContext('gitRebaseInProgress', status?.operation === 'rebase')
    setContext('gitMergeInProgress', status?.operation === 'merge')
    setContext('gitState', status?.operation ? status.operation : 'idle')
    setContext('scmProviderContext', inWorktree ? 'worktree' : 'repository')
    setContext('gitFreshRepository', Boolean(status && !status.head.commit))
  }, [status, inWorktree])

  const groups = useMemo<Group[]>(() => {
    if (!status) return []
    const list: Group[] = [
      { id: 'merge', label: vsb('Merge Changes'), changes: status.merge },
      { id: 'index', label: vsb('Staged Changes'), changes: status.index },
      {
        id: 'workingTree',
        label: vsb('Changes'),
        changes: untrackedMode === 'mixed' ? [...status.workingTree, ...status.untracked].sort((a, b) => a.path.localeCompare(b.path)) : status.workingTree,
      },
    ]
    if (untrackedMode === 'separate') list.push({ id: 'untracked', label: vsb('Untracked Changes'), changes: status.untracked })
    return list
  }, [status, untrackedMode])

  // Loading: VS Code shows the view's progress bar over an empty view
  if (isPending) return <ProgressBar />
  if (error || !status) {
    return <p className={cn(viewMessageClass, 'text-error')}>{String((error as { message?: string })?.message ?? error)}</p>
  }

  const canCommit = status.index.length + status.workingTree.length + (untrackedMode === 'hidden' ? 0 : status.untracked.length) > 0
  const button = scmActionButton({ root: repo.root, status, canCommit, ops, show: showActionButton, postCommit })
  const header = (
    <>
      {status.operation && <OperationBanner root={repo.root} operation={status.operation} />}
      {showInput && <CommitInput root={repo.root} branch={status.head.branch} huge={status.hitLimit} />}
      {/* The action button row: 28px + 8, the button centered and indented like the input */}
      {button && <div className={cn('flex h-9 items-center', headerInset)}>{button}</div>}
    </>
  )
  return (
    <div className="h-full min-h-0" data-context={JSON.stringify({ focusedView: 'workbench.scm' })}>
      <ResourceList root={repo.root} groups={groups} header={header} />
    </div>
  )
}
