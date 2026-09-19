// The menu bar panel: project tabs, then the active project's repositories and views, and the
// status bar with the repository's branch and sync items (where VS Code shows them).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useEffect, useRef, useState } from 'react'
import { setContext } from '@/commands/context'
import { registerHandler } from '@/commands/registry'
import { NotificationCard, toastManager } from '@/components/ui/toast'
import { Operations, useOpsBusy } from '@/features/ops/operations'
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
import { ScmStatusBar } from '@/features/scm/components/ScmView'
import { setActiveRepo } from '@/features/scm/state'
import { ViewContainer } from '@/features/views/ViewContainer'
import { renderView, ViewActions } from '@/features/views/registry'
import { t, useLocale, vsb } from '@/i18n'
import { errorMessage, ipc, type EnvStatus, useTauriEvent } from '@/lib/ipc'
import { useUiState } from '@/lib/uiState'
import { useSetting } from '@/settings/settings'
import { checkForUpdates } from '@/features/update/update'

function usePanelCommands(projectIds: string[], activeId: string | null, activeRepo: string | null, togglePin: () => void, toggleDetach: () => void) {
  useEffect(() => {
    const step = (delta: number) => {
      if (projectIds.length < 2 || !activeId) return
      const i = projectIds.indexOf(activeId)
      void ipc.projectActivate(projectIds[(i + delta + projectIds.length) % projectIds.length])
    }
    const disposers = [
      registerHandler('gitmenu.openProject', () => openProjectPicker(t('project.pickTitle'))),
      registerHandler('gitmenu.closeProject', (id?: unknown) => {
        const target = typeof id === 'string' ? id : activeId
        if (target) void ipc.projectClose(target)
      }),
      registerHandler('gitmenu.nextProject', () => step(1)),
      registerHandler('gitmenu.previousProject', () => step(-1)),
      registerHandler('gitmenu.togglePin', togglePin),
      registerHandler('gitmenu.toggleDetach', toggleDetach),
      registerHandler('gitmenu.hidePanel', () => ipc.panelHide()),
      registerHandler('gitmenu.openInTerminal', (path?: unknown) => {
        const target = typeof path === 'string' ? path : (activeRepo ?? activeId)
        if (target) void ipc.openInTerminal(target).catch((e) => toastManager.add({ type: 'error', title: errorMessage(e) }))
      }),
      registerHandler('gitmenu.revealInFinder', (path?: unknown) => {
        const target = typeof path === 'string' ? path : activeId
        if (target) void ipc.revealInFinder(target)
      }),
      registerHandler('gitmenu.quit', () => ipc.appQuit()),
      registerHandler('update.checkForUpdates', () => checkForUpdates(true)),
      registerHandler('workbench.action.openSettings', () => ipc.detailOpen('/detail/settings')),
      registerHandler('workbench.action.openGlobalKeybindings', () => ipc.detailOpen('/detail/keyboard-shortcuts')),
    ]
    return () => disposers.forEach((d) => d())
  }, [projectIds, activeId, activeRepo, togglePin, toggleDetach])
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
  const client = useQueryClient()
  const status = useQuery({ queryKey: ['envStatus'], queryFn: ipc.envStatus })
  // The payload is the new status: no refetch round-trip, and no missed event can leave a
  // stale answer because the panel also re-reads it every time it opens
  useTauriEvent<EnvStatus>('env://ready', (next) => client.setQueryData(['envStatus'], next))
  useTauriEvent('panel://shown', () => void client.invalidateQueries({ queryKey: ['envStatus'] }))
  const data = status.data
  if (!data?.ready) return null
  const gitMissing = !data.git
  if (!gitMissing && !data.shellFailed) return null
  return (
    <NotificationCard
      role="alert"
      className="m-1 shrink-0"
      severity="warning"
      title={gitMissing ? vsb('Git not found. Install it or configure it using the "git.path" setting.') : t('env.shellFailed')}
      actions={[{ children: t('env.retry'), onClick: () => void ipc.envRefresh() }]}
    />
  )
}

/** Asks once, on first launch, whether to open at login (SMAppService), as a notification. */
function LoginItemQuestion() {
  useLocale()
  const [asked, setAsked, loaded] = useUiState<boolean>('loginItemAsked', false)
  const shown = useRef(false)
  useEffect(() => {
    if (!loaded || asked || shown.current) return
    shown.current = true
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
    toastManager.add({
      type: 'info',
      title: t('login.question'),
      description: t('login.description'),
      timeout: 0,
      actionProps: { children: t('login.yes'), onClick: () => void answer(true) },
      actions: [{ children: t('login.no'), onClick: () => void answer(false) }],
      // Dismissing it counts as "Not Now"
      onClose: () => setAsked(true),
    })
  }, [loaded, asked, setAsked])
  return null
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
  // Rust owns the flag (it restores it at launch); the panel mirrors it for the header
  const [detached, setDetached] = useUiState<boolean>('panel.detached', false)
  useTauriEvent<boolean>('panel://detached', setDetached)
  const toggleDetach = () => void ipc.panelSetDetached(!detached)

  usePanelCommands(
    projects.map((p) => p.id),
    active?.id ?? null,
    repo?.root ?? null,
    togglePin,
    toggleDetach,
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
  // Inactive projects only get a "changed" dot while hidden; re-read when the panel opens
  const client = useQueryClient()
  useTauriEvent('panel://shown', () => {
    if (repo) void client.invalidateQueries({ queryKey: ['repo', repo.root] })
  })

  useEffect(() => {
    setContext('gitmenu.window', 'panel')
    setContext('gitmenu.projectCount', projects.length)
    setContext('gitmenu.hasProject', Boolean(active))
    setContext('gitmenu.hasRepository', Boolean(repo))
    setContext('scmProvider', repo ? 'git' : undefined)
  }, [projects.length, active, repo])

  // VS Code's `ProgressLocation.SourceControl`: a bar on the Source Control view
  const busy = useOpsBusy()

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
          <div className="max-h-32 shrink-0 overflow-auto border-section-header-border border-b">
            <RepoList repos={active.repos} selected={repo} onSelect={selectRepo} />
          </div>
        )}
        {repo && (
          <div className="min-h-0 flex-1">
            <ViewContainer
              render={(id) => renderView(id, repo)}
              actions={(id) => <ViewActions view={id} repo={repo} />}
              progress={(id) => id === 'scm' && busy}
            />
          </div>
        )}
      </div>
    )

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-sidebar text-sidebar-foreground select-none">
      <PanelHeader projects={projects} active={active} pinned={pinned} onTogglePin={togglePin} detached={detached} onToggleDetach={toggleDetach} />
      <EnvBanner />
      <main className="min-h-0 flex-1">{body}</main>
      {repo && !active?.missing && <ScmStatusBar root={repo.root} />}
      <Operations />
      <PromptDialog />
      <LoginItemQuestion />
    </div>
  )
}
