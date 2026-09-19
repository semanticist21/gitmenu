// The shells behind the detail window's terminal tabs, like VS Code's terminal in the editor
// area. The shell runs in a PTY in Rust (src-tauri/src/terminal.rs). Each tab's xterm lives
// here rather than in React: the detail window mounts only the active tab, and the screen and
// scrollback must survive switching away. Closing the tab ends the shell, after asking when it
// runs something; a shell that exits closes its tab.
import { Channel } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { FitAddon } from '@xterm/addon-fit'
import type { ITheme, Terminal } from '@xterm/xterm'
import { showMessage } from '@/components/dialogs/dialogs'
import { toastManager } from '@/components/ui/toast'
import { currentLocale, t } from '@/i18n'
import { errorMessage, ipc, type TerminalInfo } from '@/lib/ipc'
import { closeDetailTabs } from '@/routes/detail/DetailApp'
import { CODE_FONT_FAMILY, CODE_FONT_SIZE } from '@/theme/metrics'

interface Session {
  term: Terminal
  fit: FitAddon
  /** What xterm renders into; it moves into the tab while the tab is mounted */
  host: HTMLDivElement
  /** terminal_open was sent (or answered) for this page's channel */
  connected: boolean
  /** terminal_open answered: the PTY exists, so input and sizes can go to it */
  ready: boolean
  /** Input from before that, as bytes, sent once it exists (the shell's startup queries need answers) */
  pending: number[]
  /** The last input sent, for the exit alert (xtermTerminal.ts lastInputEvent) */
  lastInput: string
  /** When this page learned the shell runs, to tell a failed launch from an exit */
  startedAt?: number
  /** The shell exited by itself */
  exited: boolean
}

const sessions = new Map<string, Session>()

type Xterm = [typeof import('@xterm/xterm'), typeof import('@xterm/addon-fit'), typeof import('@xterm/addon-webgl')]
// xterm loads with the first terminal: the panel and most detail windows never need it
let xterm: Promise<Xterm> | undefined

// The shell and folder of each running terminal, and the process in its foreground (VS Code's
// `${process}` title), for its tab's label and hover
const infos = new Map<string, TerminalInfo>()
const titles = new Map<string, string>()
const listeners = new Set<() => void>()

/** The tab's label: the terminal's foreground process, else its shell, else "Terminal". */
export function terminalName(key: string | null): string {
  return (key && (titles.get(key) ?? infos.get(key)?.shell)) || t('terminal.title')
}

export function terminalInfo(key: string | null): TerminalInfo | undefined {
  return key ? infos.get(key) : undefined
}

