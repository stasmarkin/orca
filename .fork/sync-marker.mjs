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

/**
 * Matched as a whole subject line, and only among the commits this fork adds on top of upstream.
 * A --grep for the phrase would also hit an ordinary commit that merely mentions it in its body,
 * and everything below that false marker would be reported as drift.
 * @param {string} ref @param {string} base @returns {string | null}
 */
export function findMarker(ref, base) {
  if (!exists(ref)) {
    return null
  }
  const own = git(['log', '--format=%H%x00%s', ref, '--not', base]).split('\n').filter(Boolean)
  const hit = own.find((line) => line.split('\0')[1] === SUBJECT)
  return hit === undefined ? null : hit.split('\0')[0]
}

/**
 * @param {string} ref
 * @param {string} base
 * @returns {{state: 'clean' | 'drifted' | 'unmanaged', marker: string | null, extra: string[]}}
 */
export function inspectDrift(ref, base) {
  const marker = findMarker(ref, base)
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
