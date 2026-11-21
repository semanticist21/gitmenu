// What File History and Line History show. The detail window announces the file and lines
// the user is looking at through Tauri events; the panel keeps the latest target per view.
import { useState } from 'react'
import type { Side } from '@/lib/git'
import { useTauriEvent } from '@/lib/ipc'
import { useUiState } from '@/lib/uiState'
import { useSetting } from '@/settings/settings'

export interface FileTarget {
  root: string
  path: string
}

export interface LineTarget extends FileTarget {
  /** 1-based, inclusive */
  ranges: { start: number; end: number }[]
  side: Side
  originalPath?: string
}

/** Sent by the detail window when its active tab shows a file. */
export const ACTIVE_FILE_EVENT = 'fileHistory://active'
/** Sent by the detail window when lines are selected. */
export const LINE_SELECT_EVENT = 'lineHistory://select'

export function useFileHistoryTarget() {
  const [target, setTarget] = useUiState<FileTarget | null>('fileHistory.target', null)
  const follow = useSetting<boolean>('gitmenu.views.fileHistory.followActiveFile')
  const [pinned, setPinned] = useUiState<boolean>('fileHistory.pinned', false)
  useTauriEvent<FileTarget>(ACTIVE_FILE_EVENT, (next) => {
    if (follow && !pinned && (next.root !== target?.root || next.path !== target?.path)) setTarget(next)
  })
  return { target, setTarget, pinned, setPinned }
}

export function useLineHistoryTarget() {
  const [target, setTarget] = useState<LineTarget | null>(null)
  useTauriEvent<LineTarget | null>(LINE_SELECT_EVENT, setTarget)
  return target
}