export function subscribeTerminalInfo(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setInfo(key: string, info: TerminalInfo | null) {
  if (info) infos.set(key, info)
  else infos.delete(key)
  if (!info) titles.delete(key)
  listeners.forEach((fn) => fn())
}

const showError = (error: unknown) => toastManager.add({ type: 'error', title: errorMessage(error) })
const warn = (what: string) => (error: unknown) => console.warn(`[gitmenu] terminal ${what} failed`, error)
const encoder = new TextEncoder()

/**
 * VS Code's xterm theme (xtermTerminal.ts getXtermTheme) from the terminal colors in
 * src/index.css. A terminal in the editor area draws on the editor's background.
 */
function readTheme(): ITheme {
  const style = getComputedStyle(document.documentElement)
  const color = (id: string) => style.getPropertyValue(`--vsc-${id}`).trim()
  const background = color('editor-background')
  return {
    background,
    foreground: color('terminal-foreground'),
    cursor: color('terminalCursor-foreground'),
    cursorAccent: background,
    selectionBackground: color('terminal-selectionBackground'),
    selectionInactiveBackground: color('terminal-inactiveSelectionBackground'),
    scrollbarSliderBackground: color('scrollbarSlider-background'),
    scrollbarSliderHoverBackground: color('scrollbarSlider-hoverBackground'),
    scrollbarSliderActiveBackground: color('scrollbarSlider-activeBackground'),
    black: color('terminal-ansiBlack'),
    red: color('terminal-ansiRed'),
    green: color('terminal-ansiGreen'),
    yellow: color('terminal-ansiYellow'),
    blue: color('terminal-ansiBlue'),
    magenta: color('terminal-ansiMagenta'),
    cyan: color('terminal-ansiCyan'),
    white: color('terminal-ansiWhite'),
    brightBlack: color('terminal-ansiBrightBlack'),
    brightRed: color('terminal-ansiBrightRed'),
    brightGreen: color('terminal-ansiBrightGreen'),
    brightYellow: color('terminal-ansiBrightYellow'),
    brightBlue: color('terminal-ansiBrightBlue'),
    brightMagenta: color('terminal-ansiBrightMagenta'),
    brightCyan: color('terminal-ansiBrightCyan'),
    brightWhite: color('terminal-ansiBrightWhite'),
  }
}

/**
 * VS Code's macOS send-sequence keybindings (terminal.sendSequence.contribution.ts): the editing
 * keys of a Mac text field, sent to the shell as the readline keys they stand for.
 */
const SEQUENCES: Record<string, string> = {
  'cmd+arrowleft': '\x01', // line start (⌃A)
  'cmd+arrowright': '\x05', // line end (⌃E)
  'cmd+backspace': '\x15', // delete to line start (⌃U)
  'alt+backspace': '\x17', // delete word left (⌃W)
  'alt+delete': '\x1bd', // delete word right (⌥D)
  'alt+arrowleft': '\x1bb', // word left (⌥B)
  'alt+arrowright': '\x1bf', // word right (⌥F)
  'alt+arrowup': '\x1b[1;5A', // ⌃↑
  'alt+arrowdown': '\x1b[1;5B', // ⌃↓
  'ctrl+shift+2': '\x00', // NUL
  'ctrl+shift+6': '\x1e', // RS
}

/**
 * VS Code's terminal scroll keybindings on macOS (terminalActions.ts), in the normal buffer only:
 * a full-screen program such as vim or less gets these keys.
 */
const SCROLLS: Record<string, (term: Terminal) => void> = {
  pageup: (term) => term.scrollPages(-1),
  pagedown: (term) => term.scrollPages(1),
  'cmd+home': (term) => term.scrollToTop(),
  'cmd+end': (term) => term.scrollToBottom(),
  'alt+cmd+pageup': (term) => term.scrollLines(-1),
  'alt+cmd+pagedown': (term) => term.scrollLines(1),
}

/**
 * `cmd+k`, `alt+backspace`, `ctrl+shift+2`. A letter comes from the physical key when the layout
 * isn't Latin, and a digit always does (⌃⇧2 types `@`).
 */
function chord(event: KeyboardEvent): string {
  const { code } = event
  const physical = code.startsWith('Digit') ? code.slice(5) : code.startsWith('Key') && !/^[a-z]$/i.test(event.key) ? code.slice(3) : ''
  const key = (physical || event.key).toLowerCase()
  return [event.ctrlKey && 'ctrl', event.shiftKey && 'shift', event.altKey && 'alt', event.metaKey && 'cmd', key].filter(Boolean).join('+')
}

/** The keys a focused terminal keeps from the app (VS Code's terminal keybindings); true when handled. */
function runKey(term: Terminal, keys: string): boolean {
  switch (keys) {
    case 'cmd+c': // workbench.action.terminal.copySelection, only with a selection
      if (!term.hasSelection()) return false
      void ipc.clipboardWrite(term.getSelection()).catch(showError)
      return true
    case 'cmd+v': // workbench.action.terminal.paste
      void ipc
        .clipboardRead()
        .then((text) => checkPaste(text, term.modes.bracketedPasteMode))
        .then((text) => text !== undefined && term.paste(text), showError)
      return true
    case 'cmd+k': // workbench.action.terminal.clear
      term.clear()
      return true
    case 'cmd+a': // workbench.action.terminal.selectAll
      term.selectAll()
      return true
  }
  const scroll = SCROLLS[keys]
  if (scroll && term.buffer.active.type === 'normal') {
    scroll(term)
    return true
  }
  const sequence = SEQUENCES[keys]
  if (sequence === undefined) return false
  term.input(sequence)
  return true
}

/**
 * VS Code's paste check (terminalClipboard.ts shouldPasteTerminalText with
 * `terminal.integrated.enableMultiLinePasteWarning` "auto"). A shell in bracketed paste mode
 * takes any text as typed. Otherwise a single trailing newline is dropped, so a command copied
 * with one (or put there by a web page) doesn't run on paste, and more lines ask first.
 * Resolves the text to paste, or undefined when cancelled.
 */
async function checkPaste(text: string, bracketed: boolean): Promise<string | undefined> {
  const lines = text.split(/\r?\n/)
  if (lines.length === 1 || bracketed) return text
  if (lines.length === 2 && lines[1].trim().length === 0) return lines[0]
  const preview = lines.slice(0, 3).map((line) => (line.length > 30 ? `${line.slice(0, 30)}…` : line))
  const answer = await showMessage({
    message: t('terminal.paste.message', lines.length),
    detail: [t('terminal.paste.preview'), ...preview, ...(lines.length > 3 ? ['…'] : [])].join('\n'),
    buttons: [
      { label: t('terminal.paste.paste'), value: 'paste' },
      { label: t('terminal.paste.oneLine'), value: 'oneLine' },
    ],
    severity: 'warning',
  })
  if (!answer) return undefined
  return answer.value === 'oneLine' ? text.replace(/\r?\n/g, '') : text
}

function create(key: string, [{ Terminal }, { FitAddon }]: Xterm): Session {
  const host = document.createElement('div')
  // VS Code's terminal editor (terminal.css): the grid sits at the bottom, 20px in from the left
  // for the gutter, and the scrollable area reaches under the gutter
  host.className =
    'relative h-full [&_.xterm]:absolute [&_.xterm]:inset-x-0 [&_.xterm]:bottom-0 [&_.xterm]:ps-5 [&_.xterm-scrollable-element]:-ms-5 [&_.xterm-scrollable-element]:ps-5'
  // VS Code's terminal defaults (terminalConfiguration.ts) with the editor's font
  const term = new Terminal({
    fontFamily: CODE_FONT_FAMILY,
    fontSize: CODE_FONT_SIZE,
    lineHeight: 1,
    cursorStyle: 'block',
    cursorBlink: false,
    cursorInactiveStyle: 'outline',
    minimumContrastRatio: 4.5,
    scrollback: 1000,
    scrollOnEraseInDisplay: true,
    rescaleOverlappingGlyphs: true,
    wordSeparator: ' ()[]{}\',"`─‘’“”|',
    theme: readTheme(),
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const session: Session = { term, fit, host, connected: false, ready: false, pending: [], lastInput: '', exited: false }
  term.onData((data) => {
    session.lastInput = data
    if (session.ready) void ipc.terminalWrite(key, data).catch(warn('write'))
    else hold(session, encoder.encode(data))
  })
  // Mouse reports in xterm's default encoding: one byte per character, which UTF-8 would garble
  term.onBinary((data) => {
    const bytes = Array.from(data, (c) => c.charCodeAt(0) & 0xff)
    if (session.ready) void ipc.terminalWriteBinary(key, bytes).catch(warn('write'))
    else hold(session, bytes)
  })
  term.onResize(({ cols, rows }) => {
    if (session.ready) void ipc.terminalResize(key, cols, rows).catch(warn('resize'))
  })
  term.attachCustomKeyEventHandler((event) => {
    const keys = chord(event)
    if (event.type === 'keydown' && runKey(term, keys)) {
      // Nor the app's shortcuts: ⌘K would also start the ⌘K chords
      event.preventDefault()
      event.stopPropagation()
      return false
    }
    // The other ⌘ keys are the app's (⌘W, ⇧⌘P). Keys the shell gets never reach the app's
    // shortcuts: xterm stops the events it sends, and those listen on the document.
    return !event.metaKey && SEQUENCES[keys] === undefined
  })
  sessions.set(key, session)
  listenForEvents()
  return session
}

/** Keeps input for the shell until it exists (spread would overflow on a long paste). */
function hold(session: Session, bytes: Iterable<number>) {
  for (const byte of bytes) session.pending.push(byte)
}

/**
 * Connects the shell to this session's xterm with a new channel: starts it the first time, or
 * re-attaches a shell that is still running after the page reloaded. Once connected, the channel
 * keeps writing to the xterm while its tab is away, so the tab doesn't connect again when it
 * comes back (a second channel could deliver its output ahead of the first one's last).
 */
function connect(key: string, cwd: string | null, session: Session) {
  const { term } = session
  const onData = new Channel<ArrayBuffer>((bytes) => term.write(new Uint8Array(bytes)))
  const { cols, rows } = term
  session.connected = true
  ipc.terminalOpen(key, cwd, cols, rows, currentLocale(), onData).then(
    (info) => {
      // Closed while the shell was starting
      if (sessions.get(key) !== session) return void ipc.terminalKill(key).catch(warn('kill'))
      session.startedAt ??= info.reattached ? 0 : performance.now()
      setInfo(key, info)
      if (!session.ready) {
        session.ready = true
        if (session.pending.length) void ipc.terminalWriteBinary(key, session.pending).catch(warn('write'))
        session.pending = []
      }
      if (term.cols !== cols || term.rows !== rows) void ipc.terminalResize(key, term.cols, term.rows).catch(warn('resize'))
    },
    (error: unknown) => {
      // The tab tries again when it next mounts
      session.connected = false
      showError(error)
    },
  )
}

/** Shows the terminal for `key` in `container`, starting its shell the first time; returns the detach. */
export function mountTerminal(key: string, cwd: string | null, container: HTMLElement): () => void {
  let unmounted = false
  let detach: (() => void) | undefined
  xterm ??= Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/addon-webgl')])
  xterm.then(
    (modules) => {
      if (!unmounted) detach = attach(key, cwd, container, modules)
    },
    (error: unknown) => {
      xterm = undefined
      showError(error)
    },
  )
  return () => {
    unmounted = true
    detach?.()
  }
}

// A WebGL renderer that failed once isn't tried for later terminals (VS Code's suggested DOM renderer)
let webglFailed = false

/**
 * VS Code's GPU renderer (`terminal.integrated.gpuAcceleration` "auto"): it draws powerline and
 * box glyphs itself (`customGlyphs`) and keeps up with heavy output. xterm's DOM renderer takes
 * over when WebGL is missing or its context is lost; its cells differ, so the grid fits again.
 */
function loadWebgl({ term, fit }: Session, { WebglAddon }: Xterm[2]) {
  if (webglFailed) return
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => {
      webgl.dispose()
      if (term.element?.isConnected) fit.fit()
    })
    term.loadAddon(webgl)
  } catch (error) {
    webglFailed = true
    console.warn('[gitmenu] terminal WebGL renderer unavailable, using the DOM renderer', error)
  }
}

function attach(key: string, cwd: string | null, container: HTMLElement, modules: Xterm): () => void {
  const session = sessions.get(key) ?? create(key, modules)
  const { term, fit, host } = session
  container.append(host)
  // xterm measures its font when it opens, so the host must be in the page by then
  if (!term.element) {
    term.open(host)
    loadWebgl(session, modules[2])
  }
  term.options.theme = readTheme()
  fit.fit()
  if (!session.connected) connect(key, cwd, session)
  // Not after the tab closed: the terminal may be disposed before React detaches it
  const observer = new ResizeObserver(() => {
    if (sessions.get(key) === session && container.isConnected) fit.fit()
  })
  observer.observe(container)
  term.focus()
  return () => {
    observer.disconnect()
    host.remove()
  }
}

/** Re-reads the colors after the theme switched. */
export function updateTerminalTheme(key: string) {
  const session = sessions.get(key)
  if (session) session.term.options.theme = readTheme()
}

/** Gives the terminal the keyboard (its tab was clicked while active). */
export function focusTerminal(key: string) {
  sessions.get(key)?.term.focus()
}

function dispose(key: string) {
  const session = sessions.get(key)
  if (!session) return
  sessions.delete(key)
  session.term.dispose()
  session.host.remove()
  setInfo(key, null)
}

/**
 * VS Code's close handler for terminals in the editor area (`terminal.integrated.confirmOnKill`
 * "editor", terminalEditorInput.ts): closing terminals whose shells run something asks first.
 * Resolves whether to close them.
 */
export async function confirmCloseTerminals(keys: string[]): Promise<boolean> {
  const running = await Promise.all(
    keys.map((key) => !sessions.get(key)?.exited && ipc.terminalHasChildProcesses(key).catch(() => false)),
  )
  const busy = keys.filter((_, i) => running[i])
  if (busy.length === 0) return true
  const answer = await showMessage({
    message: t('terminal.confirmKill'),
    detail:
      busy.length > 1
        ? `${busy.map(terminalName).join('\n')}\n\n${t('terminal.confirmKill.detailMany')}`
        : t('terminal.confirmKill.detail'),
    buttons: [{ label: t('terminal.confirmKill.terminate'), value: true }],
    severity: 'warning',
  })
  return answer !== undefined
}

/** Ends the shell and drops its screen (the tab closed). */
export function closeTerminal(key: string) {
  // A tab from before a reload has no session here but may still have its shell in Rust
  if (!sessions.get(key)?.exited) void ipc.terminalKill(key).catch(warn('kill'))
  dispose(key)
}

/** An exit this soon after the start is a failed launch (VS Code's ErrorLaunchThresholdDuration) */
const LAUNCH_THRESHOLD = 500

/**
 * VS Code's exit alert (terminalInstance.ts _onProcessExit): a shell that failed to launch always
 * says so; one that ran says so unless ⌃D ended it (`terminal.integrated.showExitAlert`).
 */
function exitAlert(session: Session, code: number | null): string | undefined {
  if (!code) return undefined
  if (session.startedAt === undefined || performance.now() - session.startedAt < LAUNCH_THRESHOLD) {
    return t('terminal.launchFailed', code)
  }
  return session.lastInput === '\x04' ? undefined : t('terminal.exited', code)
}

let listening = false

function listenForEvents() {
  if (listening) return
  listening = true
  // VS Code closes a terminal whose shell exits. Its alert must outlive the tab, so a window the
  // tab leaves empty stays open until the alert goes.
  void listen<{ key: string; code: number | null }>('terminal://exit', ({ payload }) => {
    const session = sessions.get(payload.key)
    if (session) session.exited = true
    const alert = session && exitAlert(session, payload.code)
    const shown = alert
      ? new Promise<void>((resolve) => toastManager.add({ type: 'error', title: alert, onClose: resolve }))
      : undefined
    closeDetailTabs('terminal', (params) => params.get('key') === payload.key, shown)
    dispose(payload.key)
  })
  void listen<{ key: string; title: string }>('terminal://title', ({ payload }) => {
    if (!sessions.has(payload.key)) return
    titles.set(payload.key, payload.title)
    listeners.forEach((fn) => fn())
  })
}
