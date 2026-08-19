// Author: Zihan Wang
// <wangzh011031@163.com>
import assert from 'node:assert/strict'
import test from 'node:test'
import { acceleratorFromKeyboardEvent } from '../plugins/client/src/client/desktop/accelerators.ts'

test('captures a command-or-control shortcut from a settings keydown', () => {
  assert.equal(acceleratorFromKeyboardEvent({
    key: 'd',
    code: 'KeyD',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
  }), 'CommandOrControl+Shift+D')
  assert.equal(acceleratorFromKeyboardEvent({
    key: 'k',
    code: 'KeyK',
    metaKey: false,
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
  }), 'CommandOrControl+Alt+K')
})

test('ignores unmodified and modifier-only keydowns', () => {
  assert.equal(acceleratorFromKeyboardEvent({
    key: 'd',
    code: 'KeyD',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
  }), undefined)
  assert.equal(acceleratorFromKeyboardEvent({
    key: 'Meta',
    code: 'MetaLeft',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
  }), undefined)
})
