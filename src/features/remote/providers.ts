// Web URLs for remotes on hosting services, like GitLens's remote providers. Well-known hosts
// are recognized by domain; self-hosted ones come from the `gitside.remotes` setting (the
// shape of GitLens's `gitlens.remotes`). Nothing is detected by calling the host's API.

export type ProviderType = 'GitHub' | 'GitLab' | 'Gitea' | 'Bitbucket' | 'BitbucketServer' | 'AzureDevOps' | 'Custom'

/** One entry of the `gitside.remotes` setting. */
export interface RemoteSetting {
  domain?: string
  regex?: string
  type: ProviderType
  name?: string
  protocol?: string
  /** Custom only: URL templates with `${repo}`, `${id}`, `${branch}`, `${file}`, `${line}`, `${start}`, `${end}` */
  urls?: Partial<Record<'repository' | 'branch' | 'branches' | 'commit' | 'file' | 'fileInBranch' | 'fileInCommit' | 'fileLine' | 'fileRange' | 'comparison', string>>
}

export interface Provider {
  type: ProviderType
  /** Display name: "GitHub", "GitLab", … or the setting's `name` */
  name: string
  domain: string
  /** `owner/repo` (or `org/project/_git/repo` for Azure DevOps) */
  path: string
  repository(): string
  branch(branch: string): string
  branches(): string
  commit(sha: string): string
  /** A file at a branch or commit, optionally at a line range (1-based, inclusive) */
  file(path: string, rev: { branch?: string; sha?: string }, lines?: { start: number; end: number }): string
  comparison(base: string, head: string): string
}

const KNOWN: [RegExp, ProviderType, string][] = [
  [/^github\.com$/i, 'GitHub', 'GitHub'],
  [/^gitlab\.com$/i, 'GitLab', 'GitLab'],
  [/^bitbucket\.org$/i, 'Bitbucket', 'Bitbucket'],
  [/^(ssh\.)?dev\.azure\.com$|\.visualstudio\.com$/i, 'AzureDevOps', 'Azure DevOps'],
  [/^codeberg\.org$/i, 'Gitea', 'Codeberg'],
  [/^gitea\.com$/i, 'Gitea', 'Gitea'],
]

/** `{ domain, path }` of a remote URL (https, ssh, git, or scp-like `git@host:path`). */
export function parseRemoteUrl(url: string): { domain: string; path: string } | null {
  const trimmed = url.trim()
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(trimmed)
  if (scp && !/^[a-z][a-z+.-]*:\/\//i.test(trimmed)) return { domain: scp[1].toLowerCase(), path: cleanPath(scp[2]) }
  const match = /^[a-z][a-z+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(trimmed)
  if (!match) return null
  return { domain: match[1].toLowerCase(), path: cleanPath(match[2]) }
}

function cleanPath(path: string) {
  return path.replace(/\/+$/, '').replace(/\.git$/, '').replace(/^\/+/, '')
}

const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/')

function fill(template: string, values: Record<string, string>) {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) => values[key] ?? '')
}

