// Author: Zihan Wang
// <wangzh011031@163.com>
import assert from 'node:assert/strict'
import test from 'node:test'
import { dockBottomInsets } from '../plugins/client/src/client/terminal/layout.ts'

test('bottom dock insets follow the conversation column, not the sidebar', () => {
  assert.deepEqual(
    dockBottomInsets({ left: 0, right: 1200 }, { left: 280, right: 1200 }),
    { left: 280, right: 0 },
  )
})

test('bottom dock stays inside the conversation when a details column exists', () => {
  assert.deepEqual(
    dockBottomInsets({ left: 0, right: 1200 }, { left: 280, right: 900 }),
    { left: 280, right: 300 },
  )
})
