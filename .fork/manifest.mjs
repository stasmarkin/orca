// Reads and validates .fork/features.yaml. Anything malformed fails here rather than halfway
// through a rebuild, when fork main has already been partly reassembled.
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

import { exists, repoRoot } from './git-commands.mjs'

export const KINDS = ['upstream', 'fork-only', 'frozen']
const MANIFEST_PATH = `${repoRoot()}.fork/features.yaml`

/** @typedef {{id: string, branch: string, pr: number | null, kind: string, since: string, why: string}} Feature */

/** @param {string} [path] @returns {Feature[]} */
export function readFeatures(path = MANIFEST_PATH) {
  const raw = parse(readFileSync(path, 'utf8'))
  const list = raw?.features
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`${path}: expected a non-empty "features" list`)
  }

  const seenIds = new Set()
  const seenBranches = new Set()
  return list.map((entry, index) => {
    const at = `${path}: features[${index}]`
    const feature = {
      id: requireString(entry?.id, `${at}.id`),
      branch: requireString(entry?.branch, `${at}.branch`),
      pr:
        entry?.pr === null || entry?.pr === undefined ? null : requireNumber(entry.pr, `${at}.pr`),
      kind: requireString(entry?.kind, `${at}.kind`),
      since: requireString(entry?.since, `${at}.since`),
      why: requireString(entry?.why, `${at}.why`)
    }
    if (!KINDS.includes(feature.kind)) {
      throw new Error(`${at}.kind: "${feature.kind}" is not one of ${KINDS.join(', ')}`)
    }
    if (seenIds.has(feature.id)) {
      throw new Error(`${at}.id: duplicate id "${feature.id}"`)
    }
    if (seenBranches.has(feature.branch)) {
      throw new Error(`${at}.branch: duplicate "${feature.branch}"`)
    }
    seenIds.add(feature.id)
    seenBranches.add(feature.branch)
    return feature
  })
}

/**
 * Features that make up fork main, in merge order: upstream work first, fork-only tooling last so
 * its commits cannot be picked up by a branch prepared for a pull request.
 * @param {Feature[]} features
 */
export function buildOrder(features) {
  return [
    ...features.filter((feature) => feature.kind === 'upstream'),
    ...features.filter((feature) => feature.kind === 'fork-only')
  ]
}

/** @param {Feature[]} features */
export function assertBranchesExist(features) {
  const missing = features.filter((feature) => feature.kind !== 'frozen' && !exists(feature.branch))
  if (missing.length > 0) {
    throw new Error(
      `Manifest names branches that do not exist: ${missing.map((f) => f.branch).join(', ')}`
    )
  }
}

function requireString(value, at) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${at}: expected a non-empty string`)
  }
  return value.trim()
}

function requireNumber(value, at) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${at}: expected an integer`)
  }
  return value
}
