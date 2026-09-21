// Post-sync report on the open upstream pull requests. Upstream CI does not run on fork pull
// requests, so UNSTABLE is normal here and mergeability is the only signal worth reading.
import { gh } from './git-commands.mjs'

const UPSTREAM = 'stablyai/orca'

/**
 * @param {{id: string, branch: string, pr: number}[]} open
 * @returns {{pr: number, branch: string, mergeable: string, status: string, url: string, headMatches: boolean}[]}
 */
export function refreshPullRequests(open, headShaByBranch) {
  return open.map(({ pr, branch }) => {
    const raw = gh([
      'pr',
      'view',
      String(pr),
      '--repo',
      UPSTREAM,
      '--json',
      'number,mergeable,mergeStateStatus,url,headRefOid'
    ])
    const view = JSON.parse(raw)
    return {
      pr,
      branch,
      mergeable: view.mergeable,
      status: view.mergeStateStatus,
      url: view.url,
      headMatches: view.headRefOid === headShaByBranch.get(branch)
    }
  })
}
