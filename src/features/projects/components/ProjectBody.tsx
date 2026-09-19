// What the panel shows for the active tab: first-run, missing folder, parent-repository
// question and "no repository" as VS Code welcome views (views.css `.welcome-view-content`:
// plain paragraphs and full-width buttons at most 300px wide, 1em apart, from the top), or
// the Repositories list above the repository views.
import { executeCommand } from '@/commands/registry'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { Empty } from '@/components/ui/empty'
import { toastManager } from '@/components/ui/toast'
import { treeRowClass, Twistie } from '@/features/views/ViewTree'
import { plainVs, t, useLocale, vs, vsb } from '@/i18n'
import { errorMessage, ipc, type ProjectInfo, type RepoInfo } from '@/lib/ipc'
import { setSetting, settingDefault } from '@/settings/settings'

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

/** Welcome view buttons: full width up to 300px, label ellipsis. */
function WelcomeButton({ secondary, onClick, children }: { secondary?: boolean; onClick: () => void; children: string }) {
  return (
    <Button variant={secondary ? 'secondary' : 'primary'} className="w-full max-w-[300px]" title={children} onClick={onClick}>
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
}

/** VS Code's Repositories view, shown when a project holds more than one repository: a pane
 * header, then 22px rows with the `repo` icon (`repo-selected` for the chosen one), the name
 * and a dimmed description. */
export function RepoList({ repos, selected, onSelect }: RepoListProps) {
  useLocale()
  return (
    <section aria-label={t('repos.title')}>
      <h3 className="flex h-[22px] items-center truncate ps-5 font-bold text-(--vsc-sideBarSectionHeader-foreground) text-[11px] uppercase leading-[22px] [&:lang(ja)]:font-normal [&:lang(ko)]:font-normal [&:lang(zh)]:font-normal">
        {t('repos.title')}
      </h3>
      <div
        role="listbox"
        aria-label={t('repos.title')}
        className="group/list relative"
        style={{ height: repos.length * 22 }}
        data-context={JSON.stringify({ focusedView: 'gitmenu.views.repositories', listFocus: true })}
      >
        {repos.map((repo, index) => {
          const isSelected = repo.root === selected?.root
          const kind = repo.kind === 'submodule' ? t('repos.submodule') : repo.kind === 'nested' ? t('repos.nested') : undefined
          return (
            <div
              key={repo.root}
              role="option"
              tabIndex={isSelected ? 0 : -1}
              aria-selected={isSelected}
              title={tildify(repo.root)}
              className={treeRowClass}
              style={{ transform: `translateY(${index * 22}px)` }}
              onClick={() => onSelect(repo.root)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(repo.root)
                } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  const step = e.key === 'ArrowDown' ? 1 : -1
                  const next = repos[index + step]
                  if (!next) return
                  onSelect(next.root)
                  ;(e.currentTarget.parentElement?.children[index + step] as HTMLElement | undefined)?.focus()
                }
              }}
            >
              <Twistie indent={8} state="leaf" />
              <Icon name={isSelected ? 'repo-selected' : 'repo'} className="me-0.5" />
              <span className="min-w-0 flex-1 truncate ps-1">
                <span className="whitespace-pre">{repo.name}</span>
                {kind && <span className="ms-[.5em] text-[.9em] opacity-95 dark:opacity-70">{kind}</span>}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
