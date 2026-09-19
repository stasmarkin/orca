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

const BASE = 'origin/main'
const FORK_MAIN = 'fork/main'

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

function fetchRemotes() {
  git(['fetch', 'origin', 'main'])
  git(['fetch', 'fork'])
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
  fetchRemotes()
  const features = readFeatures()
  const states = readPullRequestStates()
  const baseSha = resolve(BASE)

  console.log(`upstream ${BASE} at ${baseSha.slice(0, 10)}`)
  console.log(
    `fork main ${exists(FORK_MAIN) ? resolve(FORK_MAIN).slice(0, 10) : '(none)'}, ${countBehind(FORK_MAIN, BASE)} commits behind upstream\n`
  )

  const rows = features.map((feature) => {
    const { label, action } = classify(feature, states)
    const behind = exists(feature.branch)
      ? countCommits(git(['merge-base', feature.branch, BASE]), baseSha)
      : 0
    return {
      id: feature.id,
      kind: feature.kind,
      upstream: label,
      behind: feature.kind === 'frozen' ? `${behind} (frozen)` : String(behind),
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

function check() {
  const drift = inspectDrift(FORK_MAIN)
  if (drift.state === 'clean') {
    console.log(`fork main is exactly the build recorded at ${drift.marker.slice(0, 10)}.`)
    return
  }
  if (drift.state === 'unmanaged') {
    console.log(
      'fork main carries no sync marker yet — the first sync will rebuild it from the manifest.'
    )
    console.log('Anything on fork main that is not in a manifest branch will be dropped.')
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
  fetchRemotes()
  if (!dryRun) {
    enableRerere()
  }

  const features = readFeatures()
  assertBranchesExist(features)
  const states = readPullRequestStates()

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

  const drift = inspectDrift(FORK_MAIN)
  if (drift.state === 'drifted' && !allowDrift) {
    throw new Error(
      `fork main has ${drift.extra.length} commit(s) not in any manifest branch:\n${drift.extra
        .map((line) => `  ${line}`)
        .join(
          '\n'
        )}\n\nRebuilding drops them. Move them into feature branches, or pass --allow-drift to discard.`
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

function pushEverything(rebased, built) {
  for (const row of rebased) {
    if (row.state !== 'rebased') {
      continue
    }
    const remote = `fork/${row.branch}`
    const lease = exists(remote)
      ? `--force-with-lease=${row.branch}:${resolve(remote)}`
      : '--force-with-lease'
    git(['push', lease, 'fork', `${row.after}:refs/heads/${row.branch}`])
    console.log(`pushed ${row.branch}`)
  }
  const mainLease = exists(FORK_MAIN)
    ? `--force-with-lease=main:${resolve(FORK_MAIN)}`
    : '--force-with-lease'
  git(['push', mainLease, 'fork', `${built.sha}:refs/heads/main`])
  console.log('pushed fork main')
}

function prs() {
  const features = readFeatures()
  const states = readPullRequestStates()
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
