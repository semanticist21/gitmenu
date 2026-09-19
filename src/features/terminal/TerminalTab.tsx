// A terminal tab: VS Code's terminal in the editor area. The tab only shows the session's xterm
// (sessions.ts), which outlives the component while the tab is open.
import { useEffect, useRef } from 'react'
import { useDarkMode } from '@/features/diff/DiffTab'
import type { DetailTabProps } from '@/routes/detail/DetailApp'
import { closeTerminal, confirmCloseTerminals, focusTerminal, mountTerminal, terminalInfo, terminalName, updateTerminalTheme } from './sessions'

/** VS Code's default terminal title: the process in the foreground, the shell while it waits. */
export function terminalLabel(params: URLSearchParams) {
  return terminalName(params.get('key'))
}

/** The hover: the folder the shell started in. */
export function terminalTitle(params: URLSearchParams) {
  return terminalInfo(params.get('key'))?.cwd ?? params.get('cwd') ?? terminalLabel(params)
}

export function closeTerminalTab(params: URLSearchParams) {
  const key = params.get('key')
  if (key) closeTerminal(key)
}

export function confirmCloseTerminalTabs(tabs: URLSearchParams[]) {
  return confirmCloseTerminals(tabs.flatMap((params) => params.get('key') ?? []))
}

export function focusTerminalTab(params: URLSearchParams) {
  const key = params.get('key')
  if (key) focusTerminal(key)
}

export function TerminalTab({ params }: DetailTabProps) {
  const key = params.get('key')
  const cwd = params.get('cwd')
  const ref = useRef<HTMLDivElement>(null)
  const dark = useDarkMode()

  useEffect(() => (key && ref.current ? mountTerminal(key, cwd, ref.current) : undefined), [key, cwd])
  useEffect(() => {
    if (key) updateTerminalTheme(key)
  }, [key, dark])

  return <div ref={ref} className="h-full bg-editor" data-context={JSON.stringify({ terminalFocus: true })} />
}
