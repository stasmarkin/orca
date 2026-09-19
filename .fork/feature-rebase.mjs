// Moves each live feature branch onto the current upstream tip.
//
// Every branch here is checked out in its own Orca workspace, so `git branch -f` would be refused.
// A branch that is checked out is rebased inside that workspace; only a free branch gets a
// throwaway detached worktree.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { checkedOutBranches, git, isWorkingTreeClean, resolve } from './git-commands.mjs'

/** @param {string} branch @param {string} base */
function isUpToDate(branch, base) {
  return git(['merge-base', branch, base]) === resolve(base)
}

/**
 * @param {{branch: string}[]} features
 * @param {{base: string, dryRun: boolean}} options
 * @returns {{branch: string, before: string, after: string, state: 'current' | 'rebased' | 'would-rebase'}[]}
 */
export function rebaseFeatures(features, { base, dryRun }) {
  const locations = checkedOutBranches()
  const results = []

  for (const { branch } of features) {
    const before = resolve(branch)
    if (isUpToDate(branch, base)) {
      results.push({ branch, before, after: before, state: 'current' })
      continue
    }
    if (dryRun) {
      results.push({ branch, before, after: before, state: 'would-rebase' })
      continue
    }
    const after = locations.has(branch)
      ? rebaseInPlace(branch, locations.get(branch), base)
      : rebaseDetached(branch, base)
    results.push({ branch, before, after, state: 'rebased' })
  }
  return results
}

function rebaseInPlace(branch, cwd, base) {
  if (!isWorkingTreeClean(cwd)) {
    throw new Error(
      `${branch} is checked out at ${cwd} with uncommitted changes. Commit or set them aside first.`
    )
  }
  try {
    git(['rebase', base], { cwd })
  } catch (error) {
    // Left mid-rebase on purpose: the conflict belongs to whoever owns that workspace.
    throw new Error(
      `${branch} hit a conflict rebasing onto ${base}.\n` +
        `Resolve it in ${cwd} (git rebase --continue), or run git rebase --abort there, then sync again.\n\n${
          error.message
        }`
    )
  }
  return resolve(branch)
}

function rebaseDetached(branch, base) {
  const scratch = mkdtempSync(join(tmpdir(), 'fork-rebase-'))
  try {
    git(['worktree', 'add', '--detach', scratch, branch])
    git(['rebase', base], { cwd: scratch })
    const rebased = git(['rev-parse', 'HEAD'], { cwd: scratch })
    git(['branch', '--force', branch, rebased])
    return rebased
  } catch (error) {
    throw new Error(
      `${branch} could not be rebased onto ${base} in a scratch worktree.\n\n${error.message}`
    )
  } finally {
    git(['worktree', 'remove', '--force', scratch], { allowFail: true })
    rmSync(scratch, { recursive: true, force: true })
  }
}
