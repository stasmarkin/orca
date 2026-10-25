import type { WorktreeOccurrencePlan } from '../worktree-occurrence-plan'
import type { Worktree } from '../worktree/types'
import type { ExecutionHostId } from '../execution-host'
import { PINNED_GROUP_KEY } from './group-keys'
import {
  compareFolderWorkspacesForDisplay,
  type RenderableFolderWorkspace
} from './folder-workspace-lanes'
import {
  appendWorktreeRows,
  buildFolderWorkspaceRow,
  buildImportedWorktreesCardRow
} from './row-builders'
import { getLaneHeaderHostFields, type NoticeHostContext } from './host-labels'
import type { ImportedWorktreesCardCandidate, RepoOfWorktree, Row } from './row-types'

export type PinnedGroupEmitOptions = {
  result: Row[]
  worktrees: Worktree[]
  /** Folder workspaces have no repo, so they skip the repo-anchored imported fallback. */
  folderWorkspaces: readonly RenderableFolderWorkspace[]
  repoOf: RepoOfWorktree
  defaultHostId: ExecutionHostId
  collapsedGroups: Set<string>
  renderedNaturalAnchorRepoIds: ReadonlySet<string>
  importedWorktreesByRepo: ReadonlyMap<string, ImportedWorktreesCardCandidate>
  allowImportedFallback: boolean
  occurrencePlan: WorktreeOccurrencePlan<Worktree>
  noticeHostContextLabelByRepoId?: ReadonlyMap<string, NoticeHostContext>
  hostContextLabelByWorktreeIdentity?: ReadonlyMap<string, string>
}

export function emitPinnedGroup(options: PinnedGroupEmitOptions): void {
  const {
    result,
    worktrees: pinnedSectionWorktrees,
    folderWorkspaces,
    repoOf,
    defaultHostId,
    collapsedGroups,
    renderedNaturalAnchorRepoIds,
    importedWorktreesByRepo,
    allowImportedFallback,
    occurrencePlan,
    noticeHostContextLabelByRepoId,
    hostContextLabelByWorktreeIdentity
  } = options
  if (pinnedSectionWorktrees.length === 0 && folderWorkspaces.length === 0) {
    return
  }
  const pinnedRepoOrder: string[] = []
  const seenPinnedRepoIds = new Set<string>()
  for (const worktree of pinnedSectionWorktrees) {
    if (!seenPinnedRepoIds.has(worktree.repoId)) {
      pinnedRepoOrder.push(worktree.repoId)
      seenPinnedRepoIds.add(worktree.repoId)
    }
  }

  result.push({
    type: 'header',
    key: PINNED_GROUP_KEY,
    count: pinnedSectionWorktrees.length + folderWorkspaces.length,
    icon: { kind: 'pinned' },
    // Lane helpers keep a folder-only Pinned section host-scoped instead of reading as unscoped.
    ...getLaneHeaderHostFields(pinnedSectionWorktrees, folderWorkspaces, repoOf, defaultHostId)
  })
  if (collapsedGroups.has(PINNED_GROUP_KEY)) {
    for (const repoId of pinnedRepoOrder) {
      const candidate = importedWorktreesByRepo.get(repoId)
      if (allowImportedFallback && candidate && !renderedNaturalAnchorRepoIds.has(repoId)) {
        result.push(
          buildImportedWorktreesCardRow(
            candidate,
            'pinned-fallback',
            noticeHostContextLabelByRepoId?.get(repoId)
          )
        )
      }
    }
    return
  }

  const firstItemIndex = result.length
  appendWorktreeRows(result, repoOf, occurrencePlan, {
    collapsedGroups,
    groupDepth: 0,
    sectionKey: PINNED_GROUP_KEY,
    hostContextLabelByWorktreeIdentity
  })
  for (const pair of [...folderWorkspaces].sort((left, right) =>
    compareFolderWorkspacesForDisplay(left.folderWorkspace, right.folderWorkspace)
  )) {
    result.push(buildFolderWorkspaceRow(pair, PINNED_GROUP_KEY, 0))
  }
  if (!allowImportedFallback) {
    return
  }
  // Insert imported fallbacks after the repo’s last row, backwards to avoid shifting later targets.
  const lastResultIndexByRepoId = new Map<string, number>()
  for (let index = firstItemIndex; index < result.length; index++) {
    const row = result[index]
    if (row?.type === 'item') {
      lastResultIndexByRepoId.set(row.worktree.repoId, index)
    }
  }
  const inserts = [...lastResultIndexByRepoId.entries()].sort((left, right) => right[1] - left[1])
  for (const [repoId, index] of inserts) {
    const candidate = importedWorktreesByRepo.get(repoId)
    if (candidate && !renderedNaturalAnchorRepoIds.has(repoId)) {
      result.splice(
        index + 1,
        0,
        buildImportedWorktreesCardRow(
          candidate,
          'pinned-fallback',
          noticeHostContextLabelByRepoId?.get(repoId)
        )
      )
    }
  }
}
