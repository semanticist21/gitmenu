// GitLens's Branches, Remotes, Tags, Stashes, Worktrees and Contributors views.
import { useQuery } from '@tanstack/react-query'
import { ArchiveIcon, CheckIcon, CloudIcon, FolderGit2Icon, GitBranchIcon, TagIcon } from 'lucide-react'
import { gl, useLocale } from '@/i18n'
import { type BranchInfo, type Contributor, git, type RefInfo, type StashInfo, type Upstream, type WorktreeInfo } from '@/lib/git'
import { errorMessage } from '@/lib/ipc'
import { relativeTime } from '@/lib/time'
import { Avatar } from '../avatars/Avatar'
import { pluralCommits } from '../history/CommitsView'
import { commitChildren, fileNode, messageNode, shortSha } from '../history/nodes'
import { providerFor, type RemoteSetting } from '../remote/providers'
import { useSetting } from '@/settings/settings'
import type { ViewProps } from '../views/registry'
import { asyncChildren, type TreeNode, ViewTree } from '../views/ViewTree'
import { folderize } from './folders'

/** What commands on a branch, remote branch or tag row receive. */
export interface RefArg {
  root: string
  ref: RefInfo | BranchInfo
}

export interface RemoteArg {
  root: string
  remote: string
  url: string | null
}

export interface StashArg {
  root: string
  stash: StashInfo
}

export interface WorktreeArg {
  root: string
  worktree: WorktreeInfo
}

export interface ContributorArg {
  root: string
  contributor: Contributor
}

function useRepoQuery<T>(root: string, name: string, fn: () => Promise<T>) {
  return useQuery({ queryKey: ['repo', root, name], queryFn: fn, staleTime: Infinity })
}

function trackingDescription(upstream: Upstream | null): string | undefined {
  if (!upstream) return undefined
  if (upstream.gone) return gl('{0} (missing)', upstream.name)
  const counts = [upstream.behind ? `${upstream.behind}↓` : '', upstream.ahead ? `${upstream.ahead}↑` : ''].filter(Boolean).join(' ')
  return counts ? `${counts}  ${upstream.name}` : upstream.name
}

function status(nodes: TreeNode[], query: { isPending: boolean; error: unknown }, empty: string, count: number) {
  if (query.error) return [messageNode('error', errorMessage(query.error))]
  if (!query.isPending && count === 0) return [messageNode('empty', empty)]
  return nodes
}

export function BranchesView({ repo }: ViewProps) {
  const locale = useLocale()
  const root = repo.root
  const query = useRepoQuery(root, 'branches', () => git.branches(root))
  const branches = [...(query.data ?? [])].sort((a, b) => Number(b.current) - Number(a.current) || (b.time ?? 0) - (a.time ?? 0))
  const leaf = (branch: BranchInfo, label: string): TreeNode => {
    const flags = [branch.current && '+current', branch.upstream && '+tracking', branch.upstream?.ahead && '+ahead', branch.upstream?.behind && '+behind'].filter(Boolean).join('')
    return {
      id: `branch:${branch.name}`,
      label: branch.current ? <span className="font-medium">{label}</span> : label,
      ariaLabel: label,
      description: trackingDescription(branch.upstream),
      icon: branch.current ? <CheckIcon /> : <GitBranchIcon className="text-muted-foreground" />,
      tooltip: [branch.short, branch.upstream && gl('Tracking {0}', branch.upstream.name), branch.subject].filter(Boolean).join('\n'),
      contextValue: `gitlens:branch${flags}`,
      arg: { root, ref: branch } satisfies RefArg,
      loadChildren: commitChildren(root, ['branch', branch.name], `branch:${branch.name}`, locale, (limit) => git.log(root, { revs: [branch.name], limit }), branch.current ? ['current'] : []),
    }
  }
  const nodes = status(folderize(branches, (b) => b.short, leaf, 'branches'), query, gl('No branches could be found.'), branches.length)
  return <ViewTree viewId="gitmenu.views.branches" nodes={nodes} label={gl('Branches')} />
}

