// What the panel shows for the active tab: first-run, missing folder, parent-repository
// question, "no repository", or the repository views.
import { FolderGitIcon, FolderXIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { executeCommand } from '@/commands/registry'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { plainVs, t, useLocale, vs, vsb } from '@/i18n'
import { errorMessage, ipc, type ProjectInfo, type RepoInfo } from '@/lib/ipc'
import { setSetting } from '@/settings/settings'
import { toastManager } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

function tildify(path: string) {
  return path.replace(/^\/Users\/[^/]+/, '~')
}

async function run(action: () => Promise<unknown>) {
  try {
    await action()
  } catch (error) {
    toastManager.add({ type: 'error', title: errorMessage(error) })
  }
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center overflow-auto p-6">{children}</div>
}

export function NoProjects() {
  useLocale()
  return (
    <Centered>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderGitIcon />
          </EmptyMedia>
          <EmptyTitle>{t('project.empty.title')}</EmptyTitle>
          <EmptyDescription>{t('project.empty.description')}</EmptyDescription>
        </EmptyHeader>
        <Button onClick={() => void executeCommand('gitmenu.openProject')}>{t('project.open')}</Button>
        <p className="text-muted-foreground text-xs">{t('project.empty.drop')}</p>
      </Empty>
    </Centered>
  )
}

export function MissingProject({ project }: { project: ProjectInfo }) {
  useLocale()
  return (
    <Centered>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderXIcon />
          </EmptyMedia>
          <EmptyTitle>{t('project.missing.title')}</EmptyTitle>
          <EmptyDescription>{t('project.missing.description', tildify(project.id))}</EmptyDescription>
        </EmptyHeader>
        <div className="flex gap-2">
          <Button
            onClick={() =>
              void run(async () => {
                const path = await ipc.pickFolder(t('project.missing.locate'))
                if (path) await ipc.projectRelocate(project.id, path)
              })
            }
          >
            {t('project.missing.locate')}
          </Button>
          <Button variant="outline" onClick={() => void ipc.projectClose(project.id)}>
            {t('project.missing.remove')}
          </Button>
        </div>
      </Empty>
    </Centered>
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
    <div className="border-b bg-muted/40 p-3 text-[13px]">
      <p>{vsb('A git repository was found in the parent folders of the workspace or the open file(s). Would you like to open the repository?')}</p>
      <p className="mt-1 truncate text-muted-foreground text-xs">{tildify(project.parentCandidate ?? '')}</p>
      <div className="mt-2 flex gap-1.5">
        <Button size="xs" onClick={() => void answer(true)}>
          {vsb('Yes')}
        </Button>
        <Button size="xs" variant="outline" onClick={() => void answer(true, 'always')}>
          {vsb('Always')}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => void answer(false, 'never')}>
          {vsb('Never')}
        </Button>
      </div>
    </div>
  )
}

export function NoRepository({ project }: { project: ProjectInfo }) {
  useLocale()
  const [message] = plainVs('view.workbench.scm.folder')
  return (
    <div className="flex flex-col gap-3 p-3 text-[13px]">
      <p className="text-muted-foreground">{message}</p>
      <Button className="self-start" onClick={() => void run(() => ipc.projectInitRepo(project.id))}>
        {vs('command.init')}
      </Button>
    </div>
  )
}

interface RepoListProps {
  repos: RepoInfo[]
  selected: RepoInfo | null
  onSelect: (root: string) => void
}

/** VS Code's Repositories view, shown when a project holds more than one repository. */
export function RepoList({ repos, selected, onSelect }: RepoListProps) {
  useLocale()
  return (
    <div
      role="listbox"
      aria-label={t('repos.title')}
      className="flex flex-col py-0.5"
      data-context={JSON.stringify({ focusedView: 'gitmenu.views.repositories', listFocus: true })}
    >
      {repos.map((repo) => (
        <button
          key={repo.root}
          type="button"
          role="option"
          aria-selected={repo.root === selected?.root}
          className={cn(
            'flex h-6 items-center gap-2 px-3 text-start text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
            repo.root === selected?.root ? 'bg-accent' : 'hover:bg-accent/50',
          )}
          onClick={() => onSelect(repo.root)}
        >
          <span className="truncate">{repo.name}</span>
          {repo.kind !== 'root' && (
            <span className="truncate text-muted-foreground text-xs">
              {repo.kind === 'submodule' ? t('repos.submodule') : t('repos.nested')}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
