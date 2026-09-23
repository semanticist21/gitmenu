// The diff tab: one file's change between two sides (index ↔ worktree, HEAD ↔ index, a
// commit's parent ↔ the commit). Blocks and selected lines can be staged, unstaged or
// reverted; selecting lines also drives the panel's Line History. Like VS Code's diff editor,
// its actions sit in the editor title (the tab strip's toolbar) and the path in breadcrumbs.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { emit } from '@tauri-apps/api/event'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { setContext } from '@/commands/context'
import { registerHandler } from '@/commands/registry'
import { showMessage } from '@/components/dialogs/dialogs'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { Menu, MenuCheckboxItem, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { ProgressBar } from '@/components/ui/progress'
import { toastManager } from '@/components/ui/toast'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { LogoBadgeFilledIcon, LogoBadgeIcon } from '@/components/LogoIcons'
import { gl, t, useLocale, vs, vsb } from '@/i18n'
import { openFile, openFileWithDefaultApp } from '@/features/history/nodes'
import { type DiffResult, git, type Side } from '@/lib/git'
import { errorMessage } from '@/lib/ipc'
import { useUiState } from '@/lib/uiState'
import { cn } from '@/lib/utils'
import type { DetailTabProps } from '@/routes/detail/DetailApp'
import { ActionButton, Breadcrumbs, EditorActions } from '@/routes/detail/EditorChrome'
import { useIsTabActive } from '@/routes/detail/tabActive'
import { setSetting, useSetting } from '@/settings/settings'
import { isDark } from '@/theme/theme'
import { DiffView, type GutterAction } from './DiffView'
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

/** Follows the light/dark switch (Shiki colors are per theme). */
export function useDarkMode() {
  const [dark, setDark] = useState(isDark)
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDark()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * VS Code's editor placeholder (editorplaceholder.css): a 48px severity codicon, a 14px
 * centered message and buttons, in the middle of the editor.
 */
export function EditorPlaceholder({ icon, message, detail, children }: { icon: 'info' | 'warning' | 'error'; message: string; detail?: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5 px-4">
      <Icon
        name={icon}
        className={cn(
          'text-[48px]',
          icon === 'error' && 'text-editor-error',
          icon === 'warning' && 'text-editor-warning',
          icon === 'info' && 'text-editor-info',
        )}
      />
      <div className="max-w-[450px] select-text break-words text-center text-large">
        {message}
        {detail && <div className="mt-1 text-ui opacity-90">{detail}</div>}
      </div>
      {children && <div className="flex [&>*]:mx-[5px] [&>*]:my-1 [&>*]:w-fit">{children}</div>}
    </div>
  )
}

export function NonTextDiff({ result, path, root }: { result: DiffResult; path: string; root: string }) {
  useLocale()
  if (result.kind === 'image') {
    // Two image previews side by side, each on the transparency grid, sizes underneath
    return (
      <div className="grid h-full grid-cols-2 overflow-auto">
        {(['left', 'right'] as const).map((side) => (
          <figure key={side} className={cn('flex min-w-0 flex-col items-center justify-center gap-2 p-4', side === 'right' && 'border-tab-strip-border border-l')}>
            {result[side].dataUrl ? (
              <img
                src={result[side].dataUrl!}
                alt={`${path} (${side === 'left' ? t('diff.before') : t('diff.after')})`}
                className="max-h-[70vh] max-w-full bg-[repeating-conic-gradient(#8080801a_0_25%,transparent_0_50%)] bg-size-[16px_16px] object-contain"
                onLoad={(e) => {
                  const img = e.currentTarget
                  img.parentElement?.querySelector('[data-dims]')?.replaceChildren(`${img.naturalWidth}×${img.naturalHeight} · ${formatSize(result[side].size)}`)
                }}
              />
            ) : (
              <span className="text-ui opacity-90">{t('diff.none')}</span>
            )}
            <figcaption data-dims className="text-small opacity-90">
              {result[side].exists ? formatSize(result[side].size) : ''}
            </figcaption>
          </figure>
        ))}
      </div>
    )
  }
  return (
    <EditorPlaceholder
      icon={result.kind === 'tooLarge' ? 'warning' : 'info'}
      message={result.kind === 'tooLarge' ? t('diff.tooLarge') : t('diff.binary')}
      detail={`${formatSize(result.left.size)} → ${formatSize(result.right.size)}`}
    >
      <Button onClick={() => openFileWithDefaultApp(root, path)}>{t('file.openWithDefaultApp')}</Button>
    </EditorPlaceholder>
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
  const [collapse, setCollapse] = useUiState<boolean>('diff.collapseUnchanged', false)
  const [selection, setSelection] = useState<LineSelection>(emptySelection)
  const [anchor, setAnchor] = useState<{ side: 'left' | 'right'; line: number } | null>(null)
  const [focusHunk, setFocusHunk] = useState<number | undefined>(undefined)
  const dark = useDarkMode()

  const blameRev = right.kind === 'commit' ? right.rev : 'HEAD'
  const blame = useQuery({
    queryKey: ['repo', root, 'blame', path, blameRev, right.kind],
    queryFn: () => git.blame(root, path, blameRev, right.kind === 'worktree'),
    enabled: blameOn && right.kind !== 'empty' && result?.kind === 'text',
  })

  // Staging acts on the index: worktree changes stage/revert, index changes unstage
  const canStage = left.kind === 'index' && right.kind === 'worktree'
  const canUnstage = left.kind === 'head' && right.kind === 'index'
  // Hidden tabs stay mounted but must not answer commands or hold context keys
  const active = useIsTabActive()

  useEffect(() => {
    if (!active) return
    setContext('gitmenuDiffCanStage', canStage)
    setContext('gitmenuDiffCanUnstage', canUnstage)
    return () => {
      setContext('gitmenuDiffCanStage', false)
      setContext('gitmenuDiffCanUnstage', false)
    }
  }, [active, canStage, canUnstage])

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
          buttons: [{ label: vs('command.revertChange'), value: true }],
          severity: 'warning',
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

  const hunkCount = result?.hunks.length ?? 0
  const previousChange = () => setFocusHunk((h) => Math.max((h ?? 1) - 1, 0))
  const nextChange = () => setFocusHunk((h) => Math.min((h ?? -1) + 1, hunkCount - 1))
  const hasSelection = selection.left.size + selection.right.size > 0

  // Commands act on the selection, or on the block under it when nothing is selected
  useEffect(() => {
    if (!active) return
    const selected = () => (selection.left.size + selection.right.size > 0 ? selection : null)
    const disposers = [
      registerHandler('git.stageSelectedRanges', () => canStage && selected() && apply(selection, 'stage')),
      registerHandler('git.unstageSelectedRanges', () => canUnstage && selected() && apply(selection, 'unstage')),
      registerHandler('git.revertSelectedRanges', () => canStage && selected() && apply(selection, 'revert')),
      registerHandler('workbench.action.editor.nextChange', () => setFocusHunk((h) => Math.min((h ?? -1) + 1, (result?.hunks.length ?? 1) - 1))),
      registerHandler('workbench.action.editor.previousChange', () => setFocusHunk((h) => Math.max((h ?? 1) - 1, 0))),
      registerHandler('toggle.diff.renderSideBySide', () => setSetting('diffEditor.renderSideBySide', !sideBySide)),
      registerHandler('gitmenu.toggleFileBlame', () => setBlameOn(!blameOn)),
    ]
    return () => disposers.forEach((d) => d())
  }, [active, selection, canStage, canUnstage, apply, result, sideBySide, blameOn, setBlameOn])

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
    setFocusHunk(undefined)
    // The panel's Line History follows the selected lines of the current file
    const lines = [...next.right].sort((x, y) => x - y)
    if (side === 'right' && lines.length) {
      void emit('lineHistory://select', { root, path, start: lines[0] + 1, end: lines[lines.length - 1] + 1, rev: right.kind === 'commit' ? right.rev : null })
    }
  }

  // VS Code's diffEditor/gutter menus: Stage Block (git), Revert Block (arrow-right side by side, discard inline)
  const hunkActions = (hunk: number, inline: boolean): GutterAction[] => {
    if (!result) return []
    const only = selectHunks([result.hunks[hunk]])
    if (canStage) {
      return [
        { icon: 'plus', label: vs('command.stageBlock'), run: () => void apply(only, 'stage') },
        { icon: inline ? 'discard' : 'arrow-right', label: vs('command.revertChange'), run: () => void apply(only, 'revert') },
      ]
    }
    if (canUnstage) return [{ icon: 'remove', label: t('diff.unstageBlock'), run: () => void apply(only, 'unstage') }]
    return []
  }
  const selectionActions = (inline: boolean): GutterAction[] => {
    if (canStage) {
      return [
        { icon: 'plus', label: vs('command.stageSelection'), run: () => void apply(selection, 'stage') },
        { icon: inline ? 'discard' : 'arrow-right', label: vs('command.revertSelectedRanges'), run: () => void apply(selection, 'revert') },
      ]
    }
    if (canUnstage) return [{ icon: 'remove', label: vs('command.unstageSelectedRanges'), run: () => void apply(selection, 'unstage') }]
    return []
  }

  let body
  if (isPending) body = <ProgressBar className="absolute inset-x-0 top-0 z-10" />
  else if (error || !result) body = <EditorPlaceholder icon="error" message={errorMessage(error)} />
  else if (result.kind !== 'text') body = <NonTextDiff result={result} path={path} root={root} />
  else if (result.hunks.length === 0 && result.left.text === result.right.text && result.left.exists === result.right.exists)
    body = <EditorPlaceholder icon="info" message={t('diff.identical')} />
  else
    body = (
      <DiffView
        root={root}
        result={result}
        path={path}
        leftPath={original ?? path}
        sideBySide={sideBySide}
        dark={dark}
        selection={selection}
        anchor={anchor}
        onSelectLine={onSelectLine}
        hunkActions={canStage || canUnstage ? hunkActions : undefined}
        selectionActions={canStage || canUnstage ? selectionActions : undefined}
        blame={blameOn ? blame.data : null}
        focusHunk={focusHunk}
        collapseUnchanged={collapse}
      />
    )

  const blameLabel = gl('Toggle File Blame')
  return (
    <div className="flex h-full flex-col" data-context={JSON.stringify({ gitmenuDiffFocus: true, isInDiffEditor: true })}>
      <EditorActions>
        {right.kind === 'worktree' && (
          <>
            <ActionButton icon="go-to-file" label={vs('command.openFile')} onClick={() => openFile(root, path)} />
            <ActionButton icon="link-external" label={t('file.openWithDefaultApp')} onClick={() => openFileWithDefaultApp(root, path)} />
          </>
        )}
        <ActionButton icon="arrow-up" label={t('diff.previousChange')} command="workbench.action.editor.previousChange" disabled={hunkCount === 0} onClick={previousChange} />
        <ActionButton icon="arrow-down" label={t('diff.nextChange')} command="workbench.action.editor.nextChange" disabled={hunkCount === 0} onClick={nextChange} />
        <ActionButton icon="whitespace" label={t('diff.showWhitespace')} pressed={!ignoreWs} onClick={() => void setSetting('diffEditor.ignoreTrimWhitespace', !ignoreWs)} />
        <ActionButton icon="map" label="Toggle Collapse Unchanged Regions" pressed={collapse} onClick={() => setCollapse(!collapse)} />
        <ActionButton
          icon={blameOn ? <LogoBadgeFilledIcon /> : <LogoBadgeIcon />}
          label={blameLabel}
          command="gitmenu.toggleFileBlame"
          pressed={blameOn}
          onClick={() => setBlameOn(!blameOn)}
        />
        <Menu>
          <Tooltip>
            <TooltipTrigger render={<MenuTrigger render={<Button size="icon" variant="action" aria-label={t('panel.more')} />} />}>
              <Icon name="ellipsis" />
            </TooltipTrigger>
            <TooltipPopup>{t('panel.more')}</TooltipPopup>
          </Tooltip>
          <MenuPopup align="end">
            <MenuCheckboxItem checked={!sideBySide} onCheckedChange={(v) => void setSetting('diffEditor.renderSideBySide', !v)}>
              {t('diff.inline')}
            </MenuCheckboxItem>
            {(canStage || canUnstage) && <MenuSeparator />}
            {canStage && (
              <MenuItem disabled={!hasSelection} onClick={() => void apply(selection, 'stage')}>
                {vs('command.stageSelectedRanges')}
              </MenuItem>
            )}
            {canUnstage && (
              <MenuItem disabled={!hasSelection} onClick={() => void apply(selection, 'unstage')}>
                {vs('command.unstageSelectedRanges')}
              </MenuItem>
            )}
            {canStage && (
              <MenuItem disabled={!hasSelection} onClick={() => void apply(selection, 'revert')}>
                {vs('command.revertSelectedRanges')}
              </MenuItem>
            )}
          </MenuPopup>
        </Menu>
      </EditorActions>
      <Breadcrumbs path={path} />
      <div className="relative min-h-0 flex-1">{body}</div>
    </div>
  )
}
