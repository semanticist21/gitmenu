// When a window becomes key with nothing focused, WebKit focuses its first control as if Tab
// had been pressed (setInitialFocus): the panel opened with a focus ring and a tooltip on its
// first button every time. Focus that arrives with the window, not from a click or key in it,
// is dropped; text fields keep it, so the commit message box still gets its caret back.
import { useEffect } from 'react'

/** How long after the window gains focus a focus change still counts as WebKit's */
const WINDOW_FOCUS_MS = 300

export function useNoInitialFocusRing() {
  useEffect(() => {
    let lastInput = 0
    let windowFocus = 0
    // Only a window that was inactive becoming key counts (a hidden panel is inactive)
    let inactive = !document.hasFocus()
    const onInput = () => {
      lastInput = performance.now()
    }
    const settle = (el: Element | null) => {
      if (!(el instanceof HTMLElement) || el === document.body) return
      if (el.matches('input, textarea, select, [contenteditable="true"]')) return
      // The user clicked or typed in this window since it got focus
      if (lastInput >= windowFocus) return
      el.blur()
    }
    const onWindowFocus = () => {
      if (!inactive) return
      inactive = false
      windowFocus = performance.now()
      settle(document.activeElement)
    }
    const onWindowBlur = () => {
      inactive = true
    }
    const onFocusIn = (e: FocusEvent) => {
      if (performance.now() - windowFocus < WINDOW_FOCUS_MS) settle(e.target as Element)
    }
    window.addEventListener('pointerdown', onInput, true)
    window.addEventListener('keydown', onInput, true)
    window.addEventListener('focus', onWindowFocus)
    window.addEventListener('blur', onWindowBlur)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener('pointerdown', onInput, true)
      window.removeEventListener('keydown', onInput, true)
      window.removeEventListener('focus', onWindowFocus)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [])
}
