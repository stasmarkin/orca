#!/usr/bin/env node
// Fork sync entry point. See .fork/README.md.
//
//   node .fork/sync.mjs status          what this fork carries, and what upstream did with it
//   node .fork/sync.mjs check           is fork main still the build its marker claims
//   node .fork/sync.mjs sync [--dry-run] [--no-push] [--skip-verify] [--allow-drift]
//   node .fork/sync.mjs prs             mergeability of the open upstream pull requests
import { assertBranchesExist, buildOrder, readFeatures } from './manifest.mjs'
import { countCommits, exists, git, resolve } from './git-commands.mjs'
import { classify, readPullRequestStates } from './upstream-pr-status.mjs'
import { countBehind, inspectDrift } from './sync-marker.mjs'
import { rebaseFeatures } from './feature-rebase.mjs'
import { rebuildForkMain } from './fork-main-rebuild.mjs'
import { refreshPullRequests } from './pull-request-refresh.mjs'
import { inspectPush } from './push-safety.mjs'

const BASE = 'origin/main'
// Fully qualified: a local branch literally named fork/main would otherwise win the lookup and the
// drift check would inspect it instead of what the fork has published.
const FORK_REFS = 'refs/remotes/fork/'
const FORK_MAIN = `${FORK_REFS}main`
const PUBLISHED_REFS = 'refs/fork-sync/published/'
const KNOWN_FLAGS = ['--dry-run', '--no-push', '--skip-verify', '--allow-drift']
const UPSTREAM_SLUG = 'stablyai/orca'

const [command = 'status', ...flags] = process.argv.slice(2)
const dryRun = flags.includes('--dry-run')
const noPush = flags.includes('--no-push')
const allowDrift = flags.includes('--allow-drift')
const verify = !flags.includes('--skip-verify')

try {
  await main()
} catch (error) {
  console.error(`\n✗ ${error.message}\n`)
  process.exit(1)
}

async function main() {
  // A silently ignored typo in --dry-run would force-push for real.
  const unknown = flags.filter((flag) => !KNOWN_FLAGS.includes(flag))
  if (unknown.length > 0) {
    throw new Error(`Unknown flag(s): ${unknown.join(', ')}. Expected ${KNOWN_FLAGS.join(', ')}.`)
  }
  // Before the first fetch, so a checkout wired to the wrong remotes is stopped rather than having
  // its tracking refs rewritten from whatever `origin` turned out to be.
  assertRemotes()
  switch (command) {
    case 'status':
      return status()
    case 'check':
      return check()
    case 'sync':
      return sync()
    case 'prs':
      return prs()
    default:
      throw new Error(`Unknown command "${command}". Expected status, check, sync or prs.`)
  }
}

function prNumbers(features) {
  // A frozen feature is classified without ever consulting its pull request.
  return features
    .filter((feature) => feature.kind !== 'frozen')
    .map((feature) => feature.pr)
    .filter((pr) => pr !== null)
}

/**
 * In this checkout `origin` is upstream and `fork` is mine — the reverse of the usual layout, and
 * this tool force-pushes to one of them. In a plain clone of the fork, `origin` would be the fork:
 * features would rebase onto their own published state and the rebuild would land in the open
 * upstream pull requests. Cheap to check, unrecoverable to get wrong.
 */
function assertRemotes() {
  const urlOf = (remote) =>
    (git(['remote', 'get-url', remote], { allowFail: true }) ?? '').toLowerCase()
  const origin = urlOf('origin')
  const fork = urlOf('fork')
  if (!origin.includes(UPSTREAM_SLUG)) {
    throw new Error(
      `origin must be ${UPSTREAM_SLUG} (the upstream), but it is "${origin || 'unset'}".`
    )
  }
  if (fork === '' || fork.includes(UPSTREAM_SLUG)) {
    throw new Error(
      `fork must be your own fork, not ${UPSTREAM_SLUG}, but it is "${fork || 'unset'}".`
    )
  }
}

/**
 * Named refspecs rather than whatever remote.fork.fetch happens to be: configured narrowly it leaves
 * tracking refs this tool reads — fork main included — months out of date, and configured with a
 * wildcard it drags in every branch the fork inherited from upstream, thousands of them.
 * Unpublished branches are dropped first because a refspec naming one fails the whole fetch.
 */