export function RemotesView({ repo }: ViewProps) {
  const locale = useLocale()
  const root = repo.root
  const remotes = useRepoQuery(root, 'remotes', () => git.remotes(root))
  const refs = useRepoQuery(root, 'refs', () => git.refs(root))
  const settings = useSetting<RemoteSetting[] | null>('gitmenu.remotes') ?? []
  const nodes = (remotes.data ?? []).map((remote): TreeNode => {
    const provider = remote.fetchUrl ? providerFor(remote.fetchUrl, settings) : null
    const branches = (refs.data ?? []).filter((r) => r.kind === 'remote' && r.short.startsWith(`${remote.name}/`))
    const leaf = (ref: RefInfo, label: string): TreeNode => ({
      id: `remote-branch:${ref.name}`,
      label,
      description: ref.time ? relativeTime(ref.time, locale) : undefined,
      icon: <GitBranchIcon className="text-muted-foreground" />,
      tooltip: [ref.short, ref.subject].filter(Boolean).join('\n'),
      contextValue: 'gitlens:branch+remote',
      arg: { root, ref } satisfies RefArg,
      loadChildren: commitChildren(root, ['branch', ref.name], `remote-branch:${ref.name}`, locale, (limit) => git.log(root, { revs: [ref.name], limit })),
    })
    return {
      id: `remote:${remote.name}`,
      label: remote.name,
      description: provider ? `${provider.name} · ${provider.path}` : (remote.fetchUrl ?? undefined),
      icon: <CloudIcon className="text-muted-foreground" />,
      tooltip: [remote.fetchUrl, remote.pushUrl !== remote.fetchUrl ? remote.pushUrl : null].filter(Boolean).join('\n'),
      contextValue: `gitlens:remote${provider ? '+provider' : ''}`,
      arg: { root, remote: remote.name, url: remote.fetchUrl } satisfies RemoteArg,
      expanded: (remotes.data ?? []).length === 1,
      children: branches.length
        ? folderize(branches, (r) => r.short.slice(remote.name.length + 1), leaf, `remote:${remote.name}`)
        : [messageNode(`remote:${remote.name}/none`, gl('No branches could be found.'))],
    }
  })
  return <ViewTree viewId="gitmenu.views.remotes" nodes={status(nodes, remotes, gl('No remotes could be found.'), nodes.length)} label={gl('Remotes')} />
}

export function TagsView({ repo }: ViewProps) {
  const locale = useLocale()
  const root = repo.root
  const refs = useRepoQuery(root, 'refs', () => git.refs(root))
  const tags = (refs.data ?? []).filter((r) => r.kind === 'tag').sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
  const leaf = (tag: RefInfo, label: string): TreeNode => ({
    id: `tag:${tag.name}`,
    label,
    description: tag.time ? relativeTime(tag.time, locale) : undefined,
    icon: <TagIcon className="text-muted-foreground" />,
    tooltip: [tag.short, tag.commit && shortSha(tag.commit), tag.subject].filter(Boolean).join('\n'),
    contextValue: 'gitlens:tag',
    arg: { root, ref: tag } satisfies RefArg,
    loadChildren: commitChildren(root, ['tag', tag.name], `tag:${tag.name}`, locale, (limit) => git.log(root, { revs: [tag.name], limit })),
  })
  const nodes = status(folderize(tags, (t) => t.short, leaf, 'tags'), refs, gl('No tags could be found.'), tags.length)
  return <ViewTree viewId="gitmenu.views.tags" nodes={nodes} label={gl('Tags')} />
}

/** "On main: message" / "WIP on main: abc message" → the message, as GitLens shows it. */
export function stashLabel(message: string) {
  return message.replace(/^(?:WIP on|On) [^:]+:\s*/, '')
}

