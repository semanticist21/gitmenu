// The diff tab: one file's change between two sides (index ↔ worktree, HEAD ↔ index, a
// commit's parent ↔ the commit). Blocks and selected lines can be staged, unstaged or
// reverted; selecting lines also drives the panel's Line History.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { emit } from '@tauri-apps/api/event'
import { ArrowDownIcon, ArrowUpIcon, Columns2Icon, FileIcon, MinusIcon, PilcrowIcon, PlusIcon, RowsIcon, Undo2Icon, UserRoundIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { setContext } from '@/commands/context'
import { registerHandler } from '@/commands/registry'
import { showMessage } from '@/components/dialogs/dialogs'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { toastManager } from '@/components/ui/toast'
import { Toggle } from '@/components/ui/toggle'
import type { DetailTabProps } from '@/routes/detail/DetailApp'
import { t, useLocale, vs, vsb } from '@/i18n'
import { type DiffResult, git, type Side } from '@/lib/git'
import { errorMessage, ipc } from '@/lib/ipc'
import { useUiState } from '@/lib/uiState'
import { setSetting, useSetting } from '@/settings/settings'
import { isDark } from '@/theme/theme'
import { DiffView } from './DiffView'
import { buildPatch, type LineSelection, selectHunks } from './patch'

export type DiffGroup = 'workingTree' | 'index' | 'untracked' | 'merge'

/** Parses `head`, `index`, `worktree`, `empty`, `commit:<rev>`. */
export function parseSide(value: string | null, fallback: Side): Side {
  if (!value) return fallback
  if (value.startsWith('commit:')) return { kind: 'commit', rev: value.slice(7) }
  if (value === 'head' || value === 'index' || value === 'worktree' || value === 'empty') return { kind: value }
  return fallback
}

export function sidesFor(group: DiffGroup): [Side, Side] {
  switch (group) {
    case 'index':
      return [{ kind: 'head' }, { kind: 'index' }]
    case 'untracked':
      return [{ kind: 'empty' }, { kind: 'worktree' }]
    case 'merge':
      return [{ kind: 'head' }, { kind: 'worktree' }]
    default:
      return [{ kind: 'index' }, { kind: 'worktree' }]
  }
}

/** VS Code's tab titles: `file.ts (Working Tree)`, `file.ts (Index)`, `file.ts (abc1234)`. */
export function diffLabel(params: URLSearchParams): string {
  const path = params.get('path') ?? ''
  const name = path.split('/').pop() ?? path
  const right = params.get('group') ? sidesFor(params.get('group') as DiffGroup)[1] : parseSide(params.get('right'), { kind: 'worktree' })
  switch (right.kind) {
    case 'worktree':
      return vsb('{0} (Working Tree)', name)
    case 'index':
      return vsb('{0} (Index)', name)
    case 'commit':
      return `${name} (${right.rev.length > 12 ? right.rev.slice(0, 7) : right.rev})`
    default:
      return name
  }
}

function emptySelection(): LineSelection {
  return { left: new Set(), right: new Set() }
}

export function useDiff(root: string, path: string, original: string | null, left: Side, right: Side) {
  const maxMb = useSetting<number>('diffEditor.maxFileSize')
  const ignoreWs = useSetting<boolean>('diffEditor.ignoreTrimWhitespace')
  return useQuery({
    queryKey: ['repo', root, 'diff', path, original, left, right, maxMb, ignoreWs],
    queryFn: () => git.diff(root, path, original, left, right, maxMb * 1024 * 1024, ignoreWs),
  })
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function NonTextDiff({ result, path, root }: { result: DiffResult; path: string; root: string }) {
  useLocale()
  if (result.kind === 'image') {
    return (
      <div className="grid h-full grid-cols-2 gap-4 overflow-auto p-4">
        {(['left', 'right'] as const).map((side) => (
          <figure key={side} className="flex flex-col items-center gap-2">
            {result[side].dataUrl ? (
              <img
                src={result[side].dataUrl!}
                alt={`${path} (${side === 'left' ? t('diff.before') : t('diff.after')})`}
                className="max-h-[70vh] max-w-full rounded border bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px] object-contain"
                onLoad={(e) => {
                  const img = e.currentTarget
                  img.dataset.dimensions = `${img.naturalWidth}×${img.naturalHeight}`
                  img.parentElement?.querySelector('[data-dims]')?.replaceChildren(`${img.naturalWidth}×${img.naturalHeight} · ${formatSize(result[side].size)}`)
                }}
              />
            ) : (
              <div className="flex h-40 w-full items-center justify-center rounded border border-dashed text-muted-foreground text-xs">
                {result[side].exists ? formatSize(result[side].size) : t('diff.none')}
              </div>
            )}
            <figcaption data-dims className="text-muted-foreground text-xs">
              {result[side].exists ? formatSize(result[side].size) : ''}
            </figcaption>
          </figure>
        ))}
      </div>
    )
  }
  const message = result.kind === 'tooLarge' ? t('diff.tooLarge') : t('diff.binary')
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm">
      <p>{message}</p>
      <p className="text-muted-foreground text-xs">
        {formatSize(result.left.size)} → {formatSize(result.right.size)}
      </p>
      <Button size="sm" variant="outline" onClick={() => void ipc.openPath(`${root}/${path}`)}>
        {vs('command.openFile')}
      </Button>
    </div>
  )
}

export function DiffTab({ params }: DetailTabProps) {
  useLocale()
  const client = useQueryClient()
  const root = params.get('repo') ?? ''
  const path = params.get('path') ?? ''
  const original = params.get('original')
  const group = params.get('group') as DiffGroup | null
  const [left, right] = useMemo<[Side, Side]>(
    () => (group ? sidesFor(group) : [parseSide(params.get('left'), { kind: 'head' }), parseSide(params.get('right'), { kind: 'worktree' })]),
    [group, params],
  )
  const { data: result, isPending, error } = useDiff(root, path, original, left, right)
  const sideBySide = useSetting<boolean>('diffEditor.renderSideBySide')
  const ignoreWs = useSetting<boolean>('diffEditor.ignoreTrimWhitespace')
  const [blameOn, setBlameOn] = useUiState<boolean>('diff.blame', false)
  const [selection, setSelection] = useState<LineSelection>(emptySelection)
  const [anchor, setAnchor] = useState<{ side: 'left' | 'right'; line: number } | null>(null)
  const [focusHunk, setFocusHunk] = useState<number | undefined>(undefined)
  const [dark, setDark] = useState(isDark)

  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDark()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const blameRev = right.kind === 'commit' ? right.rev : 'HEAD'
  const blame = useQuery({
    queryKey: ['repo', root, 'blame', path, blameRev, right.kind],
    queryFn: () => git.blame(root, path, blameRev, right.kind === 'worktree'),
    enabled: blameOn && right.kind !== 'empty' && result?.kind === 'text',
  })

  // Staging acts on the index: worktree changes stage/revert, index changes unstage
  const canStage = left.kind === 'index' && right.kind === 'worktree'
  const canUnstage = left.kind === 'head' && right.kind === 'index'

  useEffect(() => {
    setContext('gitmenuDiffCanStage', canStage)
    setContext('gitmenuDiffCanUnstage', canUnstage)
    return () => {
      setContext('gitmenuDiffCanStage', false)
      setContext('gitmenuDiffCanUnstage', false)
    }
  }, [canStage, canUnstage])

  const refresh = useCallback(() => {
    setSelection(emptySelection())
    void client.invalidateQueries({ queryKey: ['repo', root] })
  }, [client, root])

  const apply = useCallback(
    async (sel: LineSelection, mode: 'stage' | 'unstage' | 'revert') => {
      if (!result || result.kind !== 'text') return
      const patch = buildPatch(path, result.left.text ?? '', result.right.text ?? '', result.hunks, sel, original ?? undefined)
      if (!patch) return
      if (mode === 'revert') {
        const answer = await showMessage({
          message: t('diff.revertQuestion'),
          buttons: [{ label: vs('command.revertChange'), value: true, variant: 'destructive' }],
        })
        if (!answer) return
      }
      const label = mode === 'stage' ? vs('command.stageSelectedRanges') : mode === 'unstage' ? vs('command.unstageSelectedRanges') : vs('command.revertSelectedRanges')
      try {
        await git.apply(root, patch, mode !== 'revert', mode !== 'stage', label)
      } catch (e) {
        toastManager.add({ type: 'error', title: errorMessage(e) })
      }
      refresh()
    },
    [result, path, original, root, refresh],
  )

  // Commands act on the selection, or on the block under it when nothing is selected
  useEffect(() => {
    const selected = () => (selection.left.size + selection.right.size > 0 ? selection : null)
    const disposers = [
      registerHandler('git.stageSelectedRanges', () => canStage && selected() && apply(selection, 'stage')),
      registerHandler('git.unstageSelectedRanges', () => canUnstage && selected() && apply(selection, 'unstage')),
      registerHandler('git.revertSelectedRanges', () => canStage && selected() && apply(selection, 'revert')),
      registerHandler('workbench.action.editor.nextChange', () => setFocusHunk((h) => Math.min((h ?? -1) + 1, (result?.hunks.length ?? 1) - 1))),
      registerHandler('workbench.action.editor.previousChange', () => setFocusHunk((h) => Math.max((h ?? 1) - 1, 0))),
      registerHandler('toggle.diff.renderSideBySide', () => setSetting('diffEditor.renderSideBySide', !sideBySide)),
      registerHandler('gitlens.toggleFileBlame', () => setBlameOn(!blameOn)),
    ]
    return () => disposers.forEach((d) => d())
  }, [selection, canStage, canUnstage, apply, result, sideBySide, blameOn, setBlameOn])

  const onSelectLine = (side: 'left' | 'right', line: number, extend: boolean) => {
    const next = extend ? { left: new Set(selection.left), right: new Set(selection.right) } : emptySelection()
    if (extend && anchor && anchor.side === side) {
      const [a, b] = [anchor.line, line].sort((x, y) => x - y)
      for (let i = a; i <= b; i++) next[side].add(i)
    } else if (!extend && selection[side].has(line) && selection[side].size === 1) {
      next[side].clear()
    } else {
      next[side].add(line)
    }
    setSelection(next)
    setAnchor({ side, line })
    // The panel's Line History follows the selected lines of the current file
    const lines = [...next.right].sort((x, y) => x - y)
    if (side === 'right' && lines.length) {
      void emit('lineHistory://select', { root, path, start: lines[0] + 1, end: lines[lines.length - 1] + 1, rev: right.kind === 'commit' ? right.rev : null })
    }
  }

  const blockActions = (hunk: number) => {
    if (!result) return null
    const only = selectHunks([result.hunks[hunk]])
    const action = (label: string, Icon: typeof PlusIcon, mode: 'stage' | 'unstage' | 'revert') => (
      <Button key={mode} size="icon-xs" variant="outline" className="bg-background" aria-label={label} title={label} onClick={() => void apply(only, mode)}>
        <Icon />
      </Button>
    )
    if (canStage) return [action(vs('command.stageChange'), PlusIcon, 'stage'), action(vs('command.revertChange'), Undo2Icon, 'revert')]
    if (canUnstage) return [action(t('diff.unstageBlock'), MinusIcon, 'unstage')]
    return null
  }

  let body
  if (isPending) body = <div className="flex h-full items-center justify-center"><Spinner /></div>
  else if (error || !result) body = <p className="p-4 text-destructive-foreground text-sm">{errorMessage(error)}</p>
  else if (result.kind !== 'text') body = <NonTextDiff result={result} path={path} root={root} />
  else if (result.hunks.length === 0 && result.left.text === result.right.text && result.left.exists === result.right.exists)
    body = <p className="p-4 text-muted-foreground text-sm">{t('diff.identical')}</p>
  else
    body = (
      <DiffView
        result={result}
        path={path}
        leftPath={original ?? path}
        sideBySide={sideBySide}
        dark={dark}
        selection={selection}
        onSelectLine={onSelectLine}
        blockActions={canStage || canUnstage ? blockActions : undefined}
        blame={blameOn ? blame.data : null}
        focusHunk={focusHunk}
      />
    )

  const hunkCount = result?.hunks.length ?? 0
  return (
    <div className="flex h-full flex-col" data-context={JSON.stringify({ gitmenuDiffFocus: true, isInDiffEditor: true })}>
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2 text-[13px]">
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={`${root}/${path}`}>
          {original && original !== path ? `${original} → ${path}` : path}
        </span>
        {selection.left.size + selection.right.size > 0 && (
          <>
            {canStage && (
              <Button size="xs" variant="outline" onClick={() => void apply(selection, 'stage')}>
                {vs('command.stageSelectedRanges')}
              </Button>
            )}
            {canUnstage && (
              <Button size="xs" variant="outline" onClick={() => void apply(selection, 'unstage')}>
                {vs('command.unstageSelectedRanges')}
              </Button>
            )}
          </>
        )}
        <Button size="icon-xs" variant="ghost" disabled={hunkCount === 0} aria-label={t('diff.previousChange')} title={t('diff.previousChange')} onClick={() => setFocusHunk((h) => Math.max((h ?? 1) - 1, 0))}>
          <ArrowUpIcon />
        </Button>
        <Button size="icon-xs" variant="ghost" disabled={hunkCount === 0} aria-label={t('diff.nextChange')} title={t('diff.nextChange')} onClick={() => setFocusHunk((h) => Math.min((h ?? -1) + 1, hunkCount - 1))}>
          <ArrowDownIcon />
        </Button>
        <Toggle size="sm" pressed={ignoreWs} aria-label={t('diff.ignoreWhitespace')} title={t('diff.ignoreWhitespace')} onPressedChange={(v) => void setSetting('diffEditor.ignoreTrimWhitespace', v)}>
          <PilcrowIcon />
        </Toggle>
        <Toggle size="sm" pressed={blameOn} aria-label={t('diff.blame')} title={t('diff.blame')} onPressedChange={setBlameOn}>
          <UserRoundIcon />
        </Toggle>
        <Toggle size="sm" pressed={!sideBySide} aria-label={t('diff.inline')} title={t('diff.inline')} onPressedChange={(v) => void setSetting('diffEditor.renderSideBySide', !v)}>
          {sideBySide ? <Columns2Icon /> : <RowsIcon />}
        </Toggle>
        {right.kind === 'worktree' && (
          <Button size="icon-xs" variant="ghost" aria-label={vs('command.openFile')} title={vs('command.openFile')} onClick={() => void ipc.openPath(`${root}/${path}`)}>
            <FileIcon />
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  )
}
