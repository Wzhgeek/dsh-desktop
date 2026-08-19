// Author: Zihan Wang
// <wangzh011031@163.com>
import assert from 'node:assert/strict'
import { basename, resolve } from 'node:path'
import test from 'node:test'
import {
  acceleratorFromKeyboardEvent,
  canonicalizeAccelerator,
  DEFAULT_SHOW_WINDOW_ACCELERATOR,
  formatAcceleratorLabel,
  MAX_RECENT_WORKSPACES,
  normalizeShowWindowAccelerator,
  parsePersistedDesktopState,
  parseRememberWorkspaceRequest,
  recentWorkspaceLabel,
  rememberRecentWorkspace,
  removeRecentWorkspace,
} from './desktop-shell.ts'

test('moves a remembered workspace to the front and keeps the bound', () => {
  const first = rememberRecentWorkspace([], { path: '/tmp/alpha', title: 'Alpha' }, 1)
  const second = rememberRecentWorkspace(first, { path: '/tmp/beta' }, 2)
  const again = rememberRecentWorkspace(second, { path: '/tmp/alpha' }, 3)
  assert.equal(again[0]?.path, resolve('/tmp/alpha'))
  assert.equal(again[0]?.title, 'Alpha')
  assert.equal(again[1]?.path, resolve('/tmp/beta'))
  const overflow = Array.from({ length: MAX_RECENT_WORKSPACES + 3 }, (_, index) => `/tmp/project-${String(index)}`)
    .reduce((recents, path, index) => rememberRecentWorkspace(recents, { path }, index + 10), again)
  assert.equal(overflow.length, MAX_RECENT_WORKSPACES)
  assert.equal(overflow[0]?.path, resolve(`/tmp/project-${String(MAX_RECENT_WORKSPACES + 2)}`))
})

test('rejects control characters and accepts a bounded remember request', () => {
  assert.equal(parseRememberWorkspaceRequest({ path: '' }), undefined)
  assert.equal(parseRememberWorkspaceRequest({ path: '/tmp/a\u0000b' }), undefined)
  assert.deepEqual(parseRememberWorkspaceRequest({ path: '/tmp/project/', title: ' Demo ' }), {
    path: resolve('/tmp/project'),
    title: 'Demo',
  })
})

test('removes one recent workspace and labels the rest by title or basename', () => {
  const recents = rememberRecentWorkspace(
    rememberRecentWorkspace([], { path: '/tmp/alpha', title: 'Alpha' }, 1),
    { path: '/tmp/beta' },
    2,
  )
  assert.equal(recentWorkspaceLabel(recents[0] ?? { path: '/tmp/beta', openedAt: 2 }), 'beta')
  assert.equal(recentWorkspaceLabel({ path: '/tmp/alpha', title: 'Alpha', openedAt: 1 }), 'Alpha')
  assert.deepEqual(removeRecentWorkspace(recents, '/tmp/beta').map(entry => basename(entry.path)), ['alpha'])
})

test('canonicalizes show-window accelerators and keyboard capture', () => {
  assert.equal(normalizeShowWindowAccelerator('CmdOrCtrl+Shift+d'), DEFAULT_SHOW_WINDOW_ACCELERATOR)
  assert.equal(normalizeShowWindowAccelerator('Shift+D'), DEFAULT_SHOW_WINDOW_ACCELERATOR)
  assert.equal(canonicalizeAccelerator('Control+Alt+Shift+K'), 'CommandOrControl+Alt+Shift+K')
  assert.equal(acceleratorFromKeyboardEvent({
    key: 'd',
    code: 'KeyD',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
  }), DEFAULT_SHOW_WINDOW_ACCELERATOR)
  assert.equal(acceleratorFromKeyboardEvent({
    key: 'd',
    code: 'KeyD',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
  }), undefined)
  assert.equal(formatAcceleratorLabel(DEFAULT_SHOW_WINDOW_ACCELERATOR, 'darwin'), '⌘⇧D')
  assert.equal(formatAcceleratorLabel(DEFAULT_SHOW_WINDOW_ACCELERATOR, 'linux'), 'Ctrl+Shift+D')
})

test('reads mixed persisted desktop state without dropping a valid session', () => {
  assert.deepEqual(parsePersistedDesktopState({
    activeSessionId: 'session-1',
    showWindowAccelerator: 'CommandOrControl+Alt+K',
    recentWorkspaces: [{ path: '/tmp/project', title: 'Demo', openedAt: 9 }],
  }), {
    activeSessionId: 'session-1',
    showWindowAccelerator: 'CommandOrControl+Alt+K',
    recentWorkspaces: [{ path: resolve('/tmp/project'), title: 'Demo', openedAt: 9 }],
  })
})
