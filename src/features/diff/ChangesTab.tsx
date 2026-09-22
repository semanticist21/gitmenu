// "View Changes" / "View Staged Changes": every file of a group, one diff at a time
// (VS Code opens a multi-file diff; here a file list sits beside the selected file's diff).
// The list is a VS Code list: 22px rows, file name and folder on one line, the status letter
// in its git decoration color on the right.
import { type KeyboardEvent, useMemo, useState } from 'react'
import { FileIcon } from '@/features/fileIcons/FileIcon'
import { useRepoStatus } from '@/features/scm/api'
import { LETTER, statusColor, statusText } from '@/features/scm/status'
import { t, useLocale, vsb } from '@/i18n'
import { cn } from '@/lib/utils'
import type { DetailTabProps } from '@/routes/detail/DetailApp'
import { useSetting } from '@/settings/settings'
import { type DiffGroup, DiffTab, EditorPlaceholder } from './DiffTab'

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

  if (files.length === 0) return <EditorPlaceholder icon="info" message={t('diff.noChanges')} />
  const params2 = new URLSearchParams({
    repo: root,
    path: current.path,
    group: current.status === 'untracked' ? 'untracked' : group,
  })
  if (current.originalPath) params2.set('original', current.originalPath)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = files.indexOf(current)
    const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: files.length - 1 }[event.key]
    if (next === undefined || !files[next]) return
    event.preventDefault()
    setSelected(files[next].path)
    event.currentTarget.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className="flex h-full">
      <div
        role="listbox"
        aria-label={changesLabel(params)}
        tabIndex={0}
        className="group/list w-60 shrink-0 overflow-y-auto border-tab-strip-border border-r bg-sidebar outline-none"
        onKeyDown={onKeyDown}
      >
        {files.map((file, index) => {
          const slash = file.path.lastIndexOf('/')
          const name = file.path.slice(slash + 1)
          const folder = slash === -1 ? '' : file.path.slice(0, slash)
          const isSelected = file.path === current.path
          return (
            <div
              key={file.path}
              role="option"
              aria-selected={isSelected}
              data-index={index}
              title={`${file.path} • ${statusText(file.status)}`}
              className={cn(
                'flex h-row cursor-default items-center pe-3 ps-2 text-ui leading-row',
                isSelected
                  ? 'bg-list-inactive group-focus/list:bg-list-active group-focus/list:text-list-active-foreground group-focus/list:outline-solid group-focus/list:outline-1 group-focus/list:-outline-offset-1 group-focus/list:outline-list-selection-outline'
                  : 'hover:bg-list-hover',
              )}
              onClick={() => setSelected(file.path)}
            >
              <FileIcon path={file.path} className="me-1.5" />
              <span className="min-w-0 flex-1 truncate">
                <span className={cn('whitespace-pre', LETTER[file.status] === 'D' && 'line-through')}>{name}</span>
                {folder && <span className="ms-[.5em] whitespace-pre text-label-description opacity-95 dark:opacity-70">{folder}</span>}
              </span>
              <span
                className="ms-[5px] me-[3px] inline-flex h-4 min-w-4 shrink-0 items-center justify-center font-semibold text-caption opacity-75"
                style={{ color: statusColor(file.status) }}
              >
                {LETTER[file.status]}
              </span>
            </div>
          )
        })}
      </div>
      <div className="min-w-0 flex-1">
        <DiffTab key={current.path} route={route} params={params2} />
      </div>
    </div>
  )
}
