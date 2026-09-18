// The menu bar panel: project tabs, then the active project's repositories and views.
import { useQuery } from '@tanstack/react-query'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useEffect, useRef, useState } from 'react'
import { setContext } from '@/commands/context'
import { registerHandler } from '@/commands/registry'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { toastManager } from '@/components/ui/toast'
import { OpsBar } from '@/features/ops/OpsBar'
import { openProjectPicker, useProjects, useSelectedRepo } from '@/features/projects/api'
import { PanelHeader } from '@/features/projects/components/PanelHeader'
import {
  MissingProject,
  NoProjects,
  NoRepository,
  ParentRepoQuestion,
  RepoList,
} from '@/features/projects/components/ProjectBody'
import { PromptDialog } from '@/features/prompt/PromptDialog'
import { useRepoChangeSync } from '@/features/scm/api'
import { setActiveRepo } from '@/features/scm/state'
import { ViewContainer } from '@/features/views/ViewContainer'
import { renderView, ViewActions } from '@/features/views/registry'
import { t, useLocale, vsb } from '@/i18n'
import { errorMessage, ipc, type EnvStatus, useTauriEvent } from '@/lib/ipc'
import { useUiState } from '@/lib/uiState'
import { useSetting } from '@/settings/settings'
import { checkForUpdates } from '@/features/update/update'

function usePanelCommands(projectIds: string[], activeId: string | null, activeRepo: string | null, togglePin: () => void) {
  useEffect(() => {
    const step = (delta: number) => {
      if (projectIds.length < 2 || !activeId) return
      const i = projectIds.indexOf(activeId)
      void ipc.projectActivate(projectIds[(i + delta + projectIds.length) % projectIds.length])
    }
    const disposers = [
      registerHandler('gitside.openProject', () => openProjectPicker(t('project.pickTitle'))),
      registerHandler('gitside.closeProject', (id?: unknown) => {
        const target = typeof id === 'string' ? id : activeId
        if (target) void ipc.projectClose(target)
      }),
      registerHandler('gitside.nextProject', () => step(1)),
      registerHandler('gitside.previousProject', () => step(-1)),
      registerHandler('gitside.togglePin', togglePin),
      registerHandler('gitside.hidePanel', () => ipc.panelHide()),
      registerHandler('gitside.openInTerminal', (path?: unknown) => {
        const target = typeof path === 'string' ? path : (activeRepo ?? activeId)
        if (target) void ipc.openInTerminal(target).catch((e) => toastManager.add({ type: 'error', title: errorMessage(e) }))
      }),
      registerHandler('gitside.revealInFinder', (path?: unknown) => {
        const target = typeof path === 'string' ? path : activeId
        if (target) void ipc.revealInFinder(target)
      }),
      registerHandler('gitside.quit', () => ipc.appQuit()),
      registerHandler('update.checkForUpdates', () => checkForUpdates(true)),
      registerHandler('workbench.action.openSettings', () => ipc.detailOpen('/detail/settings')),
      registerHandler('workbench.action.openGlobalKeybindings', () => ipc.detailOpen('/detail/keyboard-shortcuts')),
    ]
    return () => disposers.forEach((d) => d())
  }, [projectIds, activeId, activeRepo, togglePin])
}

/** Folders dropped on the panel open as projects. */
function useFolderDrop() {
  useEffect(() => {
    const pending = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== 'drop') return
      for (const path of event.payload.paths) {
        void ipc.projectOpen(path).catch((e) => toastManager.add({ type: 'error', title: errorMessage(e) }))
      }
    })
    return () => void pending.then((unlisten) => unlisten())
  }, [])
}

function EnvBanner() {
  useLocale()
  const status = useQuery({ queryKey: ['envStatus'], queryFn: ipc.envStatus })
  const [shellFailed, setShellFailed] = useState(false)
  useTauriEvent<EnvStatus>('env://ready', () => void status.refetch())
  useTauriEvent<string>('env://failed', () => setShellFailed(true))
  const gitMissing = status.data?.ready && !status.data.git
  if (!gitMissing && !shellFailed) return null
  return (
    <div role="alert" className="border-b bg-warning/8 px-3 py-2 text-[13px] text-warning-foreground">
      {gitMissing ? vsb('Git not found. Install it or configure it using the "git.path" setting.') : t('env.shellFailed')}
    </div>
  )
}

/** Asks once, on first launch, whether to open at login (SMAppService). */
function LoginItemQuestion() {
  useLocale()
  const [asked, setAsked, loaded] = useUiState<boolean>('loginItemAsked', false)
  if (!loaded || asked) return null
  const answer = async (enable: boolean) => {
    setAsked(true)
    if (!enable) return
    try {
      const status = await ipc.loginItemSet(true)
      if (status === 'requiresApproval') toastManager.add({ type: 'info', title: t('login.requiresApproval') })
    } catch (error) {
      toastManager.add({ type: 'error', title: errorMessage(error) })
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && void answer(false)}>
      <DialogPopup className="max-w-[calc(100vw-1.5rem)]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('login.question')}</DialogTitle>
          <DialogDescription>{t('login.description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => void answer(false)}>
            {t('login.no')}
          </Button>
          <Button onClick={() => void answer(true)}>{t('login.yes')}</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}

export function PanelApp() {
  useLocale()
  const { projects, active, loaded } = useProjects()
  const [repo, selectRepo] = useSelectedRepo(active)
  const [pinned, setPinned] = useState(false)
  const togglePin = () => {
    const next = !pinned
    setPinned(next)
    void ipc.panelSetPinned(next)
  }

  usePanelCommands(
    projects.map((p) => p.id),
    active?.id ?? null,
    repo?.root ?? null,
    togglePin,
  )
  useFolderDrop()

  const updateMode = useSetting<string>('update.mode')
  // Once per launch, when the setting is known
  const updateChecked = useRef(false)
  useEffect(() => {
    if (updateChecked.current || !updateMode) return
    updateChecked.current = true
    if (updateMode === 'default' || updateMode === 'start') void checkForUpdates(false)
  }, [updateMode])

  useRepoChangeSync()
  useEffect(() => setActiveRepo(repo?.root ?? null), [repo])

  useEffect(() => {
    setContext('gitside.window', 'panel')
    setContext('gitside.projectCount', projects.length)
    setContext('gitside.hasProject', Boolean(active))
    setContext('gitside.hasRepository', Boolean(repo))
    setContext('scmProvider', repo ? 'git' : undefined)
  }, [projects.length, active, repo])

  let body
  if (!loaded) body = null
  else if (!active) body = <NoProjects />
  else if (active.missing) body = <MissingProject project={active} />
  else
    body = (
      <div className="flex h-full min-h-0 flex-col">
        {active.parentCandidate && <ParentRepoQuestion project={active} />}
        {active.repos.length === 0 && !active.parentCandidate && <NoRepository project={active} />}
        {active.repos.length > 1 && (
          <div className="max-h-32 shrink-0 overflow-auto border-b">
            <RepoList repos={active.repos} selected={repo} onSelect={selectRepo} />
          </div>
        )}
        {repo && (
          <div className="min-h-0 flex-1">
            <ViewContainer render={(id) => renderView(id, repo)} actions={(id) => <ViewActions view={id} repo={repo} />} />
          </div>
        )}
      </div>
    )

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground select-none">
      <PanelHeader projects={projects} active={active} pinned={pinned} onTogglePin={togglePin} />
      <EnvBanner />
      <main className="min-h-0 flex-1">{body}</main>
      <OpsBar />
      <PromptDialog />
      <LoginItemQuestion />
    </div>
  )
}
