import assert from 'node:assert/strict'
import test from 'node:test'
import { turnRailMarkWidth } from '../plugins/client/src/client/turn-rail/turns.ts'

test('centers the turn rail width ladder on the selected turn', () => {
  assert.deepEqual(
    Array.from({ length: 9 }, (_, index) => turnRailMarkWidth(index, 4)),
    [10, 10, 14, 18, 24, 18, 14, 10, 10],
  )
})

test('keeps every mark short until a center is available', () => {
  assert.deepEqual(
    Array.from({ length: 4 }, (_, index) => turnRailMarkWidth(index, -1)),
    [10, 10, 10, 10],
  )
})
