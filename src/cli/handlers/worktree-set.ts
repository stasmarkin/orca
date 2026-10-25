import { parentCwdNextSteps, withWorktreeSelectorRecovery } from '../worktree-selector-recovery'
import type { RuntimeWorktreeSetResult } from '../../shared/runtime-types'
import type { CommandHandler } from '../dispatch'
import { formatWorktreeShow, printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { getOptionalWorktreeSelector, getRequiredWorktreeSelector } from '../selectors'
import {
  assertWorktreeParentFlagsCompatible,
  getWorkspaceKeyParentSelector
} from './worktree-create-parent-selector'
import { getOptionalLinearIssueLinkFlag } from './worktree-linear-issue-link'
import {
  hasFolderUnsupportedFlags,
  parseExplicitFolderWorkspaceId,
  resolveCurrentWorktreeSetTarget,
  runFolderWorkspaceSet
} from './worktree-set-folder'
import { getWorktreeStateFlags } from './worktree-pin-flags'
import { getReviewTargetLinkFlags } from './worktree-review-link-flags'
import { assertGitLabLinkFlagProjectsMatch } from './worktree-gitlab-link-context'

export const runWorktreeSet: CommandHandler = async ({ flags, client, cwd, json }) => {
  assertWorktreeParentFlagsCompatible(
    flags,
    'Choose either --parent-worktree or --no-parent, not both.'
  )
  const parentSelector = getOptionalStringFlag(flags, 'parent-worktree')
  if (parentSelector && getWorkspaceKeyParentSelector(parentSelector)?.startsWith('folder:')) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Parent selector "${parentSelector}" is a folder. Folder parents are accepted only by orca worktree create.`
    )
  }
  const stateFlags = getWorktreeStateFlags(flags)
  const reviewLinks = getReviewTargetLinkFlags(flags, { nullable: true })
  const linearIssueLink = getOptionalLinearIssueLinkFlag(flags, 'linear-issue', {
    allowNull: true
  })
  const selector = getRequiredStringFlag(flags, 'worktree')
  const explicitFolderId = parseExplicitFolderWorkspaceId(selector)
  const target =
    selector === 'active' || selector === 'current'
      ? await resolveCurrentWorktreeSetTarget(
          selector,
          cwd,
          client,
          !hasFolderUnsupportedFlags(flags)
        )
      : null
  const folderWorkspaceId =
    explicitFolderId ?? (target?.kind === 'folder' ? target.folderWorkspaceId : null)
  if (folderWorkspaceId) {
    return runFolderWorkspaceSet({ flags, client, json }, folderWorkspaceId, stateFlags)
  }
  const worktree =
    target?.kind === 'worktree'
      ? target.selector
      : await getRequiredWorktreeSelector(flags, 'worktree', cwd, client)
  await assertGitLabLinkFlagProjectsMatch(flags, client, { worktree })
  const pending = client.call<RuntimeWorktreeSetResult>('worktree.set', {
    worktree,
    displayName: getOptionalStringFlag(flags, 'display-name'),
    ...reviewLinks,
    ...linearIssueLink,
    comment: getOptionalStringFlag(flags, 'comment'),
    workspaceStatus: getOptionalStringFlag(flags, 'workspace-status'),
    ...stateFlags,
    parentWorktree: await withWorktreeSelectorRecovery(
      getOptionalWorktreeSelector(flags, 'parent-worktree', cwd, client),
      parentCwdNextSteps(parentSelector),
      parentSelector
    ),
    noParent: flags.get('no-parent') === true
  })
  const result = await withWorktreeSelectorRecovery(
    pending,
    parentSelector
      ? [
          `Orca could not find the worktree selector "${worktree}" or the parent selector "${parentSelector}". The server did not identify which selector failed.`,
          'Check both selectors with orca worktree show --worktree <selector> --json.'
        ]
      : []
  )
  if (!json) {
    for (const warning of result.result.warnings ?? []) {
      console.error(`warning: ${warning.message}`)
    }
  }
  printResult(result, json, formatWorktreeShow)
}
