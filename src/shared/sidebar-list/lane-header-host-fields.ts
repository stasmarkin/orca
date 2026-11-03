import type { Worktree } from '../worktree/types'
import type { ExecutionHostId } from '../execution-host'
import { getWorktreeHostIdentity } from '../worktree/host-qualified-identity'
import { getFolderWorkspaceHostIdentity } from '../folder-workspace-worktree'
import type { RenderableFolderWorkspace } from './folder-workspace-lanes'
import type { RepoOfWorktree } from './row-types'
import {
  getLaneHostCountedWorkspaceIds,
  getLaneHostWorktreeCounts,
  getLaneHostWorktreeIds
} from './host-labels'

/** Host bookkeeping and badge keys shared by lane headers that mix worktrees and folder workspaces. */
export function getLaneHeaderHostFields(
  worktrees: readonly Worktree[],
  folderWorkspaces: readonly RenderableFolderWorkspace[],
  repoOf: RepoOfWorktree,
  defaultHostId: ExecutionHostId
) {
  return {
    hostWorktreeCounts: getLaneHostWorktreeCounts(
      worktrees,
      folderWorkspaces,
      repoOf,
      defaultHostId
    ),
    hostWorktreeIds: getLaneHostWorktreeIds(worktrees, folderWorkspaces, repoOf, defaultHostId),
    worktreeIds: worktrees.map((worktree) => worktree.id),
    countedWorkspaceIds: [
      ...worktrees.map(getWorktreeHostIdentity),
      ...folderWorkspaces.map((pair) => getFolderWorkspaceHostIdentity(pair.folderWorkspace))
    ],
    hostCountedWorkspaceIds: getLaneHostCountedWorkspaceIds(
      worktrees,
      folderWorkspaces,
      repoOf,
      defaultHostId
    )
  }
}
