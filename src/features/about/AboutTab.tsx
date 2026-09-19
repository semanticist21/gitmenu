// About gitmenu: version and license, the notices for code taken from other projects
// (THIRD_PARTY_NOTICES.md), and the license of every package, crate and grammar the app
// ships (licenses.json, built by scripts/licenses/licenses.ts).
import { useQuery } from '@tanstack/react-query'
import { getVersion } from '@tauri-apps/api/app'
import { Fragment, type ReactNode, useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { Input } from '@/components/ui/input'
import { t, useLocale } from '@/i18n'
import type { AppKey } from '@/i18n/app/en'
import { ipc } from '@/lib/ipc'
import appIcon from '../../../src-tauri/icons/128x128@2x.png'
import type { LicensedPackage, Licenses } from './licenses'

const REPOSITORY = 'https://github.com/semanticist21/gitmenu'

const KINDS: { kind: LicensedPackage['kind']; label: AppKey }[] = [
  { kind: 'npm', label: 'about.npm' },
  { kind: 'grammar', label: 'about.grammars' },
  { kind: 'cargo', label: 'about.crates' },
]

async function loadLicenses(): Promise<Licenses> {
  const response = await fetch('/licenses.json')
  if (!response.ok) throw new Error(`licenses.json: ${response.status}`)
  return response.json()
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="text-(--vsc-textLink-foreground) hover:text-(--vsc-textLink-activeForeground) hover:underline"
      onClick={(e) => {
        e.preventDefault()
        void ipc.openPath(href)
      }}
    >
      {children}
    </a>
  )
}

/** Plain URLs and `code` in a line of the notices */
function inline(text: string): ReactNode[] {
  // A URL doesn't end in the punctuation after it
  return text.split(/(`[^`]+`|https?:\/\/[^\s)]*[^\s),.;:])/g).map((part, i) => {
    if (part.startsWith('`')) return <code key={i} className="text-[0.9em]">{part.slice(1, -1)}</code>
    if (/^https?:\/\//.test(part)) return <Link key={i} href={part}>{part}</Link>
    return part
  })
}

