// Applies `gitmenu.theme.mode` (system/light/dark) and `gitmenu.theme.preset` to <html>.
import { useEffect } from 'react'
import { useSetting } from '@/settings/settings'

export function useTheme() {
  const mode = useSetting<string>('gitmenu.theme.mode')
  const preset = useSetting<string>('gitmenu.theme.preset')

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

  useEffect(() => {
    if (preset && preset !== 'neutral') document.documentElement.dataset.preset = preset
    else delete document.documentElement.dataset.preset
  }, [preset])
}

/** True when the page currently renders dark (for Shiki's github-dark). */
export function isDark(): boolean {
  return document.documentElement.classList.contains('dark')
}
