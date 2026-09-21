// Git and gh runner for the fork sync tooling. Every call is checked: a non-zero exit throws with
// the command's own stderr, so a half-finished sync stops instead of continuing on stale state.
//
// NOTE: node:child_process directly, unlike src/ which must route through src/shared/child-process.
// This file never ships in the app — it is fork-only tooling that runs on a developer machine.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** @param {string[]} args @param {{cwd?: string, allowFail?: boolean}} [options] */
export function git(args, options = {}) {
  return run('git', args, options)
}

/** @param {string[]} args @param {{allowFail?: boolean}} [options] */
export function gh(args, options = {}) {
  return run('gh', args, options)
}

// The 1 MiB default truncates and then throws with empty stdout and stderr, which surfaces as a
// command that "failed:" with no reason at all — `git log` over a rebuilt tree passes it easily.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

function run(bin, args, { cwd = REPO_ROOT, allowFail = false } = {}) {
  try {
    return execFileSync(bin, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: MAX_OUTPUT_BYTES,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
  } catch (error) {
    if (allowFail) {
      return null
    }
    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : ''
    const stdout = typeof error.stdout === 'string' ? error.stdout.trim() : ''
    throw new Error(`${bin} ${args.join(' ')} failed:\n${stderr || stdout || error.message}`)
  }
}

/** @param {string} rev */
export function resolve(rev) {
  const sha = git(['rev-parse', '--verify', '--quiet', rev], { allowFail: true })
  if (!sha) {
    throw new Error(`Unknown revision: ${rev}`)
  }
  return sha
}

/** @param {string} rev */
export function exists(rev) {
  return git(['rev-parse', '--verify', '--quiet', rev], { allowFail: true }) !== null
}

/** @param {string} from @param {string} to */
export function countCommits(from, to) {
  return Number(git(['rev-list', '--count', `${from}..${to}`]))
}

/** @param {string} cwd */
export function isWorkingTreeClean(cwd) {
  // Untracked files are excluded: they do not stop a rebase, and a workspace that has collected a
  // scratch file or a build artefact is the normal state, not a reason to refuse to sync.
  return git(['status', '--porcelain', '--untracked-files=no'], { cwd }) === ''
}

/** Branch name -> absolute worktree path, for every branch checked out somewhere. */
export function checkedOutBranches() {
  const byBranch = new Map()
  let path = null
  for (const line of git(['worktree', 'list', '--porcelain']).split('\n')) {
    if (line.startsWith('worktree ')) {
      path = line.slice('worktree '.length)
    } else if (line.startsWith('branch refs/heads/')) {
      byBranch.set(line.slice('branch refs/heads/'.length), path)
    }
  }
  return byBranch
}

export function repoRoot() {
  return REPO_ROOT
}
