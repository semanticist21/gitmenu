// Tree nodes shared by the GitLens history views: commits (expanding to their files),
// files in a commit, and "Load more".
import { ArrowUpIcon } from 'lucide-react'
import { gl } from '@/i18n'
import { type CommitFile, type CommitInfo, type FileStatus, git, type LogPage } from '@/lib/git'
import { ipc } from '@/lib/ipc'
import { fullDate, relativeTime } from '@/lib/time'
import { Avatar } from '../avatars/Avatar'
import { asyncChildren, type TreeNode } from '../views/ViewTree'

/** What commands run from a commit row receive. */
export interface CommitArg {
  root: string
  commit: CommitInfo
}

/** What commands run from a file row receive. */
export interface FileArg {
  root: string
  sha: string
  /** The commit's first parent; `null` for a root commit */
  parent: string | null
  file: CommitFile
}

export const shortSha = (sha: string) => sha.slice(0, 7)

const LETTER: Record<FileStatus, string> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R', copied: 'C', typeChanged: 'T' }
const COLOR: Record<FileStatus, string> = {
  added: 'var(--git-added)',
  modified: 'var(--git-modified)',
  deleted: 'var(--git-deleted)',
  renamed: 'var(--git-untracked)',
  copied: 'var(--git-added)',
  typeChanged: 'var(--git-modified)',
}

export function statusLabel(status: FileStatus) {
  return gl({ added: 'Added', modified: 'Modified', deleted: 'Deleted', renamed: 'Renamed', copied: 'Copied', typeChanged: 'Type Changed' }[status])
}

export function StatusLetter({ status }: { status: FileStatus }) {
  return (
    <span className="w-3 shrink-0 text-center font-mono text-[11px] font-semibold" style={{ color: COLOR[status] }}>
      {LETTER[status]}
    </span>
  )
}

export function commitTooltip(commit: CommitInfo, locale: string) {
  return `${commit.author.name} <${commit.author.email}>, ${relativeTime(commit.author.time, locale)} (${fullDate(commit.author.time, locale)})\n\n${shortSha(commit.id)}  ${commit.subject}`
}

/** Opens one file's change in a commit in the detail window. */
export function openFileChange({ root, sha, parent, file }: FileArg) {
  const params = new URLSearchParams({ repo: root, path: file.path })
  if (file.originalPath) params.set('original', file.originalPath)
  params.set('left', file.status === 'added' || !parent ? 'empty' : `commit:${parent}`)
  params.set('right', file.status === 'deleted' ? 'empty' : `commit:${sha}`)
  void ipc.detailOpen(`/detail/diff?${params}`)
}

export function fileNode(root: string, sha: string, parent: string | null, file: CommitFile, idPrefix: string): TreeNode {
  const i = file.path.lastIndexOf('/')
  const name = i === -1 ? file.path : file.path.slice(i + 1)
  const dir = i === -1 ? '' : file.path.slice(0, i)
  const arg: FileArg = { root, sha, parent, file }
  return {
    id: `${idPrefix}/${file.path}`,
    label: <span style={{ color: COLOR[file.status] }} className={file.status === 'deleted' ? 'line-through opacity-70' : undefined}>{name}</span>,
    ariaLabel: `${name}, ${statusLabel(file.status)}`,
    description: file.originalPath ? `${file.originalPath} → ${dir}` : dir,
    tooltip: `${file.originalPath ? `${file.originalPath} → ` : ''}${file.path} • ${statusLabel(file.status)}`,
    contextValue: 'gitlens:file+committed',
    arg,
    decoration: <StatusLetter status={file.status} />,
    open: () => openFileChange(arg),
  }
}

interface CommitNodeOptions {
  idPrefix: string
  locale: string
  /** File history: open the file's change on click instead of expanding */
  file?: boolean
  /** Extra `+flags` on `viewItem` (GitLens: `+current`, `+unpublished`) */
  flags?: string[]
}

export function commitNode(root: string, commit: CommitInfo, options: CommitNodeOptions): TreeNode {
  const arg: CommitArg = { root, commit }
  const node: TreeNode = {
    id: `${options.idPrefix}/${commit.id}`,
    label: commit.subject.trim() || gl('(no message)'),
    description: `${commit.author.name}, ${relativeTime(commit.author.time, options.locale)}`,
    icon: options.flags?.includes('unpublished') ? (
      <ArrowUpIcon className="text-[var(--git-added)]" />
    ) : (
      <Avatar root={root} name={commit.author.name} email={commit.author.email} sha={commit.id} />
    ),
    tooltip: commitTooltip(commit, options.locale),
    contextValue: ['gitlens:commit', ...(options.flags ?? []).map((f) => `+${f}`)].join(''),
    arg,
  }
  if (options.file && commit.path && commit.status) {
    const fileArg: FileArg = {
      root,
      sha: commit.id,
      parent: commit.parents[0] ?? null,
      file: { path: commit.path, originalPath: commit.originalPath, status: commit.status },
    }
    node.open = () => openFileChange(fileArg)
    node.decoration = <StatusLetter status={commit.status} />
    return node
  }
  node.loadChildren = asyncChildren({
    queryKey: ['repo', root, 'commit', commit.id],
    queryFn: () => git.commitDetails(root, commit.id),
    build: (details) => details.files.map((f) => fileNode(root, commit.id, commit.parents[0] ?? null, f, node.id)),
  })
  return node
}

/** Paged commit children (a branch's, tag's or author's history). */
export function commitChildren(root: string, key: unknown[], idPrefix: string, locale: string, fetch: (limit: number) => Promise<LogPage>, flags?: string[]) {
  return asyncChildren<LogPage>({
    queryKey: ['repo', root, 'log', ...key],
    queryFn: fetch,
    build: (page) =>
      page.commits.length === 0 ? [messageNode(`${idPrefix}/none`, gl('No commits could be found.'))] : page.commits.map((c) => commitNode(root, c, { idPrefix, locale, flags })),
    more: (page) => page.more,
  })
}

export function messageNode(id: string, text: string): TreeNode {
  return { id, label: text, message: true }
}
