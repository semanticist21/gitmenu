// Answers git's questions in the panel: credentials, SSH passphrase, unknown host
// fingerprint (GIT_ASKPASS / SSH_ASKPASS), and the commit message editor (GIT_EDITOR).
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { openOverlay } from '@/commands/context'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { t, useLocale } from '@/i18n'
import { ipc, useTauriEvent } from '@/lib/ipc'

type Prompt =
  | { id: number; kind: 'askpass'; prompt: string; input: 'text' | 'secret' | 'confirm' }
  | { id: number; kind: 'editor'; path: string; input: 'editor' }

export function PromptDialog() {
  const [queue, setQueue] = useState<Prompt[]>([])
  useTauriEvent<Prompt>('prompt://request', (prompt) => setQueue((q) => [...q, prompt]))
  const current = queue[0]
  if (!current) return null
  return <PromptForm key={current.id} prompt={current} onDone={() => setQueue((q) => q.slice(1))} />
}

function PromptForm({ prompt, onDone }: { prompt: Prompt; onDone: () => void }) {
  useLocale()
  const [edited, setEdited] = useState<string | null>(null)
  const file = useQuery({
    queryKey: ['promptFile', prompt.id],
    queryFn: () => ipc.promptReadFile((prompt as { path: string }).path),
    enabled: prompt.kind === 'editor',
  })
  const value = edited ?? file.data ?? ''

  useEffect(() => openOverlay(), [])

  const finish = async (answer: string | null) => {
    if (prompt.kind === 'editor') await ipc.promptWriteFile(prompt.id, prompt.path, answer)
    else await ipc.promptRespond(prompt.id, answer)
    onDone()
  }

  const heading =
    prompt.kind === 'editor'
      ? t('prompt.editor')
      : prompt.input === 'confirm'
        ? t('prompt.confirmHost')
        : /passphrase/i.test(prompt.prompt)
          ? t('prompt.passphrase')
          : t('prompt.credentials')

  return (
    <Dialog open onOpenChange={(open) => !open && void finish(null)}>
      <DialogPopup className="max-w-[calc(100vw-1.5rem)]" showCloseButton={false}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (prompt.input !== 'confirm') void finish(value)
          }}
        >
          <DialogHeader>
            <DialogTitle>{heading}</DialogTitle>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-3">
            {prompt.kind === 'askpass' && <p className="whitespace-pre-wrap break-words text-sm">{prompt.prompt.trim()}</p>}
            {prompt.input === 'text' && <Input autoFocus value={value} onChange={(e) => setEdited(e.target.value)} />}
            {prompt.input === 'secret' && (
              <Input autoFocus type="password" value={value} onChange={(e) => setEdited(e.target.value)} />
            )}
            {prompt.input === 'editor' && (
              <Textarea
                autoFocus
                className="font-mono text-xs"
                rows={12}
                value={value}
                onChange={(e) => setEdited(e.target.value)}
              />
            )}
          </DialogPanel>
          <DialogFooter>
            {prompt.input === 'confirm' ? (
              <>
                <Button type="button" variant="ghost" onClick={() => void finish('no')}>
                  {t('prompt.no')}
                </Button>
                <Button type="button" onClick={() => void finish('yes')}>
                  {t('prompt.yes')}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="ghost" onClick={() => void finish(null)}>
                  {t('prompt.cancel')}
                </Button>
                <Button type="submit">{prompt.kind === 'editor' ? t('prompt.save') : t('prompt.ok')}</Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}
