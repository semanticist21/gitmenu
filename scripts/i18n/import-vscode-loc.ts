// Copies VS Code's git extension strings and their official translations into src/i18n/vscode/.
// English comes from microsoft/vscode (extensions/git/package.nls.json); translations from
// microsoft/vscode-loc. Both are MIT (see THIRD_PARTY_NOTICES.md). Re-run to update the pins.
//
// Output per language: { package: { nlsKey: text }, bundle: { englishText: text } }
//   package → command titles, setting descriptions (`%command.stage%` style keys)
//   bundle  → runtime messages, keyed by their English text
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VSCODE_TAG = '1.138.0'
const VSCODE_LOC_COMMIT = '0f157dee0cdcbf58cdf51a221ee94751c7f35e75'
// gitmenu locale id → vscode-loc language pack folder
const LANGUAGES: Record<string, string> = {
  ko: 'ko',
  ja: 'ja',
  'zh-cn': 'zh-hans',
  'zh-tw': 'zh-hant',
  de: 'de',
  fr: 'fr',
  es: 'es',
  'pt-br': 'pt-BR',
  ru: 'ru',
}

const outDir = join(import.meta.dirname, '..', '..', 'src', 'i18n', 'vscode')

async function json(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  // vscode-loc files start with a BOM
  return JSON.parse((await res.text()).replace(/^\uFEFF/, ''))
}

mkdirSync(outDir, { recursive: true })

const english = await json(`https://raw.githubusercontent.com/microsoft/vscode/${VSCODE_TAG}/extensions/git/package.nls.json`)
const englishPackage = Object.fromEntries(
  Object.entries(english).map(([key, value]) => [key, typeof value === 'string' ? value : (value as { message: string }).message]),
)
writeFileSync(join(outDir, 'en.json'), JSON.stringify({ package: englishPackage, bundle: {} }, null, 1) + '\n')

for (const [locale, pack] of Object.entries(LANGUAGES)) {
  const url = `https://raw.githubusercontent.com/microsoft/vscode-loc/${VSCODE_LOC_COMMIT}/i18n/vscode-language-pack-${pack}/translations/extensions/vscode.git.i18n.json`
  const data = await json(url)
  writeFileSync(
    join(outDir, `${locale}.json`),
    JSON.stringify({ package: data.contents.package, bundle: data.contents.bundle }, null, 1) + '\n',
  )
  console.log(`${locale}: ${Object.keys(data.contents.package).length} package, ${Object.keys(data.contents.bundle).length} bundle`)
}
