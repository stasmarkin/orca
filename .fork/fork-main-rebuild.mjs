// Rebuilds fork main from scratch: upstream tip, then one merge per feature, then the marker commit
// that records the recipe. Nothing is rebased here — fork main is an output, never a source.
import { existsSync, mkdtempSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { git, repoRoot, resolve } from './git-commands.mjs'
import { markerMessage } from './sync-marker.mjs'
import { typecheckTree } from './build-verification.mjs'

/**
 * A scratch worktree has no node_modules, so generated files could not be regenerated there — and a
 * generator run from the repository root would silently read the wrong tree.
 */
function linkNodeModules(scratch) {
  const source = join(repoRoot(), 'node_modules')
  if (existsSync(source)) {
    symlinkSync(source, join(scratch, 'node_modules'))
  }
}

/** Removed before `git worktree remove`, so nothing can follow the link into the real install. */
function unlinkNodeModules(scratch) {
  const link = join(scratch, 'node_modules')
  if (existsSync(link)) {
    unlinkSync(link)
  }
}

/**
 * @param {{branch: string, sha: string}[]} parts
 * @param {{base: string, dryRun: boolean, verify: boolean}} options
 * @returns {{sha: string | null, parts: {branch: string, sha: string}[], base: string}}
 */
export function rebuildForkMain(parts, { base, dryRun, verify }) {
  const baseSha = resolve(base)
  if (dryRun) {
    return { sha: null, parts, base: baseSha }
  }

  const scratch = mkdtempSync(join(tmpdir(), 'fork-main-'))
  let keepScratch = false
  try {
    git(['worktree', 'add', '--detach', scratch, baseSha])
    linkNodeModules(scratch)
    for (const part of parts) {
      const message = `Merge ${part.branch} into fork main`
      try {
        git(['merge', '--no-ff', '-m', message, part.sha], { cwd: scratch })
      } catch (error) {
        // rerere replays a known resolution into the working tree but still leaves the merge
        // uncommitted and git exiting non-zero, so an empty unmerged list means nothing is wrong.
        if (git(['diff', '--name-only', '--diff-filter=U'], { cwd: scratch }) !== '') {
          keepScratch = true
          throw new Error(describeConflict(part.branch, scratch, error.message))
        }
        git(['commit', '--no-verify', '-m', `${message} (conflict resolved from rerere cache)`], {
          cwd: scratch
        })
      }
    }
    git(['commit', '--allow-empty', '-m', markerMessage({ base: baseSha, parts })], {
      cwd: scratch
    })
    if (verify) {
      console.log('Typechecking the rebuilt tree...')
      const failure = typecheckTree(scratch)
      if (failure !== null) {
        keepScratch = true
        throw new Error(
          `The rebuilt fork main does not typecheck, so it is not published.\n` +
            `Every branch typechecks alone, so the break comes from how two of them combine.\n` +
            `Inspect ${scratch}, fix it in the feature branch that owns the code, then: just sync\n\n${failure}`
        )
      }
    }
    return { sha: git(['rev-parse', 'HEAD'], { cwd: scratch }), parts, base: baseSha }
  } finally {
    if (!keepScratch) {
      unlinkNodeModules(scratch)
      git(['worktree', 'remove', '--force', scratch], { allowFail: true })
      rmSync(scratch, { recursive: true, force: true })
    }
  }
}

/**
 * Two features clashing with each other, unlike a feature clashing with upstream: resolve it once in
 * the scratch tree and commit there, and rerere replays it on every later rebuild.
 */
function describeConflict(branch, scratch, detail) {
  return (
    `Merging ${branch} into fork main conflicted with a feature already in the build.\n\n` +
    `Resolve it in ${scratch} and commit the merge there — the tree is thrown away, but rerere\n` +
    `records the resolution and replays it automatically on the next sync. Generated files\n` +
    `(src/cli/bundled-skill-guides.ts) are rebuilt rather than merged: run their generator with that\n` +
    `tree as the working directory, or it silently reads this repository instead.\n` +
    `Then: rm -f ${join(scratch, 'node_modules')} && git worktree remove --force ${scratch} && just sync\n\n${detail}`
  )
}
