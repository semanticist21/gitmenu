// Syntax highlighting off the UI thread: Shiki with the Oniguruma (WASM) engine, VS Code's
// own regex engine for TextMate grammars. Grammars load the first time a language is seen.
// Lines longer than `editor.maxTokenizationLineLength` stay plain, as in VS Code. Results go
// back a block at a time (src/workers/tokens.ts), so no single message blocks the UI thread.
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { bundledLanguages } from 'shiki/langs'
import { blocks, CHUNK, type CancelRequest, type HighlightRequest, type HighlightResponse, type TokenLine } from './tokens'

export type { CancelRequest, HighlightRequest, HighlightResponse, TokenLine } from './tokens'

let highlighter: Promise<HighlighterCore> | null = null
const loading = new Map<string, Promise<void>>()

function get() {
  highlighter ??= createHighlighterCore({
    themes: [import('@shikijs/themes/light-plus'), import('@shikijs/themes/dark-plus')],
    langs: [],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  })
  return highlighter
}

async function ensureLanguage(hl: HighlighterCore, lang: string): Promise<boolean> {
  if (hl.getLoadedLanguages().includes(lang)) return true
  const loader = bundledLanguages[lang as keyof typeof bundledLanguages]
  if (!loader) return false
  if (!loading.has(lang)) loading.set(lang, hl.loadLanguage(loader))
  try {
    await loading.get(lang)
  } catch (error) {
    // A failed load leaves Shiki's language graph broken for every later language: start over
    // with a new highlighter, and let this language fail on its own next time
    loading.clear()
    highlighter = null
    throw error
  }
  return true
}

const running = new Set<number>()
const cancelled = new Set<number>()
const yieldToMessages = () => new Promise((resolve) => setTimeout(resolve, 0))

self.onmessage = async (event: MessageEvent<HighlightRequest | CancelRequest>) => {
  if ('cancel' in event.data) {
    // A request that already finished needs no flag, and keeping one would never be cleared
    if (running.has(event.data.cancel)) cancelled.add(event.data.cancel)
    return
  }
  const { id, text, lang, theme, maxLineLength } = event.data
  running.add(id)
  const post = (offset: number, lines: TokenLine[] | null, done: boolean) => self.postMessage({ id, offset, lines, done } satisfies HighlightResponse)
  try {
    const hl = await get()
    if (!(await ensureLanguage(hl, lang))) {
      // A language Shiki does not bundle — a plain .txt diff, say — answers plain
      post(0, null, true)
    } else {
      const tokens = hl.codeToTokensBase(text, { lang, theme, tokenizeMaxLineLength: maxLineLength })
      for (const { offset, done } of blocks(tokens.length)) {
        if (cancelled.has(id)) break
        post(
          offset,
          tokens.slice(offset, offset + CHUNK).map<TokenLine>((line) => line.map((t) => [t.content, t.color ?? '', t.fontStyle ?? 0])),
          done,
        )
        if (!done) await yieldToMessages()
      }
    }
  } catch {
    post(0, null, true)
  } finally {
    // Every way out clears both flags, or a request that took one would keep its id for the
    // life of the worker and the comment above would stop holding
    running.delete(id)
    cancelled.delete(id)
  }
}
