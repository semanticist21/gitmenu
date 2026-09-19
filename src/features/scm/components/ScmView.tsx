// VS Code's Source Control view for one repository: commit message box, the action button
// (Commit / Sync / Publish), merge-or-rebase banner, and the resource groups.
import { useQuery } from '@tanstack/react-query'
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, CloudUploadIcon, GitBranchIcon, RefreshCwIcon, SparklesIcon } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { setContext, useContextKeys } from '@/commands/context'
import { formatKey, useEffectiveBindings } from '@/commands/keybindings'
import { executeCommand } from '@/commands/registry'
import { Button } from '@/components/ui/button'
import { Group as ButtonGroup, GroupSeparator } from '@/components/ui/group'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { Spinner } from '@/components/ui/spinner'
import type { ViewProps } from '@/features/views/registry'
import { t, useLocale, vs, vsb } from '@/i18n'
import { cn } from '@/lib/utils'
import { useSetting } from '@/settings/settings'
import { git } from '@/lib/git'
import { useRepoStatus } from '../api'
import { loadCommitInput, setCommitInput, useCommitInput } from '../state'
import { type Group, ResourceList } from './ResourceList'

function CommitInput({ root, branch }: { root: string; branch: string | null }) {
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
  let warning: string | null = null
  if (validate) {
    const lines = value.split('\n')
    const limit = (i: number) => (i === 0 && subjectMax ? subjectMax : lineMax)
    const over = lines.findIndex((line, i) => line.length > limit(i))
    if (over === 0) warning = t('scm.subjectTooLong', lines[0].length - limit(0), limit(0))
    else if (over > 0) warning = t('scm.lineTooLong', over + 1, lines[over].length - limit(over), limit(over))
  }

  useEffect(() => void loadCommitInput(root), [root])

  // Grow with the message up to about ten lines
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [value])

  const placeholder = branch
    ? commitKey
      ? vsb('Message ({0} to commit on "{1}")', formatKey(commitKey.key), branch)
      : vsb('Message (commit on "{0}")', branch)
    : vsb('Message')

  const ai = aiState.data
  return (
    <div className="relative" data-context={JSON.stringify({ scmRepository: true })}>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder={placeholder}
        aria-label={vsb('Message')}
        spellCheck
        className="block max-h-45 min-h-8 w-full resize-none rounded-md border border-input bg-background py-1.5 ps-2 pe-8 text-[13px] leading-snug outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24"
        onChange={(e) => setCommitInput(root, e.target.value)}
      />
      {warning && (
        <p role="status" className="mt-1 text-[11px] text-warning-foreground">
          {warning}
        </p>
      )}
      <Button
        size="icon-xs"
        variant="ghost"
        className="absolute end-1 top-1"
        disabled={!ai?.available}
        aria-label={t('ai.generate')}
        title={ai?.available ? t('ai.generate') : (ai?.reason ?? t('ai.generate'))}
        onClick={() => void executeCommand('gitmenu.generateCommitMessage', root)}
      >
        <SparklesIcon />
      </Button>
    </div>
  )
}

/** VS Code's SCM action button: Commit (with secondary commits), else Sync or Publish. */
function ActionButton({ root, canCommit, ahead, behind, hasUpstream, branch, busy }: {
  root: string
  canCommit: boolean
  ahead: number
  behind: number
  hasUpstream: boolean
  branch: string | null
  busy: boolean
}) {
  useLocale()
  const show = useSetting<{ commit: boolean; publish: boolean; sync: boolean }>('git.showActionButton')
  if (canCommit || !branch) {
    if (!show.commit) return null
    return (
      <ButtonGroup className="w-full">
        <Button className="flex-1" size="sm" disabled={busy} onClick={() => void executeCommand('git.commit', root)}>
          {vsb('{0} Commit', '').trim()}
        </Button>
        <GroupSeparator />
        <Menu>
          <MenuTrigger render={<Button size="icon-sm" aria-label={vs('submenu.commit')} disabled={busy} />}>
            <ChevronDownIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={() => void executeCommand('git.commit', root)}>{vsb('{0} Commit', '').trim()}</MenuItem>
            <MenuItem onClick={() => void executeCommand('git.commitAmend', root)}>{vsb('{0} Commit (Amend)', '').trim()}</MenuItem>
            <MenuItem onClick={() => void executeCommand('gitmenu.commitAndPush', root)}>{vsb('{0} Commit & Push', '').trim()}</MenuItem>
            <MenuItem onClick={() => void executeCommand('gitmenu.commitAndSync', root)}>{vsb('{0} Commit & Sync', '').trim()}</MenuItem>
          </MenuPopup>
        </Menu>
      </ButtonGroup>
    )
  }
  if (!hasUpstream) {
    if (!show.publish) return null
    return (
      <Button size="sm" className="w-full" disabled={busy} onClick={() => void executeCommand('git.publish', root)}>
        <CloudUploadIcon />
        {vsb('{0} Publish Branch/{Locked="Branch"}Do not translate "Branch" as it is a git term', '').trim()}
      </Button>
    )
  }
  if ((ahead > 0 || behind > 0) && show.sync) {
    return (
      <Button size="sm" className="w-full" disabled={busy} onClick={() => void executeCommand('git.sync', root)}>
        <RefreshCwIcon />
        {vsb('{0} Sync Changes{1}{2}', '', behind ? ` ${behind}↓` : '', ahead ? ` ${ahead}↑` : '').trim()}
      </Button>
    )
  }
  return null
}

