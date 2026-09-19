// Answers git's questions in the panel: credentials, SSH passphrase, unknown host
// fingerprint (GIT_ASKPASS / SSH_ASKPASS), and the commit message editor (GIT_EDITOR).
// Like VS Code's git askpass, credentials and passphrases use the input box and the host
// question a quick pick; the message editor (a text editor in VS Code) is a modal dialog.
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { openOverlay } from '@/commands/context'
import { InputBoxWidget, QuickPickWidget } from '@/components/dialogs/dialogs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { t, useLocale } from '@/i18n'
import { ipc, useTauriEvent } from '@/lib/ipc'

export type Prompt =
  | { id: number; kind: 'askpass'; prompt: string; input: 'text' | 'secret' | 'confirm' }
  | { id: number; kind: 'editor'; path: string; input: 'editor' }

export function PromptDialog() {
  const [queue, setQueue] = useState<Prompt[]>([])
  const add = (prompt: Prompt) => setQueue((q) => (q.some((p) => p.id === prompt.id) ? q : [...q, prompt]))
  useTauriEvent<Prompt>('prompt://request', add)
  // Events aren't replayed: git may already be waiting from before this window mounted
  useEffect(() => {
    void ipc.promptOpen().then((open) => open.forEach(add))
  }, [])
  const current = queue[0]
  if (!current) return null
  const onDone = () => setQueue((q) => q.slice(1))
  return current.kind === 'editor' ? (
    <EditorForm key={current.id} prompt={current} onDone={onDone} />
  ) : (
    <AskpassForm key={current.id} prompt={current} onDone={onDone} />
  )
}

function AskpassForm({ prompt, onDone }: { prompt: Extract<Prompt, { kind: 'askpass' }>; onDone: () => void }) {
  useLocale()
  useEffect(() => openOverlay(), [])

  const respond = async (answer: string | null) => {
    await ipc.promptRespond(prompt.id, answer)
    onDone()
  }

  const text = prompt.prompt.trim()
  if (prompt.input === 'confirm') {
    // "The authenticity of host … can't be established. … Are you sure you want to continue connecting?"
    const lines = text.split('\n')
    const question = lines.length > 1 ? lines.pop() : undefined
    return (
      <QuickPickWidget
        title={t('prompt.confirmHost')}
        placeholder={question}
        message={lines.join('\n')}
        ignoreFocusOut
        items={[
          { label: t('prompt.yes'), value: 'yes' },
          { label: t('prompt.no'), value: 'no' },
        ]}
        onDone={(answer) => void respond(answer ?? null)}
      />
    )
  }

  const title = /passphrase/i.test(text) ? t('prompt.passphrase') : t('prompt.credentials')
  return (
    <InputBoxWidget
      title={title}
      prompt={text}
      password={prompt.input === 'secret'}
      ignoreFocusOut
      onDone={(answer) => void respond(answer ?? null)}
    />
  )
}

function EditorForm({ prompt, onDone }: { prompt: Extract<Prompt, { kind: 'editor' }>; onDone: () => void }) {
  useLocale()
  const [edited, setEdited] = useState<string | null>(null)
  const file = useQuery({
    queryKey: ['promptFile', prompt.id],
    queryFn: () => ipc.promptReadFile(prompt.path),
  })
  const value = edited ?? file.data ?? ''

  useEffect(() => openOverlay(), [])

  const finish = async (answer: string | null) => {
    await ipc.promptWriteFile(prompt.id, prompt.path, answer)
    onDone()
  }

  return (
    <Dialog open disablePointerDismissal onOpenChange={(open) => !open && void finish(null)}>
      <DialogPopup closeLabel={t('prompt.cancel')}>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            void finish(value)
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('prompt.editor')}</DialogTitle>
          </DialogHeader>
          <DialogPanel className="pt-1">
            <Textarea
              autoFocus
              aria-label={t('prompt.editor')}
              className="[&_textarea]:h-[216px] [&_textarea]:min-h-[216px] [&_textarea]:font-editor [&_textarea]:text-code [&_textarea]:[field-sizing:fixed]"
              spellCheck={false}
              value={value}
              onChange={(e) => setEdited(e.target.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => void finish(null)}>
              {t('prompt.cancel')}
            </Button>
            <Button type="submit">{t('prompt.save')}</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}
