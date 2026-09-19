// Fork main records its own recipe in an empty commit at its tip, so the build is verifiable from
// git alone: if the marker is not the tip, someone committed straight to fork main and that work
// would be lost by the next rebuild.
import { countCommits, exists, git, resolve } from './git-commands.mjs'

const SUBJECT = 'chore(fork): sync marker'

/** @param {{base: string, parts: {branch: string, sha: string}[]}} recipe */
export function markerMessage({ base, parts }) {
  const lines = [SUBJECT, '', `Fork-Base: ${base}`]
  for (const part of parts) {
    lines.push(`Fork-Feature: ${part.branch} ${part.sha}`)
  }
  return lines.join('\n')
}

/** @param {string} ref @returns {string | null} */
export function findMarker(ref) {
  if (!exists(ref)) {
    return null
  }
  const sha = git(
    ['log', '--format=%H', '--max-count=1', '--fixed-strings', `--grep=${SUBJECT}`, ref],
    {
      allowFail: true
    }
  )
  return sha === '' ? null : sha
}

/**
 * @param {string} ref
 * @returns {{state: 'clean' | 'drifted' | 'unmanaged', marker: string | null, extra: string[]}}
 */
export function inspectDrift(ref) {
  const marker = findMarker(ref)
  if (marker === null) {
    return { state: 'unmanaged', marker: null, extra: [] }
  }
  if (resolve(ref) === marker) {
    return { state: 'clean', marker, extra: [] }
  }
  const extra = git(['log', '--format=%h %s', `${marker}..${ref}`])
    .split('\n')
    .filter(Boolean)
  return { state: 'drifted', marker, extra }
}

/** @param {string} ref @param {string} base */
export function countBehind(ref, base) {
  return exists(ref) ? countCommits(ref, base) : 0
}
