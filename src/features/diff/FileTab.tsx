// A file at HEAD or at a revision (VS Code's "Open File (HEAD)", GitLens's "Open File at
// Revision"), with blame. Selecting lines drives the panel's Line History.
import { useQuery } from '@tanstack/react-query'
import { emit } from '@tauri-apps/api/event'
import { UserRoundIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { registerHandler } from '@/commands/registry'
import { Spinner } from '@/components/ui/spinner'
import { Toggle } from '@/components/ui/toggle'
import { t, useLocale } from '@/i18n'
import { git, type Side } from '@/lib/git'
import { errorMessage } from '@/lib/ipc'
import { useUiState } from '@/lib/uiState'
import type { DetailTabProps } from '@/routes/detail/DetailApp'
import { useSetting } from '@/settings/settings'
import { isDark } from '@/theme/theme'
import { NonTextDiff } from './DiffTab'
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

  useEffect(() => registerHandler('gitlens.toggleFileBlame', () => setBlameOn(!blameOn)), [blameOn, setBlameOn])

  const onSelectLine = (_side: 'left' | 'right', line: number, extend: boolean) => {
    const right = new Set<number>()
    const [a, b] = extend && anchor !== null ? [anchor, line].sort((x, y) => x - y) : [line, line]
    for (let i = a; i <= b; i++) right.add(i)
    setSelection({ left: new Set(), right })
    if (!extend) setAnchor(line)
    void emit('lineHistory://select', { root, path, start: a + 1, end: b + 1, rev: ref === 'HEAD' || ref === 'worktree' ? null : ref })
  }

  let body
  if (isPending) body = <div className="flex h-full items-center justify-center"><Spinner /></div>
  else if (error || !data) body = <p className="p-4 text-destructive-foreground text-sm">{errorMessage(error)}</p>
  else if (!data.right.exists) body = <p className="p-4 text-muted-foreground text-sm">{t('diff.notInRevision')}</p>
  else if (data.kind !== 'text') body = <NonTextDiff result={data} path={path} root={root} />
  else
    body = (
      <DiffView
        result={data}
        path={path}
        leftPath={path}
        sideBySide={false}
        single
        dark={isDark()}
        selection={selection}
        onSelectLine={onSelectLine}
        blame={blameOn ? blame.data : null}
      />
    )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2 text-[13px]">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {path} · {ref}
        </span>
        <Toggle size="sm" pressed={blameOn} aria-label={t('diff.blame')} title={t('diff.blame')} onPressedChange={setBlameOn}>
          <UserRoundIcon />
        </Toggle>
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  )
}
