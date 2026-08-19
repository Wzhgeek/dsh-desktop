// Author: Zihan Wang
// <wangzh011031@163.com>
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { parseDesktopCommand } from './desktop-ipc.ts'
import {
  parsePtyCreateRequest,
  parsePtyKillRequest,
  parsePtyResizeRequest,
  parsePtyWriteRequest,
  MAX_PTY_SESSIONS,
} from './desktop-pty.ts'

test('accepts a bounded PTY create request and rejects bad sizes', () => {
  assert.deepEqual(parsePtyCreateRequest({ cols: 80, rows: 24, cwd: '/tmp/project' }), {
    cols: 80,
    rows: 24,
    cwd: resolve('/tmp/project'),
  })
  assert.deepEqual(parsePtyCreateRequest({ cols: 80, rows: 24 }), { cols: 80, rows: 24 })
  assert.equal(parsePtyCreateRequest({ cols: 2, rows: 24 }), undefined)
  assert.equal(parsePtyCreateRequest({ cols: 80, rows: 24, cwd: '/tmp/a\u0000b' }), undefined)
})

test('bounds write, resize, and kill payloads', () => {
  assert.deepEqual(parsePtyWriteRequest({ id: 'pty-1', data: 'ls\n' }), { id: 'pty-1', data: 'ls\n' })
  assert.equal(parsePtyWriteRequest({ id: 'pty-1', data: '' }), undefined)
  assert.equal(parsePtyWriteRequest({ id: '../x', data: 'a' }), undefined)
  assert.deepEqual(parsePtyResizeRequest({ id: 'pty-1', cols: 120, rows: 30 }), { id: 'pty-1', cols: 120, rows: 30 })
  assert.equal(parsePtyResizeRequest({ id: 'pty-1', cols: 8, rows: 30 }), undefined)
  assert.deepEqual(parsePtyKillRequest({ id: 'pty-1' }), { id: 'pty-1' })
  assert.equal(parsePtyKillRequest({ id: '' }), undefined)
})

test('caps concurrent PTY sessions', () => {
  assert.equal(MAX_PTY_SESSIONS, 8)
})

test('accepts the toggle-terminal native command', () => {
  assert.deepEqual(parseDesktopCommand({ command: 'toggle-terminal' }), { command: 'toggle-terminal' })
})
