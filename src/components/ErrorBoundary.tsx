// Shows a render error instead of a blank window, with a way to reload.
import { invoke } from '@tauri-apps/api/core'
import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[gitside] render error', error)
    // Sent only when crash reports are on; Rust strips paths first
    void invoke('crash_report', { message: `${error.message}\n${error.stack ?? ''}` }).catch(() => {})
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="flex h-screen flex-col gap-2 overflow-auto p-4 text-[13px]">
        <p className="font-medium">Something went wrong.</p>
        <pre className="whitespace-pre-wrap break-words text-muted-foreground text-xs">
          {this.state.error.message}
          {'\n'}
          {this.state.error.stack}
        </pre>
        <button type="button" className="self-start underline" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