function fetchFork(branches) {
  const published = new Set(
    // Asked by name: an unqualified listing returns every branch the fork inherited from upstream.
    git(['ls-remote', '--heads', 'fork', ...branches.map((branch) => `refs/heads/${branch}`)])
      .split('\n')
      .map((line) => line.split('refs/heads/')[1])
      .filter(Boolean)
  )
  const wanted = branches.filter((branch) => published.has(branch))
  if (wanted.length > 0) {
    git(['fetch', 'fork', ...wanted.map((branch) => `+refs/heads/${branch}:${FORK_REFS}${branch}`)])
  }
}

function fetchRemotes(branches) {
  git(['fetch', 'origin', 'main'])
  fetchFork(branches)
}

function trackedBranches(features) {
  return ['main', ...features.map((feature) => feature.branch)]
}

/**
 * Same conflicts recur on every sync across hundreds of upstream commits; cache the resolutions.
 * autoUpdate matters as much as enabled: without it a replayed resolution lands in the working tree
 * but leaves the index unmerged, which is indistinguishable from a conflict nobody has solved yet.
 */
function enableRerere() {
  for (const [key, value] of [
    ['rerere.enabled', 'true'],
    ['rerere.autoUpdate', 'true']
  ]) {
    if (git(['config', '--get', key], { allowFail: true }) !== value) {
      git(['config', key, value])
      console.log(`Set ${key}=${value} for this repository.`)
    }
  }
}

function status() {
  const features = readFeatures()
  fetchRemotes(trackedBranches(features))
  const states = readPullRequestStates(prNumbers(features))
  const baseSha = resolve(BASE)

  console.log(`upstream ${BASE} at ${baseSha.slice(0, 10)}`)
  console.log(
    `fork main ${exists(FORK_MAIN) ? resolve(FORK_MAIN).slice(0, 10) : '(none)'}, ${countBehind(FORK_MAIN, BASE)} commits behind upstream\n`
  )

  const rows = features.map((feature) => {
    const { label, action } = classify(feature, states)
    return {
      id: feature.id,
      kind: feature.kind,
      upstream: label,
      behind: describeBehind(feature, baseSha),
      action
    }
  })
  printTable(rows, ['id', 'kind', 'upstream', 'behind', 'action'])

  const decide = rows.filter((row) => row.action === 'decide' || row.action === 'drop')
  if (decide.length > 0) {
    console.log('\nNeeds a decision before the next sync:')
    for (const row of decide) {
      const verb =
        row.action === 'drop'
          ? 'landed upstream — remove it from .fork/features.yaml'
          : 'unclear — check the pull request thread'
      console.log(`  ${row.id}: ${row.upstream} ${verb}`)
    }
  }
}

/** A branch missing locally must not read as "0 behind", which is what a fully current one shows. */
function describeBehind(feature, baseSha) {
  if (!exists(feature.branch)) {
    return 'no branch'
  }
  const behind = countCommits(git(['merge-base', feature.branch, BASE]), baseSha)
  return feature.kind === 'frozen' ? `${behind} (frozen)` : String(behind)
}

function check() {
  // The whole verdict is about what the fork holds; reading a stale remote-tracking ref could
  // report clean while published fork main carries work nobody has moved into a branch.
  fetchFork(['main'])
  const drift = inspectDrift(FORK_MAIN, BASE)
  if (drift.state === 'clean') {
    console.log(`fork main is exactly the build recorded at ${drift.marker.slice(0, 10)}.`)
    return
  }
  if (drift.state === 'unmanaged') {
    if (!exists(FORK_MAIN)) {
      console.log('The fork has no main branch yet — the first sync builds it from the manifest.')
      return
    }
    console.log('fork main carries no sync marker yet, so none of it is known to be reproducible.')
    console.log(`Review what a rebuild would replace:  git log --oneline ${BASE}..${FORK_MAIN}`)
    console.log('Each of those commits needs a manifest branch, then: just sync --allow-drift')
    return
  }
  console.log(`fork main has ${drift.extra.length} commit(s) on top of its sync marker:`)
  for (const line of drift.extra) {
    console.log(`  ${line}`)
  }
  console.log('\nThese are not in any manifest branch and the next rebuild drops them.')
  console.log('Move each one into a feature branch, or add its branch to .fork/features.yaml.')
  process.exitCode = 1
}

