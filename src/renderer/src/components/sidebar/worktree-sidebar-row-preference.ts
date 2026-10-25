import {
  folderWorkspaceToWorktree,
  getFolderWorkspaceHostIdentity
} from '../../../../shared/folder-workspace-worktree'
import type { Worktree } from '../../../../shared/worktree/types'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import type { HostSectionRow } from '../../../../shared/sidebar-list/host-section-rows'
import { PINNED_GROUP_KEY } from '../../../../shared/sidebar-list/group-keys'
import type {
  FolderWorkspaceRow,
  PinnedWorktreeDisplayPolicy,
  WorktreeRow
} from '../../../../shared/sidebar-list/row-types'

// Navigation/selection treat pinned duplicates as one workspace, preferring a visible natural-group occurrence.
function getPreferredRows<TRow>(
  rows: readonly TRow[],
  getIdentity: (row: TRow) => string,
  isPinnedSectionRow: (row: TRow) => boolean
): TRow[] {
  const preferredRows: TRow[] = []
  const seen = new Set<string>()
  const take = (row: TRow): void => {
    preferredRows.push(row)
    seen.add(getIdentity(row))
  }
  for (const row of rows) {
    if (!isPinnedSectionRow(row) && !seen.has(getIdentity(row))) {
      take(row)
    }
  }
  for (const row of rows) {
    if (!seen.has(getIdentity(row))) {
      take(row)
    }
  }
  return preferredRows
}

export function getPreferredWorktreeRows(
  rows: readonly WorktreeRow[],
  pinnedDisplayPolicy: PinnedWorktreeDisplayPolicy
): WorktreeRow[] {
  return getPreferredRows(
    rows,
    (row) => getWorktreeHostIdentity(row.worktree),
    (row) => pinnedDisplayPolicy === 'duplicate-in-groups' && row.sectionKey === PINNED_GROUP_KEY
  )
}

export type RenderedWorkspaceRow = Pick<WorktreeRow, 'worktree' | 'repo'>

export function getRenderedWorkspaceRowsInSidebarOrder(
  rows: readonly HostSectionRow[],
  pinnedDisplayPolicy: PinnedWorktreeDisplayPolicy
): RenderedWorkspaceRow[] {
  const preferredWorktreeRowKeys = new Set(
    getPreferredWorktreeRows(
      rows.filter((row): row is WorktreeRow => row.type === 'item'),
      pinnedDisplayPolicy
    ).map((row) => row.rowKey)
  )
  const preferredFolderRowKeys = new Set(
    getPreferredRows(
      rows.filter((row): row is FolderWorkspaceRow => row.type === 'folder-workspace'),
      (row) => getFolderWorkspaceHostIdentity(row.folderWorkspace),
      (row) => pinnedDisplayPolicy === 'duplicate-in-groups' && row.sectionKey === PINNED_GROUP_KEY
    ).map((row) => row.key)
  )

  const renderedRows: RenderedWorkspaceRow[] = []
  for (const row of rows) {
    if (row.type === 'item' && preferredWorktreeRowKeys.has(row.rowKey)) {
      renderedRows.push({ worktree: row.worktree, repo: row.repo })
    } else if (row.type === 'folder-workspace' && preferredFolderRowKeys.has(row.key)) {
      renderedRows.push({
        worktree: folderWorkspaceToWorktree(row.folderWorkspace),
        repo: undefined
      })
    }
  }
  return renderedRows
}

export function getRenderedWorktreesInSidebarOrder(
  rows: readonly HostSectionRow[],
  pinnedDisplayPolicy: PinnedWorktreeDisplayPolicy
): Worktree[] {
  return getRenderedWorkspaceRowsInSidebarOrder(rows, pinnedDisplayPolicy).map(
    (row) => row.worktree
  )
}
