// A file at HEAD or at a revision (VS Code's "Open File (HEAD)", GitLens's "Open File at
// Revision"), with GitLens's file blame. Selecting lines drives the panel's Line History.
import { useQuery } from '@tanstack/react-query'
import { emit } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'
import { registerHandler } from '@/commands/registry'
import { ProgressBar } from '@/components/ui/progress'
import { LogoBadgeFilledIcon, LogoBadgeIcon } from '@/components/LogoIcons'
import { gl, t, useLocale } from '@/i18n'
import { openFileWithDefaultApp } from '@/features/history/nodes'
import { git, type Side } from '@/lib/git'
import { errorMessage } from '@/lib/ipc'
import { useUiState } from '@/lib/uiState'
import type { DetailTabProps } from '@/routes/detail/DetailApp'
import { ActionButton, Breadcrumbs, EditorActions } from '@/routes/detail/EditorChrome'
import { useSetting } from '@/settings/settings'
import { EditorPlaceholder, NonTextDiff, useDarkMode } from './DiffTab'
import { DiffView } from './DiffView'
import type { LineSelection } from './patch'

export function fileLabel(params: URLSearchParams): string {
  const path = params.get('path') ?? ''
  const name = path.split('/').pop() ?? path
  const ref = params.get('ref') ?? 'HEAD'
  return `${name} (${ref.length > 12 ? ref.slice(0, 7) : ref})`
}

export function FileTab({ params }: DetailTabProps) {
  useLocale()
  const root = params.get('repo') ?? ''
  const path = params.get('path') ?? ''
  const ref = params.get('ref') ?? 'HEAD'
  const side: Side = ref === 'HEAD' ? { kind: 'head' } : ref === 'worktree' ? { kind: 'worktree' } : { kind: 'commit', rev: ref }
  const maxMb = useSetting<number>('diffEditor.maxFileSize')
  const { data, isPending, error } = useQuery({
    queryKey: ['repo', root, 'file', path, ref, maxMb],
    queryFn: () => git.file(root, path, side, maxMb * 1024 * 1024),
  })
  const [blameOn, setBlameOn] = useUiState<boolean>('diff.blame', false)
  const blame = useQuery({
    queryKey: ['repo', root, 'blame', path, ref],
    queryFn: () => git.blame(root, path, ref === 'worktree' ? 'HEAD' : ref, ref === 'worktree'),
    enabled: blameOn && data?.kind === 'text',
  })
  const [selection, setSelection] = useState<LineSelection>({ left: new Set(), right: new Set() })
  const [anchor, setAnchor] = useState<number | null>(null)
  const dark = useDarkMode()

  useEffect(() => registerHandler('gitmenu.toggleFileBlame', () => setBlameOn(!blameOn)), [blameOn, setBlameOn])

  const onSelectLine = (_side: 'left' | 'right', line: number, extend: boolean) => {
    const right = new Set<number>()
    const [a, b] = extend && anchor !== null ? [anchor, line].sort((x, y) => x - y) : [line, line]
    for (let i = a; i <= b; i++) right.add(i)
    setSelection({ left: new Set(), right })
    if (!extend) setAnchor(line)
    void emit('lineHistory://select', { root, path, start: a + 1, end: b + 1, rev: ref === 'HEAD' || ref === 'worktree' ? null : ref })
  }

  let body
  if (isPending) body = <ProgressBar className="absolute inset-x-0 top-0 z-10" />
  else if (error || !data) body = <EditorPlaceholder icon="error" message={errorMessage(error)} />
  else if (!data.right.exists) body = <EditorPlaceholder icon="info" message={t('diff.notInRevision')} />
  else if (data.kind !== 'text') body = <NonTextDiff result={data} path={path} root={root} />
  else
    body = (
      <DiffView
        root={root}
        result={data}
        path={path}
        leftPath={path}
        sideBySide={false}
        single
        dark={dark}
        selection={selection}
        anchor={anchor === null ? null : { side: 'right', line: anchor }}
        onSelectLine={onSelectLine}
        blame={blameOn ? blame.data : null}
      />
    )

  return (
    <div className="flex h-full flex-col">
      <EditorActions>
        <ActionButton icon="link-external" label={t('file.openWithDefaultApp')} onClick={() => openFileWithDefaultApp(root, path)} />
        <ActionButton
          icon={blameOn ? <LogoBadgeFilledIcon /> : <LogoBadgeIcon />}
          label={gl('Toggle File Blame')}
          command="gitmenu.toggleFileBlame"
          pressed={blameOn}
          onClick={() => setBlameOn(!blameOn)}
        />
      </EditorActions>
      <Breadcrumbs path={path} />
      <div className="relative min-h-0 flex-1">{body}</div>
    </div>
  )
}
