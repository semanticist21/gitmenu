// Panel views: VS Code's Source Control plus the GitLens views, shown as collapsible
// sections. Only Source Control and Commits are visible until the user turns more on.
import type { AppKey } from '@/i18n/app/en'

export interface ViewDescriptor {
  id: string
  title: AppKey
}

export const VIEWS: ViewDescriptor[] = [
  { id: 'scm', title: 'view.sourceControl' },
  { id: 'commits', title: 'view.commits' },
  { id: 'fileHistory', title: 'view.fileHistory' },
  { id: 'lineHistory', title: 'view.lineHistory' },
  { id: 'searchCompare', title: 'view.searchCompare' },
  { id: 'stashes', title: 'view.stashes' },
  { id: 'branches', title: 'view.branches' },
  { id: 'remotes', title: 'view.remotes' },
  { id: 'tags', title: 'view.tags' },
  { id: 'worktrees', title: 'view.worktrees' },
  { id: 'contributors', title: 'view.contributors' },
]

export interface ViewLayout {
  visible: string[]
  collapsed: string[]
  /** Relative sizes of expanded views, by id */
  weights: Record<string, number>
}

export const DEFAULT_LAYOUT: ViewLayout = {
  visible: ['scm', 'commits'],
  collapsed: [],
  weights: { scm: 3, commits: 2 },
}
