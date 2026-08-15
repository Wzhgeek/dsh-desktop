import assert from 'node:assert/strict'
import test from 'node:test'
import { parseOpenPathRequest, parseUpdateState } from './desktop-ipc.ts'

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

test('accepts bounded updater snapshots', () => {
  assert.deepEqual(parseUpdateState({
    phase: 'downloading',
    currentVersion: '0.1.0-rc.5',
    availableVersion: '0.1.0-rc.6',
    progressPercent: 42.5,
    checkedAt: 1_700_000_000_000,
  }), {
    phase: 'downloading',
    currentVersion: '0.1.0-rc.5',
    availableVersion: '0.1.0-rc.6',
    progressPercent: 42.5,
    checkedAt: 1_700_000_000_000,
  })
})

test('rejects malformed updater snapshots', () => {
  assert.equal(parseUpdateState({ phase: 'unknown', currentVersion: '1.0.0' }), undefined)
  assert.equal(parseUpdateState({ phase: 'idle', currentVersion: '' }), undefined)
  assert.equal(parseUpdateState({ phase: 'downloading', currentVersion: '1.0.0', progressPercent: 101 }), undefined)
  assert.equal(parseUpdateState({ phase: 'error', currentVersion: '1.0.0', message: 'x'.repeat(1_001) }), undefined)
})
