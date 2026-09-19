// Upstream pull request state, fetched from GitHub rather than tracked by hand. One batched call
// covers every pull request, to stay inside the gh API rate limit.
import { gh } from './git-commands.mjs'

const UPSTREAM = 'stablyai/orca'

/** @returns {Map<number, {state: string, headRefName: string, headRefOid: string, url: string, mergedAt: string | null}>} */
export function readPullRequestStates() {
  const raw = gh([
    'pr',
    'list',
    '--repo',
    UPSTREAM,
    '--author',
    '@me',
    '--state',
    'all',
    '--limit',
    '100',
    '--json',
    'number,state,headRefName,headRefOid,url,mergedAt'
  ])
  const byNumber = new Map()
  for (const pr of JSON.parse(raw)) {
    byNumber.set(pr.number, pr)
  }
  return byNumber
}

/**
 * What a feature's pull request means for the next sync.
 * @param {{pr: number | null, kind: string}} feature
 * @param {Map<number, {state: string, mergedAt: string | null}>} states
 * @returns {{label: string, action: 'replay' | 'drop' | 'decide' | 'skip'}}
 */
export function classify(feature, states) {
  if (feature.kind === 'frozen') {
    return { label: 'frozen', action: 'skip' }
  }
  if (feature.kind === 'fork-only') {
    return { label: 'fork-only', action: 'replay' }
  }
  if (feature.pr === null) {
    return { label: 'no PR yet', action: 'replay' }
  }

  const pr = states.get(feature.pr)
  if (!pr) {
    return { label: `#${feature.pr} not found`, action: 'decide' }
  }
  if (pr.state === 'MERGED') {
    return { label: `#${feature.pr} MERGED`, action: 'drop' }
  }
  // Closed without a merge can mean either abandoned or superseded by an upstream fix; which one it
  // is decides whether the branch should still be replayed, and only a human knows.
  if (pr.state === 'CLOSED') {
    return { label: `#${feature.pr} CLOSED`, action: 'decide' }
  }
  return { label: `#${feature.pr} ${pr.state}`, action: 'replay' }
}