export function StashesView({ repo }: ViewProps) {
  const locale = useLocale()
  const root = repo.root
  const query = useRepoQuery(root, 'stashes', () => git.stashes(root))
  const stashes = query.data ?? []
  const nodes = stashes.map(
    (stash): TreeNode => ({
      id: `stash:${stash.commit}`,
      label: stashLabel(stash.message) || gl('(no message)'),
      description: `stash@{${stash.index}}, ${relativeTime(stash.time, locale)}`,
      icon: <ArchiveIcon className="text-muted-foreground" />,
      tooltip: stash.message,
      contextValue: 'gitlens:stash',
      arg: { root, stash } satisfies StashArg,
      loadChildren: asyncChildren({
        queryKey: ['repo', root, 'commit', stash.commit],
        queryFn: () => git.commitDetails(root, stash.commit),
        build: (details) =>
          details.files.map((f) => ({ ...fileNode(root, stash.commit, details.parents[0] ?? null, f, `stash:${stash.commit}`), contextValue: 'gitlens:file+stashed' })),
      }),
    }),
  )
  return <ViewTree viewId="gitmenu.views.stashes" nodes={status(nodes, query, gl('No stashes could be found.'), nodes.length)} label={gl('Stashes')} />
}

function tildePath(path: string) {
  const home = /^\/Users\/[^/]+/.exec(path)?.[0]
  return home ? `~${path.slice(home.length)}` : path
}

export function WorktreesView({ repo }: ViewProps) {
  const locale = useLocale()
  const root = repo.root
  const query = useRepoQuery(root, 'worktrees', () => git.worktrees(root))
  const nodes = (query.data ?? []).map((worktree): TreeNode => {
    const flags = [worktree.current && '+current', worktree.main && '+main', worktree.locked && '+locked', worktree.missing && '+missing'].filter(Boolean).join('')
    const label = worktree.branch ?? (worktree.commit ? gl('{0} (detached)', shortSha(worktree.commit)) : gl('(unknown)'))
    return {
      id: `worktree:${worktree.path}`,
      label: worktree.current ? <span className="font-medium">{label}</span> : label,
      ariaLabel: label,
      description: tildePath(worktree.path) + (worktree.missing ? ` · ${gl('missing')}` : worktree.locked ? ` · ${gl('locked')}` : ''),
      icon: worktree.current ? <CheckIcon /> : <FolderGit2Icon className="text-muted-foreground" />,
      tooltip: worktree.path,
      contextValue: `gitlens:worktree${flags}`,
      arg: { root, worktree } satisfies WorktreeArg,
      loadChildren: worktree.commit
        ? commitChildren(root, ['worktree', worktree.path, worktree.commit], `worktree:${worktree.path}`, locale, (limit) => git.log(root, { revs: [worktree.commit!], limit }))
        : undefined,
    }
  })
  return <ViewTree viewId="gitmenu.views.worktrees" nodes={status(nodes, query, gl('No worktrees could be found.'), nodes.length)} label={gl('Worktrees')} />
}

export function ContributorsView({ repo }: ViewProps) {
  const locale = useLocale()
  const root = repo.root
  const query = useRepoQuery(root, 'contributors', () => git.contributors(root))
  const nodes = (query.data ?? []).map(
    (contributor): TreeNode => ({
      id: `contributor:${contributor.email}`,
      label: contributor.name,
      description: pluralCommits(contributor.commits),
      icon: <Avatar root={root} name={contributor.name} email={contributor.email} sha={contributor.latest} />,
      tooltip: `${contributor.name} <${contributor.email}>\n${pluralCommits(contributor.commits)}, ${gl('last commit {0}', relativeTime(contributor.latestTime, locale))}`,
      contextValue: 'gitlens:contributor',
      arg: { root, contributor } satisfies ContributorArg,
      loadChildren: commitChildren(root, ['author', contributor.email], `contributor:${contributor.email}`, locale, (limit) =>
        git.log(root, { search: { author: [contributor.email] }, limit }),
      ),
    }),
  )
  return <ViewTree viewId="gitmenu.views.contributors" nodes={status(nodes, query, gl('No contributors could be found.'), nodes.length)} label={gl('Contributors')} />
}
