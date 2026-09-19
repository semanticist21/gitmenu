// Project tabs across the top of the panel, with open, pin and "more" menus.
import { useQuery } from '@tanstack/react-query'
import { EllipsisIcon, PictureInPicture2Icon, PinIcon, PinOffIcon, PlusIcon } from 'lucide-react'
import { MenuItems } from '@/commands/MenuItems'
import { executeCommand } from '@/commands/registry'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuPopup, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Menu, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { t, useLocale } from '@/i18n'
import { ipc, type ProjectInfo } from '@/lib/ipc'
import { cn } from '@/lib/utils'

function basename(path: string) {
  return path.split('/').filter(Boolean).pop() ?? path
}

function tildify(path: string) {
  return path.replace(/^\/Users\/[^/]+/, '~')
}

interface Props {
  projects: ProjectInfo[]
  active: ProjectInfo | null
  pinned: boolean
  onTogglePin: () => void
  detached: boolean
  onToggleDetach: () => void
}

export function PanelHeader({ projects, active, pinned, onTogglePin, detached, onToggleDetach }: Props) {
  useLocale()
  const recent = useQuery({ queryKey: ['recentProjects'], queryFn: ipc.projectsRecent })
  const openIds = new Set(projects.map((p) => p.id))
  const recentClosed = (recent.data ?? []).filter((p) => !openIds.has(p))

  return (
    // Detached: the header is the title bar (drag region, room for the traffic lights)
    <header data-tauri-drag-region className={cn('flex h-9 shrink-0 items-center gap-1 border-b pe-1', detached ? 'ps-[78px]' : 'ps-1.5')}>
      <div
        role="tablist"
        aria-label={t('view.sourceControl')}
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
      >
        {projects.map((project) => (
          <ContextMenu key={project.id}>
            <ContextMenuTrigger
              render={
                <button
                  type="button"
                  role="tab"
                  aria-selected={project.id === active?.id}
                  title={tildify(project.id)}
                  className={cn(
                    'relative flex h-7 max-w-40 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    project.id === active?.id ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60',
                    project.missing && 'italic opacity-60',
                  )}
                  onClick={() => void ipc.projectActivate(project.id)}
                  onAuxClick={(e) => {
                    if (e.button === 1) void ipc.projectClose(project.id)
                  }}
                />
              }
            >
              <span className="truncate">{project.name}</span>
              {project.dirty && (
                <span aria-label={t('project.changed')} className="size-1.5 shrink-0 rounded-full bg-primary" />
              )}
            </ContextMenuTrigger>
            <ContextMenuPopup>
              <MenuItems menu="gitmenu/project/context" kind="context" args={[project.id]} />
            </ContextMenuPopup>
          </ContextMenu>
        ))}
      </div>

      <Menu>
        <MenuTrigger
          render={<Button size="icon-xs" variant="ghost" aria-label={t('project.open')} title={t('project.open')} />}
        >
          <PlusIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => void executeCommand('gitmenu.openProject')}>{t('project.open')}</MenuItem>
          <MenuSeparator />
          <MenuGroupLabel>{t('project.openRecent')}</MenuGroupLabel>
          {recentClosed.length === 0 && <MenuItem disabled>{t('project.noRecent')}</MenuItem>}
          {recentClosed.map((path) => (
            <MenuItem key={path} onClick={() => void ipc.projectOpen(path)}>
              <span className="truncate">{basename(path)}</span>
              <span className="ms-auto truncate ps-3 text-muted-foreground text-xs">{tildify(path)}</span>
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>

      <Button
        size="icon-xs"
        variant="ghost"
        aria-pressed={detached}
        aria-label={detached ? t('panel.attach') : t('panel.detach')}
        title={detached ? t('panel.attach') : t('panel.detach')}
        onClick={onToggleDetach}
      >
        <PictureInPicture2Icon />
      </Button>

      <Button
        size="icon-xs"
        variant="ghost"
        aria-pressed={pinned}
        aria-label={pinned ? t('panel.unpin') : t('panel.pin')}
        title={pinned ? t('panel.unpin') : t('panel.pin')}
        onClick={onTogglePin}
      >
        {pinned ? <PinOffIcon /> : <PinIcon />}
      </Button>

      <Menu>
        <MenuTrigger render={<Button size="icon-xs" variant="ghost" aria-label={t('panel.more')} title={t('panel.more')} />}>
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItems menu="gitmenu/panel/more" />
        </MenuPopup>
      </Menu>
    </header>
  )
}
