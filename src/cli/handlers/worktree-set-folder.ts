import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import { resolve as resolvePath } from 'node:path'
import { isPathInsideOrEqual } from '../../shared/cross-platform-path'
import { resolveFolderWorkspaceHost } from '../../shared/folder-workspace-execution-host'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { Repo } from '../../shared/repo-types'
import { getCallerExecutionHostId } from '../caller-host-worktree-selection'
import type { HandlerContext } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'
import { assertLocalCwdWorktreeSelector, resolveCurrentWorktreeSelection } from '../selectors'
import type { WorktreeStateFlags } from './worktree-pin-flags'

export const FOLDER_UNSUPPORTED_LINK_FLAGS = [
  'issue',
  'linear-issue',
  'gitlab-issue',
  'pr',
  'gitlab-mr'
] as const
export const FOLDER_UNSUPPORTED_LINEAGE_FLAGS = ['parent-worktree', 'no-parent'] as const

type FolderWorkspaceSetUpdates = {
  name?: string
  pendingFirstAgentMessageRename?: false
  firstAgentMessageRenameError?: null
  comment?: string
  workspaceStatus?: string
  isUnread?: boolean
  isPinned?: boolean
}

export type WorktreeSetTarget =
  | { kind: 'worktree'; selector: string }
  | { kind: 'folder'; folderWorkspaceId: string }

export function parseExplicitFolderWorkspaceId(selector: string): string | null {
  const prefix = ['id:folder:', 'folder:'].find((candidate) => selector.startsWith(candidate))
  if (!prefix) {
    return null
  }
  const folderWorkspaceId = selector.slice(prefix.length)
  if (!folderWorkspaceId) {
    throw new RuntimeClientError('invalid_argument', `Missing folder workspace id in ${selector}`)
  }
  return folderWorkspaceId
}

export function hasFolderUnsupportedFlags(flags: Map<string, string | boolean>): boolean {
  return [...FOLDER_UNSUPPORTED_LINK_FLAGS, ...FOLDER_UNSUPPORTED_LINEAGE_FLAGS].some((name) =>
    flags.has(name)
  )
}

export function buildFolderWorkspaceSetUpdates(
  flags: Map<string, string | boolean>,
  folderWorkspaceId: string,
  { isUnread, isPinned }: WorktreeStateFlags
): FolderWorkspaceSetUpdates {
  const linkFlags = FOLDER_UNSUPPORTED_LINK_FLAGS.filter((name) => flags.has(name))
  const lineageFlags = FOLDER_UNSUPPORTED_LINEAGE_FLAGS.filter((name) => flags.has(name))
  const unsupported = [...linkFlags, ...lineageFlags]
  if (unsupported.length > 0) {
    const hint = linkFlags.length
      ? ` Link issues and reviews with orca reference add --worktree folder:${folderWorkspaceId} --url <url>.`
      : ''
    throw new RuntimeClientError(
      'invalid_argument',
      `${unsupported.map((name) => `--${name}`).join(', ')} not supported by \`worktree set\` for folder workspaces.${hint}`
    )
  }
  const name = getOptionalStringFlag(flags, 'display-name')
  const comment = getOptionalStringFlag(flags, 'comment')
  const workspaceStatus = getOptionalStringFlag(flags, 'workspace-status')
  return {
    // A manual name must also cancel the pending first-agent-message rename, as worktree.set does.
    ...(name !== undefined
      ? { name, pendingFirstAgentMessageRename: false, firstAgentMessageRenameError: null }
      : {}),
    ...(comment !== undefined ? { comment } : {}),
    ...(workspaceStatus !== undefined ? { workspaceStatus } : {}),
    ...(isUnread !== undefined ? { isUnread } : {}),
    ...(isPinned !== undefined ? { isPinned } : {})
  }
}

function formatFolderWorkspaceSet({ folderWorkspace }: { folderWorkspace: FolderWorkspace }) {
  return [
    `id: folder:${folderWorkspace.id}`,
    `name: ${folderWorkspace.name}`,
    `path: ${folderWorkspace.folderPath}`,
    `status: ${folderWorkspace.workspaceStatus ?? ''}`,
    `pinned: ${folderWorkspace.isPinned}`,
    `unread: ${folderWorkspace.isUnread}`,
    `comment: ${folderWorkspace.comment}`
  ].join('\n')
}

