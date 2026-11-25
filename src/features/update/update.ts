// App updates, following VS Code's `update.mode`: `default` and `start` check at launch,
// `manual` only through "Check for Updates...", `none` never. A found update is downloaded and
// installed right away, like VS Code on macOS, so the next launch runs it whatever the user
// answers; the modal only asks to restart now. Modals rather than toasts, because a menu bar
// panel closes before a toast is read.
import { contextSnapshot } from '@/commands/context'
import { showMessage } from '@/components/dialogs/dialogs'
import { toastManager } from '@/components/ui/toast'
import { t } from '@/i18n'
import { errorMessage, ipc, type Update } from '@/lib/ipc'

/** The update already installed on disk, waiting for a restart */
let ready: Update | undefined
let busy = false

export async function checkForUpdates(manual: boolean) {
  if (contextSnapshot()['gitmenu.directUpdates'] !== true || busy) return
  busy = true
  try {
    if (!ready) {
      let update: Update | null
      try {
        update = await ipc.updateCheck()
      } catch (error) {
        if (manual) toastManager.add({ type: 'error', title: errorMessage(error) })
        return
      }
      if (!update) {
        if (manual) toastManager.add({ type: 'info', title: t('update.none') })
        return
      }
      try {
        const version = await ipc.updateInstall()
        if (version) ready = { ...update, version }
      } catch (error) {
        await showMessage({ message: errorMessage(error), severity: 'error', buttons: [], cancel: t('prompt.ok') })
        return
      }
    }
    if (!ready) return
    const answer = await showMessage({
      message: t('update.available', ready.version),
      detail: ready.notes ?? undefined,
      severity: 'info',
      buttons: [{ label: t('update.install'), value: 'restart' }],
      cancel: t('update.later'),
    })
    if (answer) await ipc.appRestart()
  } finally {
    busy = false
  }
}
