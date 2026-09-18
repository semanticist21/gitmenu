// App updates, following VS Code's `update.mode`: `default` and `start` check at launch,
// `manual` only through "Check for Updates...", `none` never. Installing restarts the app.
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
      toastManager.add({
        type: 'info',
        title: t('update.available', update.version),
        timeout: 0,
        actionProps: { children: t('update.install'), onClick: () => void install() },
      })
    } else if (manual) {
      toastManager.add({ type: 'info', title: t('update.none') })
    }
  } catch (error) {
    if (manual) toastManager.add({ type: 'error', title: errorMessage(error) })
  }
}
