// Applies `gitmenu.theme.mode` (system/light/dark) to <html>. The palette is VS Code's
// VS Code's Light Modern / Dark Modern.
import { useEffect } from 'react'
import { useSetting } from '@/settings/settings'

export function useTheme() {
  const mode = useSetting<string>('gitmenu.theme.mode')

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = mode === 'dark' || (mode !== 'light' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [mode])
}

/** True when the page currently renders dark (for Shiki's dark theme). */
export function isDark(): boolean {
  return document.documentElement.classList.contains('dark')
}