/** THIRD_PARTY_NOTICES.md: its headings, lists, paragraphs and fenced license texts */
function Notices({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let list: string[] = []
  const flush = () => {
    if (!list.length) return
    blocks.push(
      <ul key={blocks.length} className="my-1.5 list-disc ps-5">
        {list.map((item, i) => <li key={i}>{inline(item)}</li>)}
      </ul>,
    )
    list = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('```')) {
      flush()
      const end = lines.indexOf('```', i + 1)
      const code = lines.slice(i + 1, end < 0 ? undefined : end).join('\n')
      blocks.push(<LicenseText key={blocks.length} text={code} />)
      i = end < 0 ? lines.length : end
    } else if (line.startsWith('# ')) {
      flush()
    } else if (line.startsWith('## ')) {
      flush()
      blocks.push(<h3 key={blocks.length} className="mt-4 mb-1 font-semibold">{line.slice(3)}</h3>)
    } else if (line.startsWith('- ')) {
      list.push(line.slice(2))
    } else if (/^\s+\S/.test(line) && list.length) {
      list[list.length - 1] += ` ${line.trim()}`
    } else if (line.trim()) {
      flush()
      // A paragraph runs until a blank line
      let paragraph = line
      while (lines[i + 1]?.trim() && !/^(#|- |```)/.test(lines[i + 1])) paragraph += ` ${lines[++i].trim()}`
      blocks.push(<p key={blocks.length} className="my-1.5">{inline(paragraph)}</p>)
    } else {
      flush()
    }
  }
  flush()
  return <div>{blocks}</div>
}

function LicenseText({ text }: { text: string }) {
  return (
    <pre className="my-1.5 overflow-x-auto whitespace-pre-wrap rounded-[4px] bg-(--vsc-textCodeBlock-background) px-3 py-2 font-mono text-[12px] leading-[18px] select-text">
      {text}
    </pre>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="border-(--vsc-settings-headerBorder) border-b pb-1.5 font-semibold text-[16px]">{title}</h2>
      {children}
    </section>
  )
}

function PackageRow({ pkg, texts, open, onToggle }: { pkg: LicensedPackage; texts: string[]; open: boolean; onToggle: () => void }) {
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        className="flex h-[22px] w-full min-w-0 cursor-pointer items-center rounded-[3px] pe-2 text-start hover:bg-(--vsc-list-hoverBackground) focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-(--vsc-focusBorder)"
        onClick={onToggle}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} className="mx-0.5 shrink-0" />
        <span className="min-w-0 truncate">{pkg.name}</span>
        <span className="ms-1.5 shrink-0 text-(--vsc-descriptionForeground) text-[0.9em]">{pkg.version}</span>
        <span className="ms-auto min-w-0 shrink truncate ps-3 text-(--vsc-descriptionForeground) text-[0.9em]">{pkg.license}</span>
      </button>
      {open && (
        <div className="mb-2 ps-5">
          {(pkg.homepage || pkg.url) && (
            <div className="my-1 flex gap-3 text-[12px]">
              {pkg.homepage && <Link href={pkg.homepage}>{pkg.homepage.replace(/^https?:\/\//, '')}</Link>}
              {pkg.url && pkg.url !== pkg.homepage && <Link href={pkg.url}>{pkg.url.replace(/^https?:\/\//, '')}</Link>}
            </div>
          )}
          {pkg.texts.map((index) => <LicenseText key={index} text={texts[index]} />)}
        </div>
      )}
    </>
  )
}

function Packages({ licenses }: { licenses: Licenses }) {
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set(KINDS.map((k) => k.kind)))
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const query = filter.trim().toLowerCase()
  const groups = useMemo(
    () =>
      KINDS.map(({ kind, label }) => ({
        kind,
        label,
        packages: licenses.packages.filter(
          (p) => p.kind === kind && (!query || p.name.toLowerCase().includes(query) || p.license.toLowerCase().includes(query)),
        ),
      })),
    [licenses, query],
  )
  const toggle = (set: ReadonlySet<string>, key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }
  return (
    <>
      <Input
        type="search"
        size="sm"
        className="mt-2.5 mb-1.5"
        placeholder={t('about.filter')}
        aria-label={t('about.filter')}
        value={filter}
        onChange={(e) => setFilter(e.currentTarget.value)}
      />
      {groups.map((group) => {
        // A filter shows every group that matches
        const expanded = query ? group.packages.length > 0 : !collapsed.has(group.kind)
        return (
          <Fragment key={group.kind}>
            <button
              type="button"
              aria-expanded={expanded}
              className="flex h-[22px] w-full cursor-pointer items-center rounded-[3px] text-start font-semibold hover:bg-(--vsc-list-hoverBackground) focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-(--vsc-focusBorder)"
              onClick={() => setCollapsed(toggle(collapsed, group.kind))}
            >
              <Icon name={expanded ? 'chevron-down' : 'chevron-right'} className="mx-0.5" />
              {t(group.label)}
              <span className="ms-1.5 font-normal text-(--vsc-descriptionForeground)">{group.packages.length}</span>
            </button>
            {expanded && (
              <div className="ps-4">
                {group.packages.map((pkg) => {
                  const key = `${pkg.kind}:${pkg.name}@${pkg.version}`
                  return (
                    <PackageRow key={key} pkg={pkg} texts={licenses.texts} open={open.has(key)} onToggle={() => setOpen(toggle(open, key))} />
                  )
                })}
              </div>
            )}
          </Fragment>
        )
      })}
    </>
  )
}

export function AboutTab() {
  useLocale()
  const { data: version } = useQuery({ queryKey: ['appVersion'], queryFn: getVersion, staleTime: Infinity })
  const { data: licenses, error } = useQuery({ queryKey: ['licenses'], queryFn: loadLicenses, staleTime: Infinity })
  const [showLicense, setShowLicense] = useState(false)
  const copyright = licenses?.license.split('\n').find((line) => line.startsWith('Copyright'))
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-6 py-6 text-[13px]">
        <header className="flex items-start gap-4">
          <img src={appIcon} alt="" className="size-16 shrink-0" draggable={false} />
          <div className="min-w-0">
            <h1 className="font-semibold text-[20px] leading-7">gitmenu</h1>
            {version && <div className="text-(--vsc-descriptionForeground)">{t('about.version', version)}</div>}
            <div className="mt-1.5">
              {copyright && <span>{copyright.replace('(c)', '©')} · </span>}
              <button
                type="button"
                className="cursor-pointer text-(--vsc-textLink-foreground) hover:text-(--vsc-textLink-activeForeground) hover:underline"
                aria-expanded={showLicense}
                onClick={() => setShowLicense(!showLicense)}
              >
                {t('about.mitLicense')}
              </button>
              <span> · </span>
              <Link href={REPOSITORY}>GitHub</Link>
            </div>
            <div className="mt-1 text-(--vsc-descriptionForeground)">{t('about.notAffiliated')}</div>
          </div>
        </header>
        {showLicense && licenses && <LicenseText text={licenses.license} />}
        {error && <p className="mt-6 text-(--vsc-errorForeground)">{String(error)}</p>}
        {licenses && (
          <>
            <Section title={t('about.notices')}>
              <Notices text={licenses.notices} />
            </Section>
            <Section title={t('about.licenses')}>
              <Packages licenses={licenses} />
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

export const aboutLabel = () => t('panel.about')
