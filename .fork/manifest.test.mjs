import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildOrder, readFeatures } from './manifest.mjs'

function manifestFile(body) {
  const path = join(mkdtempSync(join(tmpdir(), 'fork-manifest-')), 'features.yaml')
  writeFileSync(path, body)
  return path
}

const ENTRY = `
  - id: a
    branch: feat/a
    pr: 1
    kind: upstream
    since: 2026-01-01
    why: because
`

test('reads a feature and normalises a null pr', () => {
  const [feature] = readFeatures(
    manifestFile(`features:${ENTRY}
  - id: b
    branch: feat/b
    pr: null
    kind: fork-only
    since: 2026-01-02
    why: tooling
`)
  )
  assert.equal(feature.id, 'a')
  assert.equal(feature.pr, 1)
})

test('rejects an unknown kind', () => {
  assert.throws(
    () => readFeatures(manifestFile(`features:${ENTRY.replace('upstream', 'someday')}`)),
    /is not one of/
  )
})

test('rejects a duplicate branch', () => {
  assert.throws(
    () => readFeatures(manifestFile(`features:${ENTRY}${ENTRY.replace('id: a', 'id: c')}`)),
    /duplicate/
  )
})

test('rejects an empty manifest', () => {
  assert.throws(() => readFeatures(manifestFile('features: []')), /non-empty/)
})

test('rejects a missing why', () => {
  assert.throws(
    () => readFeatures(manifestFile(`features:${ENTRY.replace('    why: because\n', '')}`)),
    /why: expected a non-empty string/
  )
})

test('orders fork-only last and leaves frozen out of the build', () => {
  const features = [
    { id: 'tooling', kind: 'fork-only' },
    { id: 'old', kind: 'frozen' },
    { id: 'feature', kind: 'upstream' }
  ]
  assert.deepEqual(
    buildOrder(features).map((feature) => feature.id),
    ['feature', 'tooling']
  )
})
