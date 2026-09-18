// VS Code-style modal helpers with a promise API: quick pick, input box, and message boxes.
// One <DialogHost/> per window renders whatever is being asked.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { openOverlay } from '@/commands/context'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
} from '@/components/ui/command'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { t } from '@/i18n'

export interface QuickPickItem<T> {
  label: string
  description?: string
  detail?: string
  value: T
}

interface QuickPickRequest {
  kind: 'pick'
  items: QuickPickItem<unknown>[]
  placeholder?: string
  resolve: (value: unknown) => void
}

interface InputRequest {
  kind: 'input'
  title?: string
  prompt?: string
  placeholder?: string
  value?: string
  password?: boolean
  validate?: (value: string) => string | undefined
  resolve: (value: string | undefined) => void
}

export interface MessageButton<T> {
  label: string
  value: T
  variant?: 'default' | 'destructive' | 'outline' | 'ghost'
}

interface MessageRequest {
  kind: 'message'
  message: string
  detail?: string
  buttons: MessageButton<unknown>[]
  checkbox?: string
  resolve: (value: { value: unknown; checked: boolean } | undefined) => void
}

type Request = QuickPickRequest | InputRequest | MessageRequest

let queue: Request[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

function push(request: Request) {
  queue = [...queue, request]
  emit()
}

function pop() {
  queue = queue.slice(1)
  emit()
}

export function showQuickPick<T>(items: QuickPickItem<T>[], options: { placeholder?: string } = {}): Promise<T | undefined> {
  return new Promise((resolve) =>
    push({ kind: 'pick', items, placeholder: options.placeholder, resolve: resolve as (v: unknown) => void }),
  )
}

export function showInputBox(options: Omit<InputRequest, 'kind' | 'resolve'>): Promise<string | undefined> {
  return new Promise((resolve) => push({ kind: 'input', ...options, resolve }))
}

/** A modal message with buttons; Escape resolves `undefined` (VS Code's implicit Cancel). */
export function showMessage<T>(options: {
  message: string
  detail?: string
  buttons: MessageButton<T>[]
  checkbox?: string
}): Promise<{ value: T; checked: boolean } | undefined> {
  return new Promise((resolve) =>
    push({ kind: 'message', ...options, resolve: resolve as MessageRequest['resolve'] }),
  )
}

function useCurrent(): Request | undefined {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => queue[0],
  )
}

export function DialogHost() {
  const current = useCurrent()
  useEffect(() => (current ? openOverlay() : undefined), [current])
  if (!current) return null
  if (current.kind === 'pick') return <PickDialog key={queue.length} request={current} />
  if (current.kind === 'input') return <InputDialog key={queue.length} request={current} />
  return <MessageDialog key={queue.length} request={current} />
}

function PickDialog({ request }: { request: QuickPickRequest }) {
  const finish = (value: unknown) => {
    pop()
    request.resolve(value)
  }
  return (
    <CommandDialog open onOpenChange={(open) => !open && finish(undefined)}>
      <CommandDialogPopup className="max-w-[calc(100vw-1rem)]">
        <Command
          items={request.items}
          itemToStringValue={(item: unknown) => {
            const i = item as QuickPickItem<unknown>
            return `${i.label} ${i.description ?? ''}`
          }}
        >
          <CommandInput placeholder={request.placeholder} />
          <CommandPanel>
            <CommandEmpty>{t('palette.empty')}</CommandEmpty>
            <CommandList>
              {(item: QuickPickItem<unknown>) => (
                <CommandItem key={`${item.label}|${item.description ?? ''}`} value={item} onClick={() => finish(item.value)}>
                  <div className="flex min-w-0 flex-col">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate">{item.label}</span>
                      {item.description && <span className="truncate text-muted-foreground text-xs">{item.description}</span>}
                    </div>
                    {item.detail && <span className="truncate text-muted-foreground text-xs">{item.detail}</span>}
                  </div>
                </CommandItem>
              )}
            </CommandList>
          </CommandPanel>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  )
}

function InputDialog({ request }: { request: InputRequest }) {
  const [value, setValue] = useState(request.value ?? '')
  const error = request.validate?.(value)
  const finish = (result: string | undefined) => {
    pop()
    request.resolve(result)
  }
  return (
    <Dialog open onOpenChange={(open) => !open && finish(undefined)}>
      <DialogPopup className="max-w-[calc(100vw-1.5rem)]" showCloseButton={false}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!error) finish(value)
          }}
        >
          <DialogHeader>
            <DialogTitle>{request.title ?? request.prompt}</DialogTitle>
            {request.title && request.prompt && <DialogDescription>{request.prompt}</DialogDescription>}
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-1.5">
            <Input
              autoFocus
              type={request.password ? 'password' : 'text'}
              placeholder={request.placeholder}
              value={value}
              aria-invalid={Boolean(error)}
              onChange={(e) => setValue(e.target.value)}
            />
            {error && <p className="text-destructive-foreground text-xs">{error}</p>}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => finish(undefined)}>
              {t('prompt.cancel')}
            </Button>
            <Button type="submit" disabled={Boolean(error)}>
              {t('prompt.ok')}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}

function MessageDialog({ request }: { request: MessageRequest }) {
  const [checked, setChecked] = useState(false)
  const finish = (value: unknown | undefined, cancelled = false) => {
    pop()
    request.resolve(cancelled ? undefined : { value, checked })
  }
  return (
    <Dialog open onOpenChange={(open) => !open && finish(undefined, true)}>
      <DialogPopup className="max-w-[calc(100vw-1.5rem)]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-base leading-snug">{request.message}</DialogTitle>
          {request.detail && <DialogDescription className="whitespace-pre-wrap">{request.detail}</DialogDescription>}
        </DialogHeader>
        {request.checkbox && (
          <DialogPanel>
            <Label className="flex items-center gap-2 text-sm">
              <Checkbox checked={checked} onCheckedChange={(v) => setChecked(Boolean(v))} />
              {request.checkbox}
            </Label>
          </DialogPanel>
        )}
        <DialogFooter className="flex-wrap">
          <Button variant="ghost" onClick={() => finish(undefined, true)}>
            {t('prompt.cancel')}
          </Button>
          {request.buttons.map((button, i) => (
            <Button
              key={button.label}
              autoFocus={i === 0}
              variant={button.variant ?? (i === 0 ? 'default' : 'outline')}
              onClick={() => finish(button.value)}
            >
              {button.label}
            </Button>
          ))}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
