// VS Code's resource decorations: letter, color and tooltip per status.
import { vsb } from '@/i18n'
import type { StatusCode } from '@/lib/git'

export const LETTER: Record<StatusCode, string> = {
  indexModified: 'M',
  modified: 'M',
  indexAdded: 'A',
  intentToAdd: 'A',
  indexDeleted: 'D',
  deleted: 'D',
  indexRenamed: 'R',
  indexCopied: 'C',
  typeChanged: 'T',
  untracked: 'U',
  addedByUs: '!',
  addedByThem: '!',
  deletedByUs: '!',
  deletedByThem: '!',
  bothAdded: '!',
  bothDeleted: '!',
  bothModified: '!',
}

const TOOLTIP: Record<StatusCode, string> = {
  indexModified: 'Index Modified',
  modified: 'Modified',
  indexAdded: 'Index Added',
  intentToAdd: 'Intent to Add',
  indexDeleted: 'Index Deleted',
  deleted: 'Deleted',
  indexRenamed: 'Index Renamed',
  indexCopied: 'Index Copied',
  typeChanged: 'Type Changed',
  untracked: 'Untracked',
  addedByUs: 'Conflict: Added By Us',
  addedByThem: 'Conflict: Added By Them',
  deletedByUs: 'Conflict: Deleted By Us',
  deletedByThem: 'Conflict: Deleted By Them',
  bothAdded: 'Conflict: Both Added',
  bothDeleted: 'Conflict: Both Deleted',
  bothModified: 'Conflict: Both Modified',
}

export function statusText(status: StatusCode): string {
  return vsb(TOOLTIP[status])
}

/** CSS color variable (defined in index.css for light and dark). */
export function statusColor(status: StatusCode): string {
  switch (LETTER[status]) {
    case 'M':
    case 'T':
      return 'var(--git-modified)'
    case 'A':
      return 'var(--git-added)'
    case 'D':
      return 'var(--git-deleted)'
    case 'U':
    case 'R':
    case 'C':
      return 'var(--git-untracked)'
    default:
      return 'var(--git-conflict)'
  }
}

export function isDeletion(status: StatusCode): boolean {
  return status === 'deleted' || status === 'indexDeleted' || status === 'bothDeleted' || status === 'deletedByUs'
}
