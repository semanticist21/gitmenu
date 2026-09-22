// Quick Open (⌘P): VS Code's Go to File is a repository panel's project switcher here — the
// open projects first, then the folders Open Recent would list.
import { showQuickPick } from '@/components/dialogs/dialogs'
import { t } from '@/i18n'
import { ipc } from '@/lib/ipc'
import { tildify } from '@/lib/paths'

export async function quickOpenProject() {
  const [projects, activeId] = await ipc.projectsList()
  const recent = await ipc.projectsRecent()
  const open = new Set(projects.map((p) => p.id))
  const path = await showQuickPick(
    [
      ...projects.map((p) => ({
        label: p.name,
        icon: p.id === activeId ? 'check' : 'folder-opened',
        description: tildify(p.id),
        value: p.id,
      })),
      ...recent
        .filter((p) => !open.has(p))
        .map((p) => ({ label: p.split('/').pop() ?? p, icon: 'history', description: tildify(p), value: p })),
    ],
    { placeholder: t('project.quickOpen.placeholder') },
  )
  if (!path) return
  if (open.has(path)) await ipc.projectActivate(path)
  else await ipc.projectOpen(path)
}
