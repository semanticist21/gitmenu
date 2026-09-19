import { expect, test } from 'bun:test'
import type { LanguageRegistration } from 'shiki/core'
import { createHighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { grammars, injections } from 'tm-grammars'
import { chooseLicenses, classify, grammarLicense, grammarStub, packageTexts, parseSpdx } from './licenses'

test('SPDX expressions: OR picks the license the package ships a file for, AND keeps all', () => {
  expect(parseSpdx('MIT')).toEqual({ id: 'MIT' })
  expect(chooseLicenses(parseSpdx('MIT OR Apache-2.0'), new Set(['Apache-2.0']))).toEqual(['Apache-2.0'])
  expect(chooseLicenses(parseSpdx('MIT/Apache-2.0'), new Set(['MIT', 'Apache-2.0']))).toEqual(['MIT'])
  expect(chooseLicenses(parseSpdx('(MIT OR Apache-2.0) AND Unicode-3.0'), new Set(['MIT', 'Unicode-3.0']))).toEqual(['MIT', 'Unicode-3.0'])
  expect(chooseLicenses(parseSpdx('Apache-2.0 WITH LLVM-exception OR MIT'), new Set())).toEqual(['MIT'])
})

test('license texts are recognized by their wording', () => {
  expect([...classify('Permission is hereby granted, free of\n charge, to any person')]).toEqual(['MIT'])
  expect(classify('Redistribution and use in source and binary forms ... Neither the name of').has('BSD-2-Clause')).toBe(false)
  expect(classify('GNU GENERAL PUBLIC LICENSE Version 3').has('GPL')).toBe(true)
})

test('a package without a license file gets the standard text with its authors', () => {
  const [text] = packageTexts([], 'MIT', 'Ada Lovelace')
  expect(text).toContain('Copyright (c) Ada Lovelace')
  expect(text).toContain('Permission is hereby granted')
})

// The build replaces grammars that may not be shipped with grammarStub(); every grammar that is
// shipped must still load with them in place, into one highlighter, as the Shiki worker does
test('every shipped grammar loads with the excluded ones stubbed', async () => {
  const names = [...grammars, ...injections].map((g) => g.name)
  const excluded = new Set(names.filter((name) => !grammarLicense(name)))
  expect(excluded.has('glsl')).toBe(true)
  const hl = await createHighlighterCore({
    themes: [import('@shikijs/themes/dark-plus')],
    langs: [],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  })
  for (const name of names.filter((n) => !excluded.has(n))) {
    const langs: LanguageRegistration[] = (await import(`@shikijs/langs/${name}`)).default
    const shipped = langs.map((lang) => (excluded.has(lang.name) ? (grammarStub(lang.name) as LanguageRegistration) : lang))
    await hl.loadLanguage(shipped)
  }
  const tokens = hl.codeToTokensBase('int main() { return 0; }', { lang: 'cpp', theme: 'dark-plus' }).flat()
  expect(new Set(tokens.map((t) => t.color)).size).toBeGreaterThan(2)
}, 60_000)
