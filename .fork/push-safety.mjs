// Decides whether publishing a branch would destroy work the fork already holds.
//
// The naive check — "is the remote ahead of what I have" — is dead the moment a rebase is involved,
// because a rebased branch always carries commits the remote has never seen, and that is every sync.
// --force-with-lease does not cover it either: the lease is taken from the remote-tracking ref this
// sync just fetched, so it is satisfied by exactly the sha that carries the foreign commit.
//
// So a commit on the remote counts as foreign only when it has no patch-equivalent on either side we
// know about: the branch about to be published, and the sha this tool last published. Patch-id
// matching is what absorbs the rebased copies of our own commits, which are unreachable from the new
// history and would otherwise read as someone else's work.

/**
 * @param {{sha: string, remoteSha: string | null, baseline: string | null}} state
 * @param {(baseline: string, remoteSha: string) => number} countUnseen commits in remoteSha whose
 *   patch is absent from baseline
 * @returns {{action: 'create' | 'skip' | 'push' | 'refuse', lease?: string, unseen?: number}}
 */
export function inspectPush({ sha, remoteSha, baseline }, countUnseen) {
  if (remoteSha === null) {
    return { action: 'create' }
  }
  if (remoteSha === sha) {
    return { action: 'skip' }
  }
  // No baseline means fork main, whose equivalent guard is the sync marker: a commit made directly
  // to it is reported as drift before any of this runs.
  if (baseline === null) {
    return { action: 'push', lease: remoteSha }
  }
  // Against what is about to be published first, so the documented cure works: pull the foreign
  // commit into the feature branch and its patch is now on this side, which clears the refusal.
  const unseen = countUnseen(sha, remoteSha)
  if (unseen === 0) {
    return { action: 'push', lease: remoteSha }
  }
  // Then against what was last published, which covers the one case the first check cannot: a rebase
  // that resolved a conflict rewrites patch ids, so our own superseded commits look foreign.
  if (countUnseen(baseline, remoteSha) === 0) {
    return { action: 'push', lease: remoteSha }
  }
  return { action: 'refuse', unseen }
}
