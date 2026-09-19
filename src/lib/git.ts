// Typed wrappers over src-tauri/src/git.rs.
import { invoke } from '@tauri-apps/api/core'

export type StatusCode =
  | 'indexModified'
  | 'indexAdded'
  | 'indexDeleted'
  | 'indexRenamed'
  | 'indexCopied'
  | 'modified'
  | 'deleted'
  | 'untracked'
  | 'intentToAdd'
  | 'typeChanged'
  | 'addedByUs'
  | 'addedByThem'
  | 'deletedByUs'
  | 'deletedByThem'
  | 'bothAdded'
  | 'bothDeleted'
  | 'bothModified'

export interface FileChange {
  path: string
  originalPath: string | null
  status: StatusCode
  submodule: boolean
}

export interface Upstream {
  name: string
  remote: string
  ahead: number
  behind: number
  /** The tracking branch doesn't exist (never fetched, or deleted on the remote) */
  gone: boolean
}

export interface RepoStatus {
  head: { branch: string | null; commit: string | null; detached: boolean }
  upstream: Upstream | null
  operation: 'merge' | 'rebase' | 'cherryPick' | 'revert' | 'bisect' | 'applyMailbox' | null
  merge: FileChange[]
  index: FileChange[]
  workingTree: FileChange[]
  untracked: FileChange[]
  remotes: string[]
  fetchedAt: number | null
}

export interface RefInfo {
  name: string
  short: string
  kind: 'branch' | 'remote' | 'tag'
  commit: string | null
  time: number | null
  subject: string | null
}

export interface StashInfo {
  index: number
  commit: string
  message: string
  time: number
}

export type OpKind = 'commit' | 'push' | 'pull' | 'fetch' | 'sync' | 'checkout' | 'stage' | 'other'

export interface GitOutput {
  stdout: string
  stderr: string
}

export interface CommitOptions {
  amend?: boolean
  signoff?: boolean
  noVerify?: boolean
  allowEmpty?: boolean
  /** git opens its editor (our prompt dialog) for the message */
  edit?: boolean
  /** amend keeping the current message */
  noEdit?: boolean
}

export type Side = { kind: 'empty' } | { kind: 'head' } | { kind: 'index' } | { kind: 'worktree' } | { kind: 'commit'; rev: string }

export interface SideContent {
  exists: boolean
  size: number
  text: string | null
  dataUrl: string | null
}

export interface DiffResult {
  kind: 'text' | 'binary' | 'image' | 'tooLarge'
  left: SideContent
  right: SideContent
  hunks: { leftStart: number; leftCount: number; rightStart: number; rightCount: number }[]
}

export interface BlameResult {
  ranges: { start: number; len: number; commit: string | null }[]
  commits: Record<string, { id: string; author: string; email: string; time: number; summary: string }>
}