function sync() {
  const features = readFeatures()
  fetchRemotes(trackedBranches(features))
  if (!dryRun) {
    enableRerere()
  }

  assertBranchesExist(features)
  const states = readPullRequestStates(prNumbers(features))

  const blocked = features
    .map((feature) => ({ feature, ...classify(feature, states) }))
    .filter((entry) => entry.action === 'drop' || entry.action === 'decide')
  if (blocked.length > 0) {
    const lines = blocked.map((entry) => `  ${entry.feature.id}: ${entry.label}`)
    throw new Error(
      `The manifest is out of date with upstream:\n${lines.join('\n')}\n\n` +
        'A merged feature must be removed from .fork/features.yaml, not replayed — upstream squashes\n' +
        'pull requests, so its commits no longer match by patch id and would conflict with themselves.'
    )
  }

  const drift = inspectDrift(FORK_MAIN, BASE)
  if (!allowDrift && drift.state === 'drifted') {
    throw new Error(
      `fork main has ${drift.extra.length} commit(s) not in any manifest branch:\n${drift.extra
        .map((line) => `  ${line}`)
        .join(
          '\n'
        )}\n\nRebuilding drops them. Move them into feature branches, or pass --allow-drift to discard.`
    )
  }
  // Without a marker nothing on fork main is known to come from the manifest, so this is the case
  // with the most to lose — it must not be the one that skips the guard a few extra commits get.
  if (!allowDrift && drift.state === 'unmanaged' && exists(FORK_MAIN)) {
    throw new Error(
      `fork main carries no sync marker, so none of it is known to come from the manifest.\n` +
        `Rebuilding replaces it wholesale and force-pushes the result. See what would go:\n` +
        `  git log --oneline ${BASE}..${FORK_MAIN}\n\n` +
        `Every one of those commits must live in a manifest branch, or it is gone. ` +
        `Then: --allow-drift`
    )
  }

  const order = buildOrder(features)
  const rebased = rebaseFeatures(order, { base: BASE, dryRun })
  printTable(
    rebased.map((row) => ({
      branch: row.branch,
      state: row.state,
      from: row.before.slice(0, 10),
      to: row.after.slice(0, 10)
    })),
    ['branch', 'state', 'from', 'to']
  )

  const parts = order.map((feature) => ({ branch: feature.branch, sha: resolve(feature.branch) }))
  const built = rebuildForkMain(parts, { base: BASE, dryRun, verify })

  if (dryRun) {
    console.log(
      `\nDry run: would rebuild fork main on ${built.base.slice(0, 10)} from ${parts.length} branches.`
    )
    return
  }
  console.log(`\nRebuilt fork main: ${built.sha.slice(0, 10)} on ${built.base.slice(0, 10)}`)

  if (noPush) {
    console.log(
      `--no-push: nothing published. Inspect with: git log --oneline --graph ${built.sha}`
    )
    return
  }
  pushEverything(rebased, built)
  prs()
}

/**
 * Publishes by comparing against what the fork already holds, not by whether this run rebased:
 * a branch upstream has not moved past keeps state 'current' while still carrying commits — a review
 * fix pushed to nothing — and the pull request would sit on stale code with the sync reporting success.
 *
 * One atomic push for everything: published piecemeal, a lease that fails halfway leaves the fork
 * holding some branches from this build and some from the last one.
 */
