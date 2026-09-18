// Syntax highlighting off the UI thread: Shiki with the Oniguruma (WASM) engine, VS Code's
// own regex engine for TextMate grammars. Grammars load the first time a language is seen.
// Lines longer than `editor.maxTokenizationLineLength` stay plain, as in VS Code.
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { bundledLanguages } from 'shiki/langs'

export interface HighlightRequest {
  id: number
  text: string
  lang: string
  theme: 'github-light' | 'github-dark'
  maxLineLength: number
}

/** [content, color, fontStyle] per token, per line */
export type TokenLine = [string, string, number][]

export interface HighlightResponse {
  id: number
  lines: TokenLine[] | null
}

let highlighter: Promise<HighlighterCore> | null = null
const loading = new Map<string, Promise<void>>()

function get() {
  highlighter ??= createHighlighterCore({
    themes: [import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark')],
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
  await loading.get(lang)
  return true
}

self.onmessage = async (event: MessageEvent<HighlightRequest>) => {
  const { id, text, lang, theme, maxLineLength } = event.data
  try {
    const hl = await get()
    if (!(await ensureLanguage(hl, lang))) {
      self.postMessage({ id, lines: null } satisfies HighlightResponse)
      return
    }
    const tokens = hl.codeToTokensBase(text, { lang, theme, tokenizeMaxLineLength: maxLineLength })
    const lines: TokenLine[] = tokens.map((line) => line.map((t) => [t.content, t.color ?? '', t.fontStyle ?? 0]))
    self.postMessage({ id, lines } satisfies HighlightResponse)
  } catch {
    self.postMessage({ id, lines: null } satisfies HighlightResponse)
  }
}