export interface Person {
  name: string
  email: string
  time: number
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typeChanged'

export interface CommitInfo {
  id: string
  parents: string[]
  author: Person
  committer: Person
  subject: string
  /** File history: the file's path in this commit */
  path: string | null
  status: FileStatus | null
  /** File history: the path before this commit renamed the file */
  originalPath: string | null
}

export interface LogPage {
  commits: CommitInfo[]
  more: boolean
}

export interface Search {
  message?: string[]
  author?: string[]
  commit?: string[]
  file?: string[]
  changes?: string[]
  matchCase?: boolean
}

export interface LogQuery {
  revs?: string[]
  hide?: string[]
  path?: string | null
  search?: Search | null
  skip?: number
  limit: number
}

export interface CommitFile {
  path: string
  originalPath: string | null
  status: FileStatus
}

export interface CommitDetails extends CommitInfo {
  message: string
  files: CommitFile[]
}

export interface Comparison {
  base: string
  head: string
  mergeBase: string | null
  ahead: number
  behind: number
  files: CommitFile[]
}

export interface RemoteInfo {
  name: string
  fetchUrl: string | null
  pushUrl: string | null
}

export interface BranchInfo extends RefInfo {
  current: boolean
  upstream: Upstream | null
}

export interface WorktreeInfo {
  path: string
  branch: string | null
  commit: string | null
  main: boolean
  current: boolean
  locked: boolean
  missing: boolean
}

export interface Contributor {
  name: string
  email: string
  commits: number
  latest: string
  latestTime: number
}

export interface GraphQuery {
  scope: 'all' | 'current'
  remotes: boolean
  tags: boolean
  stashes: boolean
  skip: number
  limit: number
}

export interface GraphRef {
  name: string
  kind: 'head' | 'branch' | 'remote' | 'tag' | 'stash'
}

export interface GraphRow extends CommitInfo {
  lane: number
  into: number[]
  out: number[]
  pass: number[]
  continues: boolean
  refs: GraphRef[]
  stash: boolean
  current: boolean
}

export interface GraphPage {
  rows: GraphRow[]
  more: boolean
  total: number
  lanes: number
}

export const git = {
  graph: (root: string, query: GraphQuery) => invoke<GraphPage>('repo_graph', { root, query }),
  branches: (root: string) => invoke<BranchInfo[]>('repo_branches', { root }),
  worktrees: (root: string) => invoke<WorktreeInfo[]>('repo_worktrees', { root }),
  contributors: (root: string) => invoke<Contributor[]>('repo_contributors', { root }),
  log: (root: string, query: LogQuery) => invoke<LogPage>('repo_log', { root, query: { skip: 0, ...query } }),
  lineHistory: (root: string, path: string, start: number, end: number, rev: string | null, skip: number, limit: number) =>
    invoke<LogPage>('repo_line_history', { root, path, start, end, rev, skip, limit }),
  commitDetails: (root: string, rev: string) => invoke<CommitDetails>('repo_commit', { root, rev }),
  compare: (root: string, base: string, head: string) => invoke<Comparison>('repo_compare', { root, base, head }),
  remotes: (root: string) => invoke<RemoteInfo[]>('repo_remotes', { root }),
  avatars: (root: string, requests: { email: string; sha: string | null }[]) =>
    invoke<Record<string, string>>('avatars_resolve', { root, requests }),
  diff: (root: string, path: string, originalPath: string | null, left: Side, right: Side, maxBytes: number, ignoreTrimWhitespace: boolean) =>
    invoke<DiffResult>('repo_diff', { root, path, originalPath, left, right, maxBytes, ignoreTrimWhitespace }),
  file: (root: string, path: string, side: Side, maxBytes: number) => invoke<DiffResult>('repo_file', { root, path, side, maxBytes }),
  blame: (root: string, path: string, rev: string, worktree: boolean) =>
    invoke<BlameResult>('repo_blame', { root, path, rev, worktree }),
  status: (root: string) => invoke<RepoStatus>('repo_status', { root }),
  headMessage: (root: string) => invoke<string | null>('repo_head_message', { root }),
  refs: (root: string) => invoke<RefInfo[]>('repo_refs', { root }),
  stashes: (root: string) => invoke<StashInfo[]>('repo_stashes', { root }),
  config: (root: string, key: string) => invoke<string | null>('repo_config', { root, key }),
  stage: (root: string, paths: string[], label: string) => invoke<GitOutput>('git_stage', { root, paths, label }),
  unstage: (root: string, paths: string[], label: string) => invoke<GitOutput>('git_unstage', { root, paths, label }),
  discard: (root: string, tracked: string[], untracked: string[], label: string) =>
    invoke<{ recovery: string | null; trashed: string[] }>('git_discard', { root, tracked, untracked, label }),
  recoveryPoint: (root: string, label: string) => invoke<string | null>('git_recovery_point', { root, label }),
  /** Text of a file inside the repository (refused outside it) */
  readTextFile: (root: string, path: string, maxBytes: number) => invoke<string>('read_text_file', { root, path, maxBytes }),
  commit: (root: string, message: string, options: CommitOptions, label: string) =>
    invoke<GitOutput>('git_commit', { root, message, options, label }),
  apply: (root: string, patch: string, cached: boolean, reverse: boolean, label: string) =>
    invoke<GitOutput>('git_apply', { root, patch, cached, reverse, label }),
  exec: (root: string, kind: OpKind, label: string, args: string[]) =>
    invoke<GitOutput>('git_exec', { root, kind, label, args }),
  trash: (paths: string[]) => invoke<void>('trash_paths', { paths }),
  ignore: (root: string, paths: string[]) => invoke<void>('git_ignore', { root, paths }),
  clone: (parent: string, url: string, label: string) => invoke<string>('git_clone', { parent, url, label }),
}
