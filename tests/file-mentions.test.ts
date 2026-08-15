import assert from 'node:assert/strict'
import test from 'node:test'
import { mentionAt } from '../plugins/client/src/client/mentions/token.ts'

test('finds a composer file mention at the caret', () => {
  assert.deepEqual(mentionAt('@src/ma', 7), { start: 0, end: 7, query: 'src/ma' })
  assert.deepEqual(mentionAt('查看 @main', 8), { start: 3, end: 8, query: 'main' })
  assert.deepEqual(mentionAt('prefix @ suffix', 8), { start: 7, end: 8, query: '' })
})

test('ignores email-like and completed mention tokens', () => {
  assert.equal(mentionAt('user@example.com', 16), undefined)
  assert.equal(mentionAt('查看 @main 后续', 11), undefined)
  assert.equal(mentionAt('查看 @main', 2), undefined)
})
