// Talks to the Shiki worker: one worker per window, requests by id, results kept only while
// a tab shows them (no global cache, per the memory rules in SPEC.md).
import { useEffect, useState } from 'react'
import { useSetting } from '@/settings/settings'
import type { HighlightRequest, HighlightResponse, TokenLine } from '@/workers/shiki.worker'

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, (lines: TokenLine[] | null) => void>()

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../../workers/shiki.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<HighlightResponse>) => {
      pending.get(event.data.id)?.(event.data.lines)
      pending.delete(event.data.id)
    }
  }
  return worker
}

function highlight(request: Omit<HighlightRequest, 'id'>): Promise<TokenLine[] | null> {
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    getWorker().postMessage({ ...request, id })
  })
}

// File name / extension → Shiki language id (Shiki's own aliases cover most extensions)
const BY_EXTENSION: Record<string, string> = {
  mjs: 'javascript',
  cjs: 'javascript',
  mts: 'typescript',
  cts: 'typescript',
  h: 'c',
  hh: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  m: 'objective-c',
  mm: 'objective-cpp',
  htm: 'html',
  yml: 'yaml',
  zsh: 'shellscript',
  bash: 'shellscript',
  sh: 'shellscript',
  command: 'shellscript',
  jsonc: 'jsonc',
  json5: 'json5',
  gradle: 'groovy',
  kts: 'kotlin',
  pyi: 'python',
  svelte: 'svelte',
  vue: 'vue',
  tf: 'hcl',
  plist: 'xml',
  entitlements: 'xml',
  storyboard: 'xml',
  xib: 'xml',
  csproj: 'xml',
  lock: 'json',
}
const BY_NAME: Record<string, string> = {
  Dockerfile: 'docker',
  Makefile: 'make',
  makefile: 'make',
  CMakeLists: 'cmake',
  '.zshrc': 'shellscript',
  '.bashrc': 'shellscript',
  'Cargo.lock': 'toml',
  'bun.lock': 'jsonc',
}

export function languageFor(path: string): string {
  const name = path.split('/').pop() ?? path
  if (BY_NAME[name]) return BY_NAME[name]
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  return BY_EXTENSION[ext] ?? ext
}

/** Tokens for `text` in the current theme; `null` while loading or for unknown languages. */
export function useHighlight(text: string | null | undefined, path: string, dark: boolean): TokenLine[] | null {
  const maxLineLength = useSetting<number>('editor.maxTokenizationLineLength')
  const [result, setResult] = useState<{ key: string; lines: TokenLine[] | null } | null>(null)
  const key = `${path}\0${dark}\0${text?.length}\0${text?.slice(0, 64)}`
  useEffect(() => {
    if (text == null) return
    let alive = true
    void highlight({ text, lang: languageFor(path), theme: dark ? 'dark-plus' : 'light-plus', maxLineLength }).then(
      (lines) => {
        if (alive) setResult({ key, lines })
      },
    )
    return () => {
      alive = false
    }
  }, [text, path, dark, maxLineLength, key])
  return result?.key === key ? result.lines : null
}
