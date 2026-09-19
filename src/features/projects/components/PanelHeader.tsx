// The panel's header: VS Code's sidebar title (part.css) with the panel actions (open, detach,
// pin, more) as 22px codicon actions, and below it the project tabs, styled as VS Code's editor
// tabs at the compact tab height (multieditortabscontrol.css, `tabHeight: compact`: 22px).
import { useQuery } from '@tanstack/react-query'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { type KeyboardEvent, useEffect, useState } from 'react'
import { MenuItems } from '@/commands/MenuItems'
import { executeCommand, isEnabled } from '@/commands/registry'
import { Icon } from '@/components/Icon'
import { ContextMenu, ContextMenuPopup, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { ActionButton } from '@/features/views/ActionButton'
import { t, useLocale } from '@/i18n'
import { ipc, type ProjectInfo } from '@/lib/ipc'
import { ScrollableTabs } from '@/components/ScrollableTabs'
import { cn } from '@/lib/utils'

function tildify(path: string) {
  return path.replace(/^\/Users\/[^/]+/, '~')
}

/** Whether the window has focus: an unfocused window's active tab has a grey top border. */
function useWindowFocused() {
  const [focused, setFocused] = useState(() => document.hasFocus())
  useEffect(() => {
    const on = () => setFocused(true)
    const off = () => setFocused(false)
    window.addEventListener('focus', on)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('focus', on)
      window.removeEventListener('blur', off)
    }
  }, [])
  return focused
}

interface Props {
  projects: ProjectInfo[]
  active: ProjectInfo | null
  pinned: boolean
  onTogglePin: () => void
  detached: boolean
  onToggleDetach: () => void
}

function ProjectTab({ project, active, windowFocused }: { project: ProjectInfo; active: boolean; windowFocused: boolean }) {
  useLocale()
  const activate = () => void ipc.projectActivate(project.id)
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            role="tab"
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            title={tildify(project.id)}
            className={cn(
              // sizing "fit": at least 120px, as wide as the label; 10px before the label, the
              // 28px close area after it
              'group/tab relative flex h-tab-compact min-w-tab-min max-w-[240px] shrink-0 cursor-pointer items-center whitespace-nowrap border-tab-border border-e ps-2.5 text-ui leading-tab-compact outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-focus',
              active
                ? 'bg-tab-active text-tab-active-foreground'
                : 'bg-tab-inactive text-tab-inactive-foreground hover:bg-tab-hover',
            )}
            onClick={activate}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.target !== e.currentTarget) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                activate()
              }
            }}
            onAuxClick={(e) => {
              if (e.button === 1) void ipc.projectClose(project.id)
            }}
          />
        }
      >
        {active && (
          <>
            <span
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-x-0 top-0 z-[6] h-px',
                windowFocused ? 'bg-tab-active-border-top' : 'bg-tab-unfocused-active-border-top',
              )}
            />
            <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-px bg-tab-active-border" />
          </>
        )}
        {/* A missing folder reads like a deleted file's tab: struck through */}
        <span className={cn('min-w-0 flex-1 truncate', project.missing && 'line-through opacity-70')}>{project.name}</span>
        {/* Tab actions: `close`, hidden unless the tab is active, hovered or focused; a changed
            project shows `circle-filled` there until the pointer is on it */}
        <span className="flex w-7 shrink-0 items-center justify-center">
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('project.close')}
            className={cn(
              'group/close flex size-action-sm items-center justify-center rounded-action hover:bg-toolbar-hover',
              active || project.dirty ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100 group-focus-within/tab:opacity-100',
            )}
            onClick={(e) => {
              e.stopPropagation()
              void ipc.projectClose(project.id)
            }}
          >
            {project.dirty ? (
              <>
                <Icon name="circle-filled" aria-label={t('project.changed')} className="group-hover/close:hidden" />
                <Icon name="close" className="hidden group-hover/close:inline-block" />
              </>
            ) : (
              <Icon name="close" />
            )}
          </button>
        </span>
      </ContextMenuTrigger>
      <ContextMenuPopup>
        <MenuItems menu="gitmenu/project/context" kind="context" args={[project.id]} />
      </ContextMenuPopup>
    </ContextMenu>
  )
}

export function PanelHeader({ projects, active, pinned, onTogglePin, detached, onToggleDetach }: Props) {
  useLocale()
  const windowFocused = useWindowFocused()
  const recent = useQuery({ queryKey: ['recentProjects'], queryFn: ipc.projectsRecent })
  const openIds = new Set(projects.map((p) => p.id))
  const recentClosed = (recent.data ?? []).filter((p) => !openIds.has(p))

  return (
    // Two rows: VS Code's sidebar title with the panel actions, then the project tabs. The
    // header is the drag area when the panel is detached (anything but its controls).
    <header
      className="shrink-0"
      onPointerDown={(e) => {
        if (!detached || e.button !== 0 || (e.target as HTMLElement).closest('button, [role="tab"], [role="menu"]')) return
        void getCurrentWindow().startDragging()
      }}
    >
      {/* part.css: a 35px title, 8px side padding, the label 12px further in, 11px uppercase;
          title actions 4px apart */}
      <div className="flex h-part-title items-center bg-part-title px-2">
        <h2 className="min-w-0 flex-1 cursor-default truncate ps-3 text-caption text-part-title-foreground uppercase">
          {t('view.sourceControl')}
        </h2>
        <div className="flex shrink-0 items-center gap-1 pe-1">
          <Menu>
            <ActionButton icon="add" label={t('project.open')} render={<MenuTrigger />} />
            <MenuPopup align="end">
              <MenuItem onClick={() => void executeCommand('gitmenu.openProject')}>{t('project.open')}</MenuItem>
              <MenuItem disabled={!isEnabled('gitmenu.openInTerminal')} onClick={() => void executeCommand('gitmenu.openInTerminal')}>
                {t('panel.openInTerminal')}
              </MenuItem>
              <MenuSeparator />
              <MenuGroup>
                <MenuGroupLabel>{t('project.openRecent')}</MenuGroupLabel>
                {recentClosed.length === 0 && <MenuItem disabled>{t('project.noRecent')}</MenuItem>}
                {/* VS Code's Open Recent lists folders by their full (~) path */}
                {recentClosed.map((path) => (
                  <MenuItem key={path} onClick={() => void ipc.projectOpen(path)}>
                    {tildify(path)}
                  </MenuItem>
                ))}
              </MenuGroup>
            </MenuPopup>
          </Menu>

          <ActionButton
            icon={detached ? 'close' : 'empty-window'}
            label={detached ? t('panel.attach') : t('panel.detach')}
            onClick={onToggleDetach}
          />

          <ActionButton icon={pinned ? 'pinned' : 'pin'} label={pinned ? t('panel.unpin') : t('panel.pin')} onClick={onTogglePin} />

          <Menu>
            <ActionButton icon="ellipsis" label={t('panel.more')} render={<MenuTrigger />} />
            <MenuPopup align="end">
              <MenuItems menu="gitmenu/panel/more" />
            </MenuPopup>
          </Menu>
        </div>
      </div>

      {projects.length > 0 && (
        <div className="relative flex h-tab-compact bg-tab-strip after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-[9] after:h-px after:bg-tab-strip-border">
          <ScrollableTabs label={t('project.tabs')} activeKey={active?.id}>
            {projects.map((project) => (
              <ProjectTab key={project.id} project={project} active={project.id === active?.id} windowFocused={windowFocused} />
            ))}
          </ScrollableTabs>
        </div>
      )}
    </header>
  )
}