function build(type: ProviderType, name: string, domain: string, path: string, setting?: RemoteSetting): Provider {
  const protocol = setting?.protocol ?? 'https'
  let base = `${protocol}://${domain}/${path}`
  const rev = (r: { branch?: string; sha?: string }) => r.sha ?? r.branch ?? 'HEAD'

  switch (type) {
    case 'GitLab':
      return {
        type, name, domain, path,
        repository: () => base,
        branch: (b) => `${base}/-/tree/${enc(b)}`,
        branches: () => `${base}/-/branches`,
        commit: (sha) => `${base}/-/commit/${sha}`,
        file: (p, r, l) => `${base}/-/blob/${enc(rev(r))}/${enc(p)}${l ? `#L${l.start}${l.end !== l.start ? `-${l.end}` : ''}` : ''}`,
        comparison: (a, b) => `${base}/-/compare/${enc(a)}...${enc(b)}`,
      }
    case 'Gitea':
      return {
        type, name, domain, path,
        repository: () => base,
        branch: (b) => `${base}/src/branch/${enc(b)}`,
        branches: () => `${base}/branches`,
        commit: (sha) => `${base}/commit/${sha}`,
        file: (p, r, l) =>
          `${base}/src/${r.sha ? `commit/${r.sha}` : `branch/${enc(r.branch ?? 'HEAD')}`}/${enc(p)}${l ? `#L${l.start}${l.end !== l.start ? `-L${l.end}` : ''}` : ''}`,
        comparison: (a, b) => `${base}/compare/${enc(a)}...${enc(b)}`,
      }
    case 'Bitbucket':
      return {
        type, name, domain, path,
        repository: () => base,
        branch: (b) => `${base}/branch/${enc(b)}`,
        branches: () => `${base}/branches`,
        commit: (sha) => `${base}/commits/${sha}`,
        file: (p, r, l) => `${base}/src/${enc(rev(r))}/${enc(p)}${l ? `#lines-${l.start}${l.end !== l.start ? `:${l.end}` : ''}` : ''}`,
        comparison: (a, b) => `${base}/branches/compare/${enc(b)}%0D${enc(a)}`,
      }
    case 'BitbucketServer': {
      // Clone URLs look like `scm/PROJECT/repo`; pages live under `projects/PROJECT/repos/repo`
      const [project, repo] = path.replace(/^scm\//, '').split('/')
      base = `${protocol}://${domain}/projects/${project}/repos/${repo}`
      return {
        type, name, domain, path,
        repository: () => base,
        branch: (b) => `${base}/commits?until=${encodeURIComponent(b)}`,
        branches: () => `${base}/branches`,
        commit: (sha) => `${base}/commits/${sha}`,
        file: (p, r, l) => `${base}/browse/${enc(p)}?at=${encodeURIComponent(rev(r))}${l ? `#${l.start}${l.end !== l.start ? `-${l.end}` : ''}` : ''}`,
        comparison: (a, b) => `${base}/branches?base=${encodeURIComponent(a)}&compare=${encodeURIComponent(b)}`,
      }
    }
    case 'AzureDevOps': {
      // ssh: `v3/org/project/repo`; https: `org/project/_git/repo` (or `project/_git/repo` on visualstudio.com)
      let web = path
      let host = domain
      if (domain === 'ssh.dev.azure.com') {
        const [, org, project, repo] = path.split('/')
        host = 'dev.azure.com'
        web = `${org}/${project}/_git/${repo}`
      } else if (domain.endsWith('.vs-ssh.visualstudio.com')) {
        const [, , project, repo] = path.split('/')
        host = domain.replace('.vs-ssh.', '.')
        web = `${project}/_git/${repo}`
      }
      base = `${protocol}://${host}/${web}`
      const version = (r: { branch?: string; sha?: string }) => (r.sha ? `GC${r.sha}` : `GB${encodeURIComponent(r.branch ?? 'HEAD')}`)
      return {
        type, name, domain: host, path: web,
        repository: () => base,
        branch: (b) => `${base}?version=GB${encodeURIComponent(b)}`,
        branches: () => `${base}/branches`,
        commit: (sha) => `${base}/commit/${sha}`,
        file: (p, r, l) =>
          `${base}?path=${encodeURIComponent(`/${p}`)}&version=${version(r)}${l ? `&line=${l.start}&lineEnd=${l.end}&lineStartColumn=1&lineEndColumn=1&lineStyle=plain&_a=contents` : ''}`,
        comparison: (a, b) => `${base}/branchCompare?baseVersion=GB${encodeURIComponent(a)}&targetVersion=GB${encodeURIComponent(b)}&_a=files`,
      }
    }
    case 'Custom': {
      const urls = setting?.urls ?? {}
      const values = (extra: Record<string, string> = {}) => ({ repo: path, ...extra })
      return {
        type, name, domain, path,
        repository: () => fill(urls.repository ?? '', values()),
        branch: (b) => fill(urls.branch ?? '', values({ branch: b })),
        branches: () => fill(urls.branches ?? '', values()),
        commit: (sha) => fill(urls.commit ?? '', values({ id: sha })),
        file: (p, r, l) => {
          const line = l ? fill(l.start === l.end ? (urls.fileLine ?? '') : (urls.fileRange ?? ''), { line: String(l.start), start: String(l.start), end: String(l.end) }) : ''
          const template = r.sha ? urls.fileInCommit : r.branch ? urls.fileInBranch : urls.file
          return fill(template ?? urls.file ?? '', values({ file: p, id: r.sha ?? '', branch: r.branch ?? '', line }))
        },
        comparison: (a, b) => fill(urls.comparison ?? '', values({ ref1: a, ref2: b })),
      }
    }
    default:
      return {
        type, name, domain, path,
        repository: () => base,
        branch: (b) => `${base}/tree/${enc(b)}`,
        branches: () => `${base}/branches`,
        commit: (sha) => `${base}/commit/${sha}`,
        file: (p, r, l) => `${base}/blob/${enc(rev(r))}/${enc(p)}${l ? `#L${l.start}${l.end !== l.start ? `-L${l.end}` : ''}` : ''}`,
        comparison: (a, b) => `${base}/compare/${enc(a)}...${enc(b)}`,
      }
  }
}

/** The provider for a remote URL, or `null` for hosts we don't know. */
export function providerFor(url: string, settings: RemoteSetting[] = []): Provider | null {
  const parsed = parseRemoteUrl(url)
  if (!parsed) return null
  for (const setting of settings) {
    const matches = setting.regex
      ? new RegExp(setting.regex, 'i').test(url)
      : setting.domain?.toLowerCase() === parsed.domain
    if (matches) return build(setting.type, setting.name ?? setting.type, parsed.domain, parsed.path, setting)
  }
  for (const [re, type, name] of KNOWN) {
    if (re.test(parsed.domain)) return build(type, name, parsed.domain, parsed.path)
  }
  return null
}
