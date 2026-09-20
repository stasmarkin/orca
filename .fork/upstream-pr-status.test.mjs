import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classify } from './upstream-pr-status.mjs'

const states = new Map([
  [1, { state: 'OPEN' }],
  [2, { state: 'MERGED' }],
  [3, { state: 'CLOSED' }]
])

test('a frozen feature is skipped without consulting its pull request', () => {
  assert.deepEqual(classify({ kind: 'frozen', pr: 2 }, states), { label: 'frozen', action: 'skip' })
})

test('fork-only work is always replayed', () => {
  assert.equal(classify({ kind: 'fork-only', pr: null }, states).action, 'replay')
})

test('a feature without a pull request is replayed', () => {
  assert.equal(classify({ kind: 'upstream', pr: null }, states).action, 'replay')
})

test('an open pull request is replayed', () => {
  assert.equal(classify({ kind: 'upstream', pr: 1 }, states).action, 'replay')
})

test('a merged pull request must be dropped, not replayed', () => {
  assert.deepEqual(classify({ kind: 'upstream', pr: 2 }, states), {
    label: '#2 MERGED',
    action: 'drop'
  })
})

test('a pull request closed without a merge needs a human', () => {
  assert.equal(classify({ kind: 'upstream', pr: 3 }, states).action, 'decide')
})

test('a pull request that is not in the fetched set needs a human', () => {
  assert.equal(classify({ kind: 'upstream', pr: 99 }, states).action, 'decide')
})
