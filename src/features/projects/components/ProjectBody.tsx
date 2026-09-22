// What the panel shows for the active tab: first-run, missing folder, parent-repository
// question and "no repository" as VS Code welcome views (views.css `.welcome-view-content`:
// plain paragraphs and full-width buttons at most 300px wide, 1em apart, from the top), or
// the Repositories list above the repository views.
import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useRef } from 'react'
import { executeCommand } from '@/commands/registry'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { Empty } from '@/components/ui/empty'
import { toastManager } from '@/components/ui/toast'
import { treeRowClass, Twistie } from '@/features/views/ViewTree'
import { plainVs, t, useLocale, vs, vsb } from '@/i18n'
import { errorMessage, ipc, type ProjectInfo, type RepoInfo } from '@/lib/ipc'
import { tildify } from '@/lib/paths'
import { setSetting, settingDefault } from '@/settings/settings'
import { INDENT, ROW_HEIGHT } from '@/theme/metrics'

async function run(action: () => Promise<unknown>) {
  try {
    await action()
  } catch (error) {
    toastManager.add({ type: 'error', title: errorMessage(error) })
  }
}

/** Welcome view buttons: full width up to 300px, label ellipsis. */
function WelcomeButton({ secondary, onClick, children }: { secondary?: boolean; onClick: () => void; children: string }) {
  return (
    <Button variant={secondary ? 'secondary' : 'primary'} className="w-full max-w-welcome-button" title={children} onClick={onClick}>
      <span className="truncate">{children}</span>
    </Button>
  )
}

export function NoProjects() {
  useLocale()
  return (
    <div className="h-full overflow-auto">
      <Empty>
        <p>{t('project.empty.description')}</p>
        <WelcomeButton onClick={() => void executeCommand('gitmenu.openProject')}>{t('project.open')}</WelcomeButton>
        <p>{t('project.empty.drop')}</p>
      </Empty>
    </div>
  )
}

export function MissingProject({ project }: { project: ProjectInfo }) {
  useLocale()
  return (
    <div className="h-full overflow-auto">
      <Empty>
        <p className="[overflow-wrap:anywhere]">{t('project.missing.description', tildify(project.id))}</p>
        <WelcomeButton
          onClick={() =>
            void run(async () => {
              const path = await ipc.pickFolder(t('project.missing.locate'))
              if (path) await ipc.projectRelocate(project.id, path)
            })
          }
        >
          {t('project.missing.locate')}
        </WelcomeButton>
        <WelcomeButton secondary onClick={() => void ipc.projectClose(project.id)}>
          {t('project.missing.remove')}
        </WelcomeButton>
      </Empty>
    </div>
  )
}

/** VS Code's `git.openRepositoryInParentFolders: prompt` question, shown in place. */
export function ParentRepoQuestion({ project }: { project: ProjectInfo }) {
  useLocale()
  const answer = (accept: boolean, setting?: 'always' | 'never') =>
    run(async () => {
      if (setting) await setSetting('git.openRepositoryInParentFolders', setting)
      await ipc.projectAnswerParent(project.id, accept)
    })
  return (
    <div className="max-h-full shrink-0 overflow-auto">
      <Empty>
        <p>{vsb('A git repository was found in the parent folders of the workspace or the open file(s). Would you like to open the repository?')}</p>
        <p className="truncate" title={project.parentCandidate ?? undefined}>
          {tildify(project.parentCandidate ?? '')}
        </p>
        <WelcomeButton onClick={() => void answer(true)}>{vsb('Yes')}</WelcomeButton>
        <WelcomeButton secondary onClick={() => void answer(true, 'always')}>
          {vsb('Always')}
        </WelcomeButton>
        <WelcomeButton secondary onClick={() => void answer(false, 'never')}>
          {vsb('Never')}
        </WelcomeButton>
      </Empty>
    </div>
  )
}

export function NoRepository({ project }: { project: ProjectInfo }) {
  useLocale()
  const [message] = plainVs('view.workbench.scm.folder')
  return (
    <div className="h-full overflow-auto">
      <Empty>
        <p>{message}</p>
        <WelcomeButton onClick={() => void run(() => ipc.projectInitRepo(project.id, vs('command.init'), settingDefault('git.defaultBranchName') as string))}>
          {vs('command.init')}
        </WelcomeButton>
      </Empty>
    </div>
  )
}

interface RepoListProps {
  repos: RepoInfo[]
  selected: RepoInfo | null
  onSelect: (root: string) => void
  /** The scan stopped at its budget, so the list may be short */
  truncated?: boolean
}

/** VS Code's `scm.repositories.visible`: how many rows the list is tall before it scrolls. */
const VISIBLE_REPOS = 10

/** VS Code's Repositories view, shown when a project holds more than one repository: a pane
 * header, then 22px rows with the `repo` icon (`repo-selected` for the chosen one), the name
 * and a dimmed description. Memoized and virtualized: a folder of checkouts can hold hundreds,
 * and the panel re-renders on every watcher event. */
export const RepoList = memo(function RepoList({ repos, selected, onSelect, truncated }: RepoListProps) {
  useLocale()
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: repos.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  })
  const focusRow = (index: number) => {
    if (index < 0 || index >= repos.length) return
    onSelect(repos[index].root)
    virtualizer.scrollToIndex(index)
    requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus())
  }
  return (
    <section aria-label={t('repos.title')}>
      <h3 className="flex h-pane-header items-center truncate ps-5 font-bold text-section-header-foreground text-caption uppercase leading-pane-header [&:lang(ja)]:font-normal [&:lang(ko)]:font-normal [&:lang(zh)]:font-normal">
        {t('repos.title')}
      </h3>
      <div
        ref={scrollRef}
        role="listbox"
        aria-label={t('repos.title')}
        className="group/list overflow-auto"
        style={{ height: Math.min(Math.max(repos.length, 1), VISIBLE_REPOS) * ROW_HEIGHT }}
        data-context={JSON.stringify({ focusedView: 'gitmenu.views.repositories', listFocus: true })}
      >
        <div role="presentation" className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const repo = repos[item.index]
            const isSelected = repo.root === selected?.root
            const kind = repo.kind === 'submodule' ? t('repos.submodule') : repo.kind === 'nested' ? t('repos.nested') : undefined
            return (
              <div
                key={repo.root}
                role="option"
                data-index={item.index}
                tabIndex={isSelected ? 0 : -1}
                aria-selected={isSelected}
                title={tildify(repo.root)}
                className={treeRowClass}
                style={{ transform: `translateY(${item.start}px)` }}
                onClick={() => onSelect(repo.root)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(repo.root)
                  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault()
                    focusRow(item.index + (e.key === 'ArrowDown' ? 1 : -1))
                  }
                }}
              >
                <Twistie indent={INDENT} state="leaf" />
                <Icon name={isSelected ? 'repo-selected' : 'repo'} className="me-0.5" />
                <span className="min-w-0 flex-1 truncate ps-1">
                  <span className="whitespace-pre">{repo.name}</span>
                  {kind && <span className="ms-[.5em] text-label-description opacity-95 dark:opacity-70">{kind}</span>}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      {/* The only explanation for a short list, so it wraps: truncating it at the panel's
          width hid the half that says what to do */}
      {truncated && (
        <p role="status" className="px-5 py-px text-label-description [overflow-wrap:anywhere]">
          {t('repos.truncated')}
        </p>
      )}
    </section>
  )
})
