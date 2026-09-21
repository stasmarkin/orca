import assert from 'node:assert/strict'
import { test } from 'node:test'

import { inspectPush } from './push-safety.mjs'

/** @param {Record<string, number>} pairs keyed "left...right" */
function counter(pairs) {
  return (left, right) => pairs[`${left}...${right}`] ?? 0
}

test('creates a branch the fork does not have', () => {
  assert.deepEqual(inspectPush({ sha: 'new', remoteSha: null, baseline: 'old' }, counter({})), {
    action: 'create'
  })
})

test('skips a branch the fork already holds at this sha', () => {
  assert.deepEqual(inspectPush({ sha: 'same', remoteSha: 'same', baseline: 'same' }, counter({})), {
    action: 'skip'
  })
})

test('pushes a rebased branch whose remote holds nothing new', () => {
  const decision = inspectPush(
    { sha: 'rebased', remoteSha: 'published', baseline: 'published' },
    counter({ 'rebased...published': 0 })
  )
  assert.deepEqual(decision, { action: 'push', lease: 'published' })
})

test('publishes after a sync that rebased but never pushed', () => {
  // The branch was rewritten locally while the fork kept the old history; those superseded commits
  // carry the same patches, so none of them reads as foreign.
  const decision = inspectPush(
    { sha: 'rebased-twice', remoteSha: 'published', baseline: 'published' },
    counter({ 'rebased-twice...published': 0 })
  )
  assert.equal(decision.action, 'push')
})

test('refuses when the fork holds a patch neither side knows', () => {
  const decision = inspectPush(
    { sha: 'rebased', remoteSha: 'published+suggestion', baseline: 'published' },
    counter({
      'rebased...published+suggestion': 1,
      'published...published+suggestion': 1
    })
  )
  assert.deepEqual(decision, { action: 'refuse', unseen: 1 })
})

test('stops refusing once the foreign commit is brought into the branch', () => {
  // The cure the error message prescribes: with the patch now on this side, nothing is foreign.
  const decision = inspectPush(
    { sha: 'rebased+suggestion', remoteSha: 'published+suggestion', baseline: 'published' },
    counter({
      'rebased+suggestion...published+suggestion': 0,
      'published...published+suggestion': 1
    })
  )
  assert.equal(decision.action, 'push')
})

test('does not refuse when a conflict resolution rewrote our own patch ids', () => {
  const decision = inspectPush(
    { sha: 'rebased-with-fixups', remoteSha: 'published', baseline: 'published' },
    counter({
      'rebased-with-fixups...published': 2,
      'published...published': 0
    })
  )
  assert.equal(decision.action, 'push')
})

test('pushes without a baseline, where the sync marker is the guard instead', () => {
  const decision = inspectPush(
    { sha: 'built', remoteSha: 'published', baseline: null },
    counter({ 'built...published': 3 })
  )
  assert.deepEqual(decision, { action: 'push', lease: 'published' })
})
