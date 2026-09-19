// Shows a render error instead of a blank window, with a way to reload.
import { Component, type ReactNode } from 'react'
import { t } from '@/i18n'
import { ipc } from '@/lib/ipc'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[gitmenu] render error', error)
    // Sent only when crash reports are on; Rust strips paths first
    void ipc.crashReport(`${error.message}\n${error.stack ?? ''}`).catch((e: unknown) => console.warn('[gitmenu] crash report failed', e))
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="flex h-screen flex-col gap-2 overflow-auto p-4 text-[13px]">
        <p className="font-medium">{t('error.render')}</p>
        <pre className="whitespace-pre-wrap break-words text-muted-foreground text-xs">
          {this.state.error.message}
          {'\n'}
          {this.state.error.stack}
        </pre>
        <button type="button" className="self-start underline" onClick={() => window.location.reload()}>
          {t('error.reload')}
        </button>
      </div>
    )
  }
}
