// VS Code's quick pick, input box (quick input widget at the top) and modal message box, with
// a promise API. One <DialogHost/> per window renders whatever is being asked.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { openOverlay } from '@/commands/context'
import { Icon } from '@/components/Icon'
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
  QuickInputHeader,
  QuickInputLabel,
  QuickInputMessage,
  QuickInputTitle,
  quickInputBoxClassName,
} from '@/components/ui/command'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { t, useLocale } from '@/i18n'
import { cn } from '@/lib/utils'

export interface QuickPickItem<T> {
  label: string
  /** A codicon drawn at the start of the label (VS Code's `$(git-branch) main` labels) */
  icon?: string
  description?: string
  detail?: string
  value: T
}

interface QuickPickRequest {
  kind: 'pick'
  items: QuickPickItem<unknown>[]
  title?: string
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
  /** Keep the box open when the window is clicked elsewhere */
  ignoreFocusOut?: boolean
  validate?: (value: string) => string | undefined
  resolve: (value: string | undefined) => void
}

export interface MessageButton<T> {
  label: string
  value: T
  /** Accepted for compatibility; VS Code styles the first button primary and the rest secondary */
  variant?: 'default' | 'destructive' | 'outline' | 'ghost'
}

export type MessageSeverity = 'info' | 'warning' | 'error' | 'none'

