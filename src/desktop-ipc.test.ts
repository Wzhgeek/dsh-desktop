import assert from 'node:assert/strict'
import test from 'node:test'
import { parseOpenPathRequest } from './desktop-ipc.ts'

test('accepts bounded renderer path requests', () => {
  assert.deepEqual(parseOpenPathRequest({ path: 'src/main.ts:42:3', cwd: '/tmp/project', opener: 'vscode' }), {
    path: 'src/main.ts:42:3',
    cwd: '/tmp/project',
    opener: 'vscode',
  })
})

test('rejects control characters and malformed path requests', () => {
  assert.equal(parseOpenPathRequest({ path: '' }), undefined)
  assert.equal(parseOpenPathRequest({ path: '/tmp/a\u0000b' }), undefined)
  assert.equal(parseOpenPathRequest({ path: '/tmp/file', cwd: 42 }), undefined)
  assert.equal(parseOpenPathRequest({ path: '/tmp/file', opener: 'unknown' }), undefined)
})
