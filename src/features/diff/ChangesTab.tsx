// "View Changes" / "View Staged Changes": every file of a group, one diff at a time
// (VS Code opens a multi-file diff; here a file list sits beside the selected file's diff).
import { useMemo, useState } from 'react'
import { useRepoStatus } from '@/features/scm/api'
import { LETTER, statusColor } from '@/features/scm/status'
import { t, useLocale, vsb } from '@/i18n'
import type { DetailTabProps } from '@/routes/detail/DetailApp'
import { cn } from '@/lib/utils'
import { useSetting } from '@/settings/settings'
import { type DiffGroup, DiffTab } from './DiffTab'

export function changesLabel(params: URLSearchParams): string {
  const group = params.get('group')
  return group === 'index' ? vsb('Staged Changes') : group === 'untracked' ? vsb('Untracked Changes') : vsb('Changes')
}

export function ChangesTab({ params, route }: DetailTabProps) {
  useLocale()
  const root = params.get('repo') ?? ''
  const group = (params.get('group') ?? 'workingTree') as DiffGroup
  const mixed = useSetting<string>('git.untrackedChanges') === 'mixed'
  const { data: status } = useRepoStatus(root)
  const files = useMemo(() => {
    if (!status) return []
    if (group === 'index') return status.index
    if (group === 'untracked') return status.untracked
    return mixed ? [...status.workingTree, ...status.untracked] : status.workingTree
  }, [status, group, mixed])
  const [selected, setSelected] = useState<string | null>(null)
  const current = files.find((f) => f.path === selected) ?? files[0]

  if (files.length === 0) return <p className="p-4 text-muted-foreground text-sm">{t('diff.noChanges')}</p>
  const params2 = new URLSearchParams({
    repo: root,
    path: current.path,
    group: current.status === 'untracked' ? 'untracked' : group,
  })
  if (current.originalPath) params2.set('original', current.originalPath)
  return (
    <div className="flex h-full">
      <nav aria-label={changesLabel(params)} className="w-60 shrink-0 overflow-auto border-e py-1">
        {files.map((file) => (
          <button
            key={file.path}
            type="button"
            className={cn(
              'flex w-full items-center gap-2 px-3 py-0.5 text-start text-[13px] hover:bg-accent/50',
              file.path === current.path && 'bg-accent',
            )}
            onClick={() => setSelected(file.path)}
          >
            <span className="min-w-0 flex-1 truncate" style={{ color: statusColor(file.status) }}>
              {file.path.split('/').pop()}
            </span>
            <span className="font-mono text-[11px]" style={{ color: statusColor(file.status) }}>
              {LETTER[file.status]}
            </span>
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        <DiffTab key={current.path} route={route} params={params2} />
      </div>
    </div>
  )
}