export async function runFolderWorkspaceSet(
  { flags, client, json }: Pick<HandlerContext, 'flags' | 'client' | 'json'>,
  folderWorkspaceId: string,
  stateFlags: WorktreeStateFlags
): Promise<void> {
  const updates = buildFolderWorkspaceSetUpdates(flags, folderWorkspaceId, stateFlags)
  let response
  try {
    response = await client.call<{ folderWorkspace: FolderWorkspace | null }>(
      'folderWorkspace.update',
      { folderWorkspaceId, updates }
    )
  } catch (error) {
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      throw new RuntimeClientError(
        'incompatible_runtime',
        'This Orca host does not support folder workspaces. Update Orca on the execution host.'
      )
    }
    throw error
  }
  const { folderWorkspace } = response.result
  if (!folderWorkspace) {
    throw new RuntimeClientError(
      'selector_not_found',
      `No folder workspace with id ${folderWorkspaceId}`
    )
  }
  printResult({ ...response, result: { folderWorkspace } }, json, formatFolderWorkspaceSet)
}

/** Git worktrees keep precedence; the enclosing folder is used only when no worktree contains cwd. */
export async function resolveCurrentWorktreeSetTarget(
  selector: 'active' | 'current',
  cwd: string,
  client: RuntimeClient,
  allowFolder: boolean
): Promise<WorktreeSetTarget> {
  assertLocalCwdWorktreeSelector(selector, client)
  try {
    return {
      kind: 'worktree',
      selector: (await resolveCurrentWorktreeSelection(cwd, client)).selector
    }
  } catch (gitError) {
    // Folder paths are matched as local paths, so an SSH caller could hit a same-path local folder.
    if (
      !(gitError instanceof RuntimeClientError) ||
      gitError.code !== 'selector_not_found' ||
      !allowFolder ||
      getCallerExecutionHostId() !== LOCAL_EXECUTION_HOST_ID
    ) {
      throw gitError
    }
    const folderWorkspaceId = await selectEnclosingLocalFolderWorkspace(cwd, client)
    if (!folderWorkspaceId) {
      throw gitError
    }
    return { kind: 'folder', folderWorkspaceId }
  }
}

/** Innermost native folder containing cwd; folders may share a path, so ties need the caller's own. */
async function selectEnclosingLocalFolderWorkspace(
  cwd: string,
  client: RuntimeClient
): Promise<string | null> {
  let folders: FolderWorkspace[]
  try {
    folders = (await client.call<{ folderWorkspaces: FolderWorkspace[] }>('folderWorkspace.list'))
      .result.folderWorkspaces
  } catch (error) {
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      return null
    }
    throw error
  }
  const target = resolvePath(cwd)
  const enclosing = folders.filter(
    (folder) => !folder.isArchived && isPathInsideOrEqual(folder.folderPath, target)
  )
  if (enclosing.length === 0) {
    return null
  }
  const [groups, repos] = await Promise.all([
    client.call<{ groups: ProjectGroup[] }>('projectGroup.list'),
    client.call<{ repos: Repo[] }>('repo.list')
  ])
  const state = {
    folderWorkspaces: folders,
    projectGroups: groups.result.groups,
    repos: repos.result.repos
  }
  const native = enclosing.filter(
    (folder) => resolveFolderWorkspaceHost(state, folder.id).kind === 'local'
  )
  const longest = Math.max(...native.map((folder) => folder.folderPath.length))
  const innermost = native.filter((folder) => folder.folderPath.length === longest)
  if (innermost.length <= 1) {
    return innermost[0]?.id ?? null
  }
  const callerWorkspace = process.env.ORCA_WORKSPACE_ID
  const caller = innermost.find((folder) => `folder:${folder.id}` === callerWorkspace)
  if (caller) {
    return caller.id
  }
  throw new RuntimeClientError(
    'selector_ambiguous',
    `Several folder workspaces contain ${target}: ${innermost.map((folder) => `folder:${folder.id}`).join(', ')}. Pass --worktree folder:<folderId>.`
  )
}