interface MessageRequest {
  kind: 'message'
  message: string
  detail?: string
  buttons: MessageButton<unknown>[]
  checkbox?: string
  /** The icon; defaults to `warning` when a button is destructive, else `info` */
  severity?: MessageSeverity
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

export function showQuickPick<T>(
  items: QuickPickItem<T>[],
  options: { placeholder?: string; title?: string } = {},
): Promise<T | undefined> {
  return new Promise((resolve) =>
    push({ kind: 'pick', items, ...options, resolve: resolve as (v: unknown) => void }),
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
  severity?: MessageSeverity
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
  const done = (resolve: (value: never) => void) => (value: unknown) => {
    pop()
    resolve(value as never)
  }
  if (current.kind === 'pick') {
    return (
      <QuickPickWidget
        key={queue.length}
        items={current.items}
        title={current.title}
        placeholder={current.placeholder}
        onDone={done(current.resolve)}
      />
    )
  }
  if (current.kind === 'input') return <InputBoxWidget key={queue.length} {...current} onDone={done(current.resolve)} />
  return <MessageDialog key={queue.length} request={current} />
}

/** VS Code's quick pick: filter input, 22px rows (44px with a detail line), bold matches. */
export function QuickPickWidget<T>({
  items,
  title,
  placeholder,
  message,
  ignoreFocusOut = false,
  onDone,
}: {
  items: QuickPickItem<T>[]
  title?: string
  placeholder?: string
  /** Text under the filter input (the quick pick's description) */
  message?: ReactNode
  ignoreFocusOut?: boolean
  onDone: (value: T | undefined) => void
}) {
  useLocale()
  const [query, setQuery] = useState('')
  return (
    <CommandDialog open onOpenChange={(open) => !open && onDone(undefined)} disablePointerDismissal={ignoreFocusOut}>
      <CommandDialogPopup aria-label={title ?? placeholder}>
        {title && <QuickInputTitle>{title}</QuickInputTitle>}
        <Command
          items={items}
          value={query}
          onValueChange={(value) => setQuery(value)}
          itemToStringValue={(item: unknown) => {
            const i = item as QuickPickItem<T>
            return `${i.label} ${i.description ?? ''}`
          }}
        >
          <CommandInput placeholder={placeholder} aria-label={placeholder ?? title} />
          {message && (
            <div className="-mt-1 px-1.5 pb-1">
              <QuickInputMessage className="whitespace-pre-wrap">{message}</QuickInputMessage>
            </div>
          )}
          <CommandEmpty>{t('palette.empty')}</CommandEmpty>
          <CommandList>
            {(item: QuickPickItem<T>) => (
              <CommandItem
                key={`${item.label}|${item.description ?? ''}|${item.detail ?? ''}`}
                value={item}
                className={cn(item.detail && 'flex-col items-stretch')}
                onClick={() => onDone(item.value)}
              >
                <span className="flex h-row min-w-0 items-center">
                  {item.icon && <Icon name={item.icon} className="me-1 shrink-0" />}
                  <QuickInputLabel label={item.label} description={item.description} query={query} />
                </span>
                {item.detail && (
                  <span className="h-row truncate opacity-70 group-data-highlighted/quick-row:opacity-100">
                    {item.detail}
                  </span>
                )}
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  )
}

/** VS Code's hint under an input box; the English suffix is VS Code's own and has no translation here. */
function inputMessage(prompt: string | undefined, locale: string): string | undefined {
  if (locale !== 'en') return prompt
  return prompt
    ? `${prompt} (Press 'Enter' to confirm or 'Escape' to cancel)`
    : "Press 'Enter' to confirm your input or 'Escape' to cancel"
}

/** VS Code's input box: the quick input widget with one input and a message line. */
export function InputBoxWidget({
  title,
  prompt,
  placeholder,
  value: initialValue,
  password = false,
  ignoreFocusOut = false,
  validate,
  onDone,
}: Omit<InputRequest, 'kind' | 'resolve'> & { onDone: (value: string | undefined) => void }) {
  const locale = useLocale()
  const [value, setValue] = useState(initialValue ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const error = validate?.(value)
  const message = error ?? inputMessage(prompt, locale)
  return (
    <CommandDialog open onOpenChange={(open) => !open && onDone(undefined)} disablePointerDismissal={ignoreFocusOut}>
      <CommandDialogPopup aria-label={title ?? prompt ?? placeholder} initialFocus={inputRef}>
        {title && <QuickInputTitle>{title}</QuickInputTitle>}
        <QuickInputHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!error) onDone(value)
            }}
          >
            <input
              ref={inputRef}
              type={password ? 'password' : 'text'}
              className={quickInputBoxClassName}
              data-severity={error ? 'error' : undefined}
              aria-invalid={Boolean(error)}
              aria-label={title ?? prompt ?? placeholder}
              placeholder={placeholder}
              value={value}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
            />
          </form>
          {message && <QuickInputMessage severity={error ? 'error' : undefined}>{message}</QuickInputMessage>}
        </QuickInputHeader>
      </CommandDialogPopup>
    </CommandDialog>
  )
}

const SEVERITY_COLOR: Record<Exclude<MessageSeverity, 'none'>, string> = {
  error: 'text-editor-error',
  info: 'text-editor-info',
  warning: 'text-editor-warning',
}

const CANCEL = Symbol('cancel')

/** VS Code's modal message box: severity icon, message (and detail), buttons with the primary on the right. */
function MessageDialog({ request }: { request: MessageRequest }) {
  useLocale()
  const [checked, setChecked] = useState(false)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const finish = (value: unknown) => {
    pop()
    request.resolve(value === CANCEL ? undefined : { value, checked })
  }
  const severity =
    request.severity ?? (request.buttons.some((b) => b.variant === 'destructive') ? 'warning' : 'info')
  // macOS order (dialog.ts rearrangeButtons): Cancel moves to index 1, then the row is reversed,
  // so the first (primary) button ends up rightmost
  const [first, ...rest] = request.buttons
  const cancel = { label: t('prompt.cancel'), value: CANCEL as unknown }
  const ordered = (first ? [first, cancel, ...rest] : [cancel]).reverse()

  return (
    <Dialog open disablePointerDismissal onOpenChange={(open) => !open && finish(CANCEL)}>
      <DialogPopup
        initialFocus={primaryRef}
        closeLabel={t('prompt.cancel')}
        aria-label={request.detail ? undefined : request.message}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          const focusables = [
            ...e.currentTarget.querySelectorAll<HTMLElement>('[role="checkbox"]'),
            ...(footerRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []),
          ]
          const index = focusables.indexOf(document.activeElement as HTMLElement)
          if (index < 0) return
          e.preventDefault()
          const next = (index + (e.key === 'ArrowRight' ? 1 : -1) + focusables.length) % focusables.length
          focusables[next].focus()
        }}
      >
        <div className="flex min-h-0 shrink items-center pr-2 pl-3">
          {severity !== 'none' && (
            <Icon
              name={severity}
              className={cn('h-6 flex-[0_0_24px] self-baseline text-[24px]', SEVERITY_COLOR[severity])}
            />
          )}
          <DialogHeader className="self-stretch pr-0 pl-3">
            {request.detail ? (
              <>
                <DialogTitle>{request.message}</DialogTitle>
                <DialogDescription>{request.detail}</DialogDescription>
              </>
            ) : (
              <DialogDescription>{request.message}</DialogDescription>
            )}
            {request.checkbox && (
              <label className="flex cursor-pointer select-none items-start pt-[15px]">
                <Checkbox className="mr-[9px]" checked={checked} onCheckedChange={(v) => setChecked(Boolean(v))} />
                <span className="min-w-0 flex-1">{request.checkbox}</span>
              </label>
            )}
          </DialogHeader>
        </div>
        <DialogFooter ref={footerRef}>
          {ordered.map((button) => {
            const primary = button === first
            return (
              <Button
                key={button.label}
                ref={primary ? primaryRef : undefined}
                variant={primary ? 'primary' : 'secondary'}
                onClick={() => finish(button.value)}
              >
                <span className="truncate">{button.label}</span>
              </Button>
            )
          })}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