function pushEverything(rebased, built) {
  const decided = [
    ...rebased.map((row) => ({
      branch: row.branch,
      sha: row.after,
      baseline: lastPublished(row.branch) ?? row.before,
      remoteRef: `${FORK_REFS}${row.branch}`
    })),
    { branch: 'main', sha: built.sha, baseline: null, remoteRef: FORK_MAIN }
  ].map((target) => ({
    ...target,
    ...inspectPush(
      {
        sha: target.sha,
        remoteSha: exists(target.remoteRef) ? resolve(target.remoteRef) : null,
        baseline: target.baseline
      },
      countUnseen
    )
  }))

  const refused = decided.filter((target) => target.action === 'refuse')
  if (refused.length > 0) {
    const lines = refused.map(
      (target) =>
        `  fork/${target.branch}: ${target.unseen} commit(s) this checkout has no counterpart for\n` +
        `    git log --oneline --cherry-pick --right-only ${target.sha}...${target.remoteRef}`
    )
    throw new Error(
      `Nothing was published. The fork holds work this sync would discard:\n${lines.join('\n')}\n\n` +
        `Most likely someone else's commit — a suggestion applied in the pull request UI, a push from\n` +
        `another machine. Bring it into the feature branch, then sync again.\n` +
        `If you have read the list and it is genuinely expendable, publish by hand and tell this tool\n` +
        `what the fork now holds, or it will refuse again:\n` +
        `  git push --force fork <sha>:refs/heads/<branch>\n` +
        `  git update-ref ${PUBLISHED_REFS}<branch> <sha>`
    )
  }

  const pushing = decided.filter((target) => target.action !== 'skip')
  if (pushing.length === 0) {
    console.log('The fork already holds this build; nothing to push.')
    return
  }
  // Leases are spelt out rather than bare: a bare lease trusts the remote-tracking ref, which a
  // background fetch can refresh to whatever someone else just pushed, defeating the check.
  const leases = pushing
    .filter((target) => target.lease !== undefined)
    .map((target) => `--force-with-lease=${target.branch}:${target.lease}`)
  git([
    'push',
    '--atomic',
    ...leases,
    'fork',
    ...pushing.map((target) => `${target.sha}:refs/heads/${target.branch}`)
  ])
  for (const target of pushing) {
    git(['update-ref', `${PUBLISHED_REFS}${target.branch}`, target.sha])
  }
  console.log(`pushed ${pushing.map((target) => target.branch).join(', ')}`)
}

/**
 * What this tool last put in the fork, which is not the same as the branch's sha before this sync:
 * a run that rebased and then stopped short of publishing — --no-push, a failed typecheck, a conflict
 * on a later branch — leaves the local branch rewritten while the fork still holds the old history.
 * Comparing against the pre-rebase sha then counts our own superseded commits as foreign work.
 */
function lastPublished(branch) {
  const ref = `${PUBLISHED_REFS}${branch}`
  return exists(ref) ? resolve(ref) : null
}

/** Commits on the right that have no patch-equivalent on the left; rebased copies do not count. */
function countUnseen(baseline, remoteSha) {
  return Number(
    git(['rev-list', '--count', '--right-only', '--cherry-pick', `${baseline}...${remoteSha}`])
  )
}

function prs() {
  const features = readFeatures()
  const states = readPullRequestStates(prNumbers(features))
  const open = features.filter(
    (feature) => feature.pr !== null && states.get(feature.pr)?.state === 'OPEN'
  )
  if (open.length === 0) {
    console.log('No open upstream pull requests.')
    return
  }
  const heads = new Map(open.map((feature) => [feature.branch, resolve(feature.branch)]))
  const rows = refreshPullRequests(open, heads)
  printTable(
    rows.map((row) => ({
      pr: `#${row.pr}`,
      branch: row.branch,
      mergeable: row.mergeable,
      head: row.headMatches ? 'in sync' : 'STALE',
      status: row.status
    })),
    ['pr', 'branch', 'mergeable', 'head', 'status']
  )
  console.log('\nmergeable UNKNOWN is a GitHub cache — re-run in half a minute.')
  console.log(
    'mergeStateStatus UNSTABLE is expected: upstream CI does not run on fork pull requests.'
  )
  console.log(
    'A rebased branch means the diff moved; re-check that each Visual Proof still shows current UI.'
  )
  for (const row of rows) {
    console.log(`  ${row.url}`)
  }
}

function printTable(rows, columns) {
  if (rows.length === 0) {
    return
  }
  const width = Object.fromEntries(
    columns.map((column) => [
      column,
      Math.max(column.length, ...rows.map((row) => String(row[column]).length))
    ])
  )
  const line = (cells) =>
    columns.map((column) => String(cells[column]).padEnd(width[column])).join('  ')
  console.log(line(Object.fromEntries(columns.map((column) => [column, column.toUpperCase()]))))
  for (const row of rows) {
    console.log(line(row))
  }
}
