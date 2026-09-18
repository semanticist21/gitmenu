// Running git operations (with cancel) at the bottom of the window, and their errors as toasts.
import { useQueryClient } from '@tanstack/react-query'
import { XIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { toastManager } from '@/components/ui/toast'
import { t, useLocale } from '@/i18n'
import { type IpcError, ipc, useTauriEvent } from '@/lib/ipc'

interface OpStarted {
  id: number
  repo: string
  kind: string
  label: string
}

interface OpFinished {
  id: number
  repo: string
  kind: string
  error: IpcError | null
}

export function errorText(error: IpcError): string {
  if (error.kind === 'alreadyRunning') return t('error.alreadyRunning', error.message.replace(/ is already running$/, ''))
  return error.message
}

export function OpsBar() {
  useLocale()
  const client = useQueryClient()
  const [running, setRunning] = useState<OpStarted[]>([])

  useTauriEvent<OpStarted>('op://started', (op) => setRunning((list) => [...list, op]))
  useTauriEvent<OpFinished>('op://finished', (op) => {
    setRunning((list) => list.filter((o) => o.id !== op.id))
    // A write finished: re-read now rather than waiting for the file watcher
    void client.invalidateQueries({ queryKey: ['repo', op.repo] })
    if (op.error && op.error.kind !== 'cancelled') {
      toastManager.add({ type: 'error', title: errorText(op.error), description: op.error.stderr?.trim() || undefined })
    }
  })

  if (running.length === 0) return null
  return (
    <div className="flex shrink-0 flex-col border-t" role="status" aria-live="polite">
      {running.map((op) => (
        <div key={op.id} className="flex h-7 items-center gap-2 ps-3 pe-1 text-[13px]">
          <Spinner className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">{op.label}</span>
          <Button size="icon-xs" variant="ghost" aria-label={t('op.cancel')} title={t('op.cancel')} onClick={() => void ipc.opCancel(op.id)}>
            <XIcon />
          </Button>
        </div>
      ))}
    </div>
  )
}
