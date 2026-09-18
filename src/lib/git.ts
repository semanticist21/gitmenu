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
  | 'intentToRename'
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

export interface RepoStatus {
  head: { branch: string | null; commit: string | null; detached: boolean }
  upstream: { name: string; remote: string; ahead: number; behind: number } | null
  operation: 'merge' | 'rebase' | 'cherryPick' | 'revert' | 'bisect' | 'applyMailbox' | null
  merge: FileChange[]
  index: FileChange[]
  workingTree: FileChange[]
  untracked: FileChange[]
  remotes: string[]
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
  all?: boolean
  amend?: boolean
  signoff?: boolean
  noVerify?: boolean
  allowEmpty?: boolean
  /** git opens its editor (our prompt dialog) for the message */
  edit?: boolean
  /** amend keeping the current message */
  noEdit?: boolean
}

export const git = {
  status: (root: string) => invoke<RepoStatus>('repo_status', { root }),
  headMessage: (root: string) => invoke<string | null>('repo_head_message', { root }),
  refs: (root: string) => invoke<RefInfo[]>('repo_refs', { root }),
  stashes: (root: string) => invoke<StashInfo[]>('repo_stashes', { root }),
  config: (root: string, key: string) => invoke<string | null>('repo_config', { root, key }),
  stage: (root: string, paths: string[], label: string) => invoke<GitOutput>('git_stage', { root, paths, label }),
  unstage: (root: string, paths: string[], label: string) => invoke<GitOutput>('git_unstage', { root, paths, label }),
  discard: (root: string, tracked: string[], untracked: string[], label: string) =>
    invoke<{ recovery: string | null; trashed: string[] }>('git_discard', { root, tracked, untracked, label }),
  recoveryPoint: (root: string) => invoke<string | null>('git_recovery_point', { root }),
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