function OperationBanner({ root, operation }: { root: string; operation: string }) {
  useLocale()
  const label =
    operation === 'rebase' ? vsb('Continue Rebase') : operation === 'merge' ? vsb('Continue Merge') : t('scm.continue')
  return (
    <div role="status" className="flex items-center gap-2 rounded-md border bg-muted/50 px-2 py-1.5 text-[13px]">
      <span className="min-w-0 flex-1 truncate">{t(`scm.operation.${operation}` as never)}</span>
      <Button size="xs" onClick={() => void executeCommand('git.continueOperation', root)}>
        {label}
      </Button>
      <Button size="xs" variant="outline" onClick={() => void executeCommand('git.abortOperation', root)}>
        {t('scm.abort')}
      </Button>
    </div>
  )
}

/** Branch and ahead/behind, where VS Code shows them in its status bar. */
function BranchBar({ root, branch, commit, ahead, behind, hasUpstream }: {
  root: string
  branch: string | null
  commit: string | null
  ahead: number
  behind: number
  hasUpstream: boolean
}) {
  useLocale()
  return (
    <div className="flex items-center gap-1 text-[12px] text-muted-foreground">
      <button
        type="button"
        className="flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-accent hover:text-foreground"
        title={vs('command.checkout')}
        onClick={() => void executeCommand('git.checkout', root)}
      >
        <GitBranchIcon className="size-3.5 shrink-0" />
        <span className="truncate">{branch ?? commit?.slice(0, 8) ?? '—'}</span>
      </button>
      {hasUpstream ? (
        <button
          type="button"
          className="flex items-center gap-0.5 rounded-sm px-1 py-0.5 tabular-nums hover:bg-accent hover:text-foreground"
          title={vs('command.sync')}
          onClick={() => void executeCommand('git.sync', root)}
        >
          {behind}
          <ArrowDownIcon className="size-3" />
          {ahead}
          <ArrowUpIcon className="size-3" />
        </button>
      ) : (
        branch && (
          <button
            type="button"
            className="rounded-sm p-0.5 hover:bg-accent hover:text-foreground"
            aria-label={vs('command.publish')}
            title={vs('command.publish')}
            onClick={() => void executeCommand('git.publish', root)}
          >
            <CloudUploadIcon className="size-3.5" />
          </button>
        )
      )}
    </div>
  )
}

export function ScmView({ repo }: ViewProps) {
  useLocale()
  const { data: status, isPending, error } = useRepoStatus(repo.root)
  const untrackedMode = useSetting<string>('git.untrackedChanges')
  const showInput = useSetting<boolean>('git.showCommitInput')
  const busy = Boolean(useContextKeys().operationInProgress)
  // VS Code sets `scmProviderContext` to `worktree` inside a linked worktree
  const worktrees = useQuery({ queryKey: ['repo', repo.root, 'worktrees'], queryFn: () => git.worktrees(repo.root), staleTime: Infinity })
  const inWorktree = worktrees.data?.some((w) => w.current && !w.main) ?? false

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

  if (isPending) {
    return (
      <div className="flex justify-center p-4">
        <Spinner />
      </div>
    )
  }
  if (error || !status) {
    return <p className="p-3 text-destructive-foreground text-xs">{String((error as { message?: string })?.message ?? error)}</p>
  }

  const canCommit = status.index.length + status.workingTree.length + (untrackedMode === 'hidden' ? 0 : status.untracked.length) > 0
  const up = status.upstream
  return (
    <div className="flex h-full min-h-0 flex-col" data-context={JSON.stringify({ focusedView: 'workbench.scm' })}>
      <div className={cn('flex shrink-0 flex-col gap-1.5 px-2 pt-1 pb-2')}>
        <BranchBar
          root={repo.root}
          branch={status.head.branch}
          commit={status.head.commit}
          ahead={up?.ahead ?? 0}
          behind={up?.behind ?? 0}
          hasUpstream={Boolean(up)}
        />
        {status.operation && <OperationBanner root={repo.root} operation={status.operation} />}
        {showInput && <CommitInput root={repo.root} branch={status.head.branch} />}
        <ActionButton
          root={repo.root}
          canCommit={canCommit}
          ahead={up?.ahead ?? 0}
          behind={up?.behind ?? 0}
          hasUpstream={Boolean(up)}
          branch={status.head.branch}
          busy={busy}
        />
      </div>
      <div className="min-h-0 flex-1">
        <ResourceList root={repo.root} groups={groups} />
      </div>
    </div>
  )
}
