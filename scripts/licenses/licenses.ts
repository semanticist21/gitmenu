// Collects the license of everything the app ships, for About gitmenu: npm packages whose code
// is in the bundle, Rust crates linked into the macOS binary, and Shiki's TextMate grammars.
// Grammars without a permissive license (GPL, or none stated) are replaced by an empty grammar,
// so those languages show without colors instead of shipping code we may not redistribute.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import spdx from 'spdx-license-list/full.js'
import { grammars, injections } from 'tm-grammars'
import type { Plugin } from 'vite'
import type { LicensedPackage, Licenses } from '../../src/features/about/licenses'

const ROOT = path.resolve(import.meta.dirname, '../..')
const TARGETS = ['aarch64-apple-darwin', 'x86_64-apple-darwin']

/** Licenses a grammar may have to be bundled */
const PERMISSIVE = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Zlib', 'MPL-2.0', 'Unlicense', 'CC0-1.0', 'BSL-1.0'])
/** Which license of an `A OR B` choice to show: the shortest common ones first */
const PREFERENCE = ['MIT', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Zlib', 'Apache-2.0', 'Unicode-3.0', 'Unicode-DFS-2016', 'BSL-1.0', 'MPL-2.0', 'Unlicense', 'CC0-1.0']

const phrase = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'), 'i')
const PATTERNS: [string, RegExp][] = [
  ['MIT', phrase('Permission is hereby granted, free of charge')],
  ['Apache-2.0', /Apache License,?\s+Version 2\.0/i],
  ['MPL-2.0', /Mozilla Public License,?\s+(v\.|version)\s*2\.0/i],
  ['Zlib', /provided\s+['‘]as-is['’],\s+without\s+any\s+express\s+or\s+implied\s+warranty/i],
  ['Unlicense', phrase('This is free and unencumbered software released into the public domain')],
  ['Unicode-3.0', /UNICODE LICENSE V3/i],
  ['Unicode-DFS-2016', /UNICODE,?\s+INC\.?\s+LICENSE\s+AGREEMENT/i],
  ['BSD-3-Clause', /Redistribution and use in source and binary forms[\s\S]*Neither the name/i],
  ['BSD-2-Clause', phrase('Redistribution and use in source and binary forms')],
  ['ISC', /Permission to use, copy, modify, and(\/or)?\s+distribute\s+this\s+software\s+for\s+any\s+purpose/i],
  ['BSL-1.0', phrase('Boost Software License')],
  ['CC-BY-4.0', phrase('Creative Commons Attribution 4.0')],
  ['CC0-1.0', phrase('CC0 1.0 Universal')],
  ['GPL', phrase('GNU General Public License')],
]

/** The licenses a text contains (a file may hold several) */
export function classify(text: string): Set<string> {
  const ids = new Set<string>()
  for (const [id, pattern] of PATTERNS) {
    if (id === 'BSD-2-Clause' && ids.has('BSD-3-Clause')) continue
    if (pattern.test(text)) ids.add(id)
  }
  return ids
}

type Expr = { id: string } | { op: 'AND' | 'OR'; args: Expr[] }

/** Parses an SPDX expression; the old `A/B` form means `A OR B` */
export function parseSpdx(expression: string): Expr {
  const tokens = expression.replace(/\//g, ' OR ').match(/\(|\)|[^\s()]+/g) ?? ['NOASSERTION']
  let i = 0
  const keyword = (word: string) => tokens[i]?.toUpperCase() === word
  const atom = (): Expr => {
    const token = tokens[i++] ?? 'NOASSERTION'
    if (token === '(') {
      const inner = or()
      i++
      return inner
    }
    if (keyword('WITH')) {
      i += 2
      return { id: `${token} WITH ${tokens[i - 1]}` }
    }
    return { id: token }
  }
  const and = (): Expr => {
    const args = [atom()]
    while (keyword('AND')) {
      i++
      args.push(atom())
    }
    return args.length === 1 ? args[0] : { op: 'AND', args }
  }
  const or = (): Expr => {
    const args = [and()]
    while (keyword('OR')) {
      i++
      args.push(and())
    }
    return args.length === 1 ? args[0] : { op: 'OR', args }
  }
  return or()
}

const base = (id: string) => id.split(' WITH ')[0].replace(/\+$/, '')
const rank = (id: string) => {
  const index = PREFERENCE.indexOf(base(id))
  return index < 0 ? PREFERENCE.length : index
}

/** The licenses to show: all parts of an AND, and for an OR the option the package ships a file for */
export function chooseLicenses(expr: Expr, shipped: ReadonlySet<string>): string[] {
  if ('id' in expr) return [expr.id]
  const options = expr.args.map((arg) => chooseLicenses(arg, shipped))
  if (expr.op === 'AND') return options.flat()
  const cost = (ids: string[]) => ids.reduce((sum, id) => sum + (shipped.has(base(id)) ? 0 : 100) + rank(id), 0)
  return options.reduce((best, option) => (cost(option) < cost(best) ? option : best))
}

/** The standard text of a license, with the copyright line filled in where it has one */
function standardText(id: string, holder: string): string | undefined {
  const text = (spdx as Record<string, { licenseText: string } | undefined>)[id]?.licenseText
  if (!text) return undefined
  if (/<(copyright holders|owner)>/.test(text)) return text.replace(/<year>\s*/g, '').replace(/<(copyright holders|owner)>/g, holder)
  return /^(Apache|MPL|CC-|Unlicense|CC0)/.test(id) ? text : `Copyright (c) ${holder}\n\n${text}`
}

interface LicenseFile {
  name: string
  text: string
  ids: Set<string>
}

function licenseFiles(dir: string, extra?: string): LicenseFile[] {
  const files: string[] = []
  const add = (folder: string) => {
    if (!existsSync(folder)) return
    for (const name of readdirSync(folder)) {
      const file = path.join(folder, name)
      if (/^(licen[cs]es?|copying|notice|unlicense|copyright)([-._].*)?$/i.test(name) && statSync(file).isFile()) files.push(file)
    }
  }
  add(dir)
  add(path.join(dir, 'LICENSES'))
  if (extra && existsSync(extra) && !files.includes(extra)) files.push(extra)
  return files.sort().map((file) => {
    const text = readFileSync(file, 'utf8').trim()
    return { name: path.basename(file), text, ids: classify(text) }
  })
}

/** The license texts a package ships for its declared license */
export function packageTexts(files: LicenseFile[], declared: string, holder: string): string[] {
  const shipped = new Set(files.flatMap((f) => [...f.ids]))
  const chosen = chooseLicenses(parseSpdx(declared), shipped)
  const out = new Set<string>()
  const unclassified = files.filter((f) => f.ids.size === 0 && !/^notice/i.test(f.name))
  for (const id of chosen) {
    const file = files.find((f) => f.ids.has(base(id))) ?? (unclassified.length === 1 ? unclassified[0] : undefined)
    const text = file?.text ?? standardText(base(id), holder)
    if (text) out.add(text)
  }
  // An Apache-2.0 NOTICE travels with the code
  for (const f of files) if (/^notice/i.test(f.name)) out.add(f.text)
  if (out.size === 0) for (const f of files) out.add(f.text)
  return [...out]
}

type Found = Omit<LicensedPackage, 'texts'> & { texts: string[] }

const person = (value: unknown): string | undefined => {
  const name = typeof value === 'string' ? value : (value as { name?: string } | undefined)?.name
  return name?.replace(/\s*[<(][^>)]*[>)]/g, '').trim() || undefined
}

function npmPackage(dir: string): Found | undefined {
  const manifest = path.join(dir, 'package.json')
  if (!existsSync(manifest)) return undefined
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  const declared =
    typeof pkg.license === 'string'
      ? pkg.license
      : (pkg.license?.type ?? pkg.licenses?.map((l: { type: string }) => l.type).join(' OR ') ?? 'NOASSERTION')
  const holder = [pkg.author, ...(pkg.contributors ?? [])].map(person).filter(Boolean).join(', ') || `the ${pkg.name} authors`
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  return {
    name: pkg.name,
    version: pkg.version,
    kind: 'npm',
    license: declared,
    url: `https://www.npmjs.com/package/${pkg.name}`,
    homepage: normalizeUrl(pkg.homepage ?? repository),
    texts: packageTexts(licenseFiles(dir), declared, holder),
  }
}

function normalizeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  const clean = url.replace(/^git\+/, '').replace(/\.git(#.*)?$/, '').replace(/^git:\/\//, 'https://')
  const short = clean.match(/^(github|gitlab):(.+)$/) ?? (/^[\w.-]+\/[\w.-]+$/.test(clean) ? ['', 'github', clean] : null)
  if (short) return `https://${short[1]}.com/${short[2]}`
  return /^https?:\/\//.test(clean) ? clean : undefined
}

/** The package directory a bundled module comes from */
export function moduleDir(id: string): string | undefined {
  const clean = id.replace(/^\0/, '').replace(/[?#].*$/, '')
  // Bundler helpers injected as virtual modules
  if (/^vite\//.test(clean)) return path.join(ROOT, 'node_modules/vite')
  if (/^rolldown\//.test(clean)) return path.join(ROOT, 'node_modules/rolldown')
  const marker = '/node_modules/'
  const i = clean.lastIndexOf(marker)
  if (i < 0) return undefined
  const parts = clean.slice(i + marker.length).split('/')
  const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
  return clean.slice(0, i + marker.length) + name
}

/** Packages the stylesheet `@import`s (Tailwind, codicons): compiled into the CSS, not bundled as modules */
function cssPackageDirs(): string[] {
  const css = readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
  return [...css.matchAll(/@import\s+["']([^"'./][^"']*)["']/g)].map(([, spec]) => {
    const parts = spec.split('/')
    return path.join(ROOT, 'node_modules', spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0])
  })
}

/** Every runtime dependency, for the dev server, which has no bundle to look at */
function dependencyDirs(): Set<string> {
  const dirs = new Set<string>()
  const visit = (name: string, from: string) => {
    let dir = from
    while (!existsSync(path.join(dir, 'node_modules', name, 'package.json'))) {
      const parent = path.dirname(dir)
      if (parent === dir) return
      dir = parent
    }
    const found = path.join(dir, 'node_modules', name)
    if (dirs.has(found)) return
    dirs.add(found)
    const pkg = JSON.parse(readFileSync(path.join(found, 'package.json'), 'utf8'))
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, found)
  }
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, ROOT)
  return dirs
}

interface CargoPackage {
  id: string
  name: string
  version: string
  license: string | null
  license_file: string | null
  authors: string[]
  repository: string | null
  homepage: string | null
  manifest_path: string
  /** `registry+…` for crates.io, `git+https://…?rev=…#sha` for git dependencies */
  source: string | null
}

/** Crates linked into the app: normal dependencies of the app crate on the macOS targets */
function cargoPackages(): Found[] {
  const args = ['metadata', '--format-version', '1', '--manifest-path', path.join(ROOT, 'src-tauri/Cargo.toml')]
  for (const target of TARGETS) args.push('--filter-platform', target)
  const meta = JSON.parse(execFileSync('cargo', args, { maxBuffer: 1 << 28, encoding: 'utf8' }))
  const nodes = new Map<string, { deps: { pkg: string; dep_kinds: { kind: string | null }[] }[] }>(
    meta.resolve.nodes.map((n: { id: string }) => [n.id, n]),
  )
  const linked = new Set<string>()
  const stack: string[] = [meta.resolve.root]
  while (stack.length) {
    const id = stack.pop() as string
    if (linked.has(id)) continue
    linked.add(id)
    for (const dep of nodes.get(id)?.deps ?? []) if (dep.dep_kinds.some((k) => k.kind === null)) stack.push(dep.pkg)
  }
  linked.delete(meta.resolve.root)
  return (meta.packages as CargoPackage[])
    .filter((p) => linked.has(p.id))
    .map((p) => {
      const dir = path.dirname(p.manifest_path)
      const files = licenseFiles(dir, p.license_file ? path.resolve(dir, p.license_file) : undefined)
      // No license field: say what the shipped files are (Rust crates with two files are dual-licensed)
      const found = [...new Set(files.flatMap((f) => [...f.ids]))]
      const declared = p.license ?? (found.length ? found.join(' OR ') : p.license_file ? 'LicenseRef-custom' : 'NOASSERTION')
      const label = p.license || !found.length ? declared : `${declared} (license files)`
      const git = p.source?.startsWith('git+') ? p.source.slice(4).replace(/[?#].*$/, '').replace(/\.git$/, '') : undefined
      const holder = p.authors.map(person).filter(Boolean).join(', ') || `the ${p.name} authors`
      return {
        name: p.name,
        version: p.version,
        kind: 'cargo',
        license: label,
        url: git ?? `https://crates.io/crates/${p.name}`,
        homepage: normalizeUrl(p.repository ?? p.homepage ?? git),
        texts: packageTexts(files, declared, holder),
      }
    })
}

const grammarInfo = new Map([...grammars, ...injections].map((g) => [g.name, g]))

interface GrammarNotice {
  spdx: string
  url: string
  text: string
}

let grammarNotices: Map<string, GrammarNotice> | undefined

/** tm-grammars' NOTICE: the license of each grammar file, keyed by grammar name */
function notices(): Map<string, GrammarNotice> {
  if (grammarNotices) return grammarNotices
  grammarNotices = new Map()
  const notice = readFileSync(path.join(ROOT, 'node_modules/tm-grammars/NOTICE'), 'utf8')
  // Sections are separated by a long rule; a license text may contain shorter ones (LLVM's does)
  for (const section of notice.split(/^={90,}$/m).slice(1)) {
    const files = section.match(/^Files:\s*(.+)$/m)?.[1]
    const url = section.match(/^License:\s*(\S+)$/m)?.[1] ?? ''
    const id = section.match(/^SPDX:\s*(\S+)$/m)?.[1] ?? 'NOASSERTION'
    const rule = section.match(/^-{90,}$/m)
    const text = rule?.index === undefined ? undefined : section.slice(rule.index + rule[0].length).trim()
    if (!files || !text) continue
    for (const file of files.split(',')) grammarNotices.set(file.trim().replace(/\.json$/, ''), { spdx: id, url, text })
  }
  return grammarNotices
}

/** The license of TextMate's own bundles (github.com/textmate), as VS Code's cgmanifest.json records it */
const TEXTMATE_BUNDLE = (bundle: string) => `Copyright (c) textmate-${bundle} project authors

If not otherwise specified (see below), files in this folder fall under the following license:

Permission to copy, use, modify, sell and distribute this
software is granted. This software is provided "as is" without
express or implied warranty, and with no claim as to its
suitability for any purpose.

An exception is made for files in readable text which contain their own license information,
or files where an accompanying file exists (in the same directory) with a "-license" suffix added
to the base-name name of the original file, and an extension of txt, html, or similar. For example
"tidy" is accompanied by "tidy-license.txt".`

/** A grammar's license notice when tm-grammars' NOTICE has none: TextMate's bundles, and grammars tm-grammars writes itself */
function implicitNotice(name: string): GrammarNotice | undefined {
  const info = grammarInfo.get(name)
  if (!info) return undefined
  const bundle = info.source?.match(/^https:\/\/github\.com\/textmate\/([\w.-]+)/)?.[1]
  if (bundle) return { spdx: 'LicenseRef-TextMate-Bundle', url: `https://github.com/textmate/${bundle}`, text: TEXTMATE_BUNDLE(bundle) }
  if (!info.source) {
    const text = readFileSync(path.join(ROOT, 'node_modules/tm-grammars/LICENSE'), 'utf8').trim()
    return { spdx: 'MIT', url: 'https://github.com/shikijs/textmate-grammars-themes', text }
  }
  return undefined
}

/** NOASSERTION grammars whose license text is one a pattern can't name on its own */
const GRAMMAR_LICENSES: Record<string, string> = { llvm: 'Apache-2.0 WITH LLVM-exception' }

/** A grammar's license if it may be bundled; the stated SPDX id, or else what its text is */
export function grammarLicense(name: string): string | undefined {
  const notice = notices().get(name) ?? implicitNotice(name)
  if (!notice) return undefined
  if (GRAMMAR_LICENSES[name]) return GRAMMAR_LICENSES[name]
  if (notice.spdx === 'LicenseRef-TextMate-Bundle') return 'TextMate Bundle License'
  if (PERMISSIVE.has(notice.spdx)) return notice.spdx
  const ids = classify(notice.text)
  if (ids.has('GPL')) return undefined
  return PREFERENCE.find((id) => ids.has(id) && PERMISSIVE.has(id))
}

const GRAMMAR_FILE = /\/@shikijs\/langs\/dist\/([\w.+-]+)\.mjs$/

function grammarPackages(names: Iterable<string>): Found[] {
  const version = JSON.parse(readFileSync(path.join(ROOT, 'node_modules/@shikijs/langs/package.json'), 'utf8')).version
  return [...names].flatMap((name) => {
    const license = grammarLicense(name)
    const notice = notices().get(name) ?? implicitNotice(name)
    if (!license || !notice) return []
    const info = grammarInfo.get(name)
    return [
      {
        name: info?.displayName ? `${info.displayName} grammar` : `${name} grammar`,
        version,
        kind: 'grammar' as const,
        license,
        url: info?.source?.replace(/\/blob\/[0-9a-f]+\/.*$/, '') ?? notice.url,
        texts: [notice.text],
      },
    ]
  })
}

function assemble(found: Found[]): Licenses {
  const texts: string[] = []
  const index = new Map<string, number>()
  const byKey = new Map<string, LicensedPackage>()
  for (const pkg of found) {
    const key = `${pkg.kind}:${pkg.name}@${pkg.version}`
    if (byKey.has(key)) continue
    const ids = pkg.texts.map((text) => {
      let i = index.get(text)
      if (i === undefined) {
        i = texts.push(text) - 1
        index.set(text, i)
      }
      return i
    })
    byKey.set(key, { ...pkg, texts: ids })
  }
  const order = { npm: 0, grammar: 1, cargo: 2 }
  const packages = [...byKey.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  return {
    license: readFileSync(path.join(ROOT, 'LICENSE'), 'utf8').trim(),
    notices: readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8').trim(),
    packages,
    texts,
  }
}

// Shared by the app build and the Shiki worker build, which Vite runs as a separate bundle first
const bundledDirs = new Set<string>()
const bundledGrammars = new Set<string>()

/** Leaves out grammars that may not be bundled, and records the rest */
function grammarFilter(): Plugin {
  return {
    name: 'gitmenu:grammar-licenses',
    load(id) {
      const name = id.replace(/\\/g, '/').replace(/[?#].*$/, '').match(GRAMMAR_FILE)?.[1]
      if (!name || !grammarInfo.has(name)) return null
      // Other grammars embed it by name, so it stays loadable, just without rules
      if (!grammarLicense(name)) return `export default [${JSON.stringify(grammarStub(name))}]`
      bundledGrammars.add(name)
      return null
    },
  }
}

/** An empty grammar in place of one that may not be bundled. Grammars that embed it (cpp
 * embeds glsl) need it to exist, or Shiki refuses to load them and every language after. */
export function grammarStub(name: string) {
  const info = grammarInfo.get(name)
  return { name, displayName: info?.displayName ?? name, scopeName: info?.scopeName ?? `source.${name}`, patterns: [], repository: {} }
}

function recordModules(ids: Iterable<string>) {
  for (const id of ids) {
    const dir = moduleDir(id)
    if (dir) bundledDirs.add(dir)
  }
}

/** For `worker.plugins`: the worker's grammars and packages */
export function workerLicenses(): Plugin[] {
  return [
    grammarFilter(),
    {
      name: 'gitmenu:worker-licenses',
      apply: 'build',
      generateBundle() {
        recordModules(this.getModuleIds())
      },
    },
  ]
}

/** Emits `licenses.json` with the build; the dev server serves one built from the dependency tree */
export function licenses(): Plugin[] {
  let dev: string | undefined
  return [
    grammarFilter(),
    {
      name: 'gitmenu:licenses',
      configureServer(server) {
        server.middlewares.use('/licenses.json', (_req, res) => {
          dev ??= JSON.stringify(
            assemble([
              ...[...dependencyDirs()].flatMap((dir) => npmPackage(dir) ?? []),
              ...grammarPackages(grammarInfo.keys()),
              ...cargoPackages(),
            ]),
          )
          res.setHeader('Content-Type', 'application/json')
          res.end(dev)
        })
      },
      generateBundle() {
        recordModules(this.getModuleIds())
        const npm = [...bundledDirs].flatMap((dir) => npmPackage(dir) ?? [])
        const css = cssPackageDirs().flatMap((dir) => npmPackage(dir) ?? [])
        const data = assemble([...npm, ...css, ...grammarPackages(bundledGrammars), ...cargoPackages()])
        this.emitFile({ type: 'asset', fileName: 'licenses.json', source: JSON.stringify(data) })
      },
    },
  ]
}
