// App updates, following VS Code's `update.mode`: `default` and `start` check at launch,
// `manual` only through "Check for Updates...", `none` never. An available update is confirmed
// in a modal rather than a toast, because a menu bar panel closes before a toast is read.
// Installing restarts the app.
import { showMessage } from '@/components/dialogs/dialogs'
import { toastManager } from '@/components/ui/toast'
import { t } from '@/i18n'
import { errorMessage, ipc } from '@/lib/ipc'

async function install() {
  try {
    await ipc.updateInstall()
  } catch (error) {
    toastManager.add({ type: 'error', title: errorMessage(error) })
  }
}

export async function checkForUpdates(manual: boolean) {
  try {
    const update = await ipc.updateCheck()
    if (update) {
      const answer = await showMessage({
        message: t('update.available', update.version),
        detail: update.notes ?? undefined,
        severity: 'info',
        buttons: [
          { label: t('update.install'), value: 'install' },
          { label: t('update.later'), value: 'later' },
        ],
      })
      if (answer?.value === 'install') await install()
    } else if (manual) {
      toastManager.add({ type: 'info', title: t('update.none') })
    }
  } catch (error) {
    if (manual) toastManager.add({ type: 'error', title: errorMessage(error) })
  }
}
