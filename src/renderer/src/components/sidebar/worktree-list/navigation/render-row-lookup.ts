import { folderWorkspaceKey } from '../../../../../../shared/workspace-scope'
import {
  folderWorkspaceToWorktree,
  getFolderWorkspaceHostIdentity
} from '../../../../../../shared/folder-workspace-worktree'
import { getWorktreeExecutionHostId } from '../../../../../../shared/execution-host'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import type { Worktree } from '../../../../../../shared/worktree/types'
import {
  composeWorktreeHostIdentity,
  getWorktreeHostIdentity
} from '../../../../../../shared/worktree/host-qualified-identity'
import type { RenderRow } from '../listing/render-row'
import { PINNED_GROUP_KEY } from '../../../../../../shared/sidebar-list/group-keys'
import type { PinnedWorktreeDisplayPolicy } from '../../../../../../shared/sidebar-list/row-types'
import { isPinnedWorktreeRow, type WorktreeItemRow } from '../listing/renderable-rows'

export function getRenderRowSidebarKey(row: RenderRow): string | null {
  if (row.type === 'header') {
    return row.key
  }
  if (row.type === 'item') {
    return row.rowKey
  }
  if (row.type === 'folder-workspace') {
    return row.key
  }
  if (row.type === 'pending-creation') {
    return `pending:${row.creationId}`
  }
  if (row.type === 'imported-worktrees-card') {
    return row.key
  }
  if (row.type === 'new-external-worktrees-inbox') {
    return row.key
  }
  return null
}

export function rowKeyMatchesRenderRow(row: RenderRow, rowKey: string): boolean {
  if (row.type === 'lineage-group') {
    return row.rows.some((item) => item.rowKey === rowKey)
  }
  if (
    row.type === 'folder-workspace' &&
    (rowKey === folderWorkspaceKey(row.folderWorkspace.id) ||
      rowKey === getFolderWorkspaceHostIdentity(row.folderWorkspace))
  ) {
    return true
  }
  return getRenderRowSidebarKey(row) === rowKey
}

function itemMatchesWorktree(
  item: WorktreeItemRow,
  worktreeId: string,
  executionHostId?: ExecutionHostId
): boolean {
  // Hostless matching is presentation-only legacy fallback; it never routes a workspace action.
  return (
    item.worktree.id === worktreeId &&
    (executionHostId === undefined ||
      getWorktreeExecutionHostId(item.worktree, item.repo) === executionHostId)
  )
}

export function renderRowContainsWorktree(
  row: RenderRow,
  worktreeId: string | null,
  executionHostId?: ExecutionHostId
): boolean {
  if (worktreeId === null) {
    return false
  }
  if (row.type === 'folder-workspace') {
    return (
      folderWorkspaceKey(row.folderWorkspace.id) === worktreeId &&
      (executionHostId === undefined ||
        getFolderWorkspaceHostIdentity(row.folderWorkspace) ===
          composeWorktreeHostIdentity(executionHostId, worktreeId))
    )
  }
  if (row.type === 'lineage-group') {
    return row.rows.some((item) => itemMatchesWorktree(item, worktreeId, executionHostId))
  }
  return row.type === 'item' && itemMatchesWorktree(row, worktreeId, executionHostId)
}

export function getRenderRowWorktreeItem(
  row: RenderRow,
  worktreeId: string,
  executionHostId?: ExecutionHostId
): WorktreeItemRow | null {
  if (row.type === 'lineage-group') {
    return row.rows.find((item) => itemMatchesWorktree(item, worktreeId, executionHostId)) ?? null
  }
  return row.type === 'item' && itemMatchesWorktree(row, worktreeId, executionHostId) ? row : null
}

/** Rows that do not render the workspace count as pinned, so they never beat a natural copy. */
export function isPinnedSectionRenderRow(
  row: RenderRow,
  worktreeId: string,
  executionHostId?: ExecutionHostId
): boolean {
  if (row.type === 'folder-workspace') {
    return row.sectionKey === PINNED_GROUP_KEY
  }
  const itemRow = getRenderRowWorktreeItem(row, worktreeId, executionHostId)
  return itemRow === null || isPinnedWorktreeRow(itemRow)
}

// Prefer the workspace's natural group row over its pinned duplicate when both are rendered.
export function findPreferredRenderRowIndexForWorktree(
  renderRows: readonly RenderRow[],
  worktreeId: string,
  pinnedDisplayPolicy: PinnedWorktreeDisplayPolicy
): number {
  let fallbackIndex = -1
  for (let index = 0; index < renderRows.length; index++) {
    const row = renderRows[index]
    if (!renderRowContainsWorktree(row, worktreeId)) {
      continue
    }
    if (fallbackIndex === -1) {
      fallbackIndex = index
    }
    if (
      pinnedDisplayPolicy === 'duplicate-in-groups' &&
      !isPinnedSectionRenderRow(row, worktreeId)
    ) {
      return index
    }
  }
  return fallbackIndex
}

export function findPreferredRenderRowIndexForWorktreeIdentity(
  renderRows: readonly RenderRow[],
  worktree: Pick<Worktree, 'id' | 'hostId'>,
  pinnedDisplayPolicy: PinnedWorktreeDisplayPolicy
): number {
  const identity = getWorktreeHostIdentity(worktree)
  let fallbackIndex = -1
  for (let index = 0; index < renderRows.length; index++) {
    const row = renderRows[index]
    // Host-qualified reveals include folder rows, not just worktree item rows.
    if (row.type === 'folder-workspace') {
      if (
        folderWorkspaceKey(row.folderWorkspace.id) !== worktree.id ||
        (worktree.hostId &&
          getWorktreeHostIdentity(folderWorkspaceToWorktree(row.folderWorkspace)) !== identity)
      ) {
        continue
      }
      if (fallbackIndex === -1) {
        fallbackIndex = index
      }
      if (!isPinnedSectionRenderRow(row, worktree.id)) {
        return index
      }
      continue
    }
    const itemRows = row.type === 'lineage-group' ? row.rows : row.type === 'item' ? [row] : []
    const itemRow = itemRows.find(
      (candidate) => getWorktreeHostIdentity(candidate.worktree) === identity
    )
    if (!itemRow) {
      continue
    }
    if (fallbackIndex === -1) {
      fallbackIndex = index
    }
    if (pinnedDisplayPolicy === 'duplicate-in-groups' && !isPinnedWorktreeRow(itemRow)) {
      return index
    }
  }
  return fallbackIndex
}
