// Author: Zihan Wang
// <wangzh011031@163.com>
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_TERMINAL_TABS,
  nextTerminalTitle,
  withActiveTab,
  withAddedTab,
  withoutTab,
  type TerminalState,
  type TerminalTab,
} from '../plugins/client/src/client/terminal/store.ts'
import { MAX_PTY_SESSIONS } from '../src/desktop-pty.ts'

const empty: TerminalState = {
  open: false,
  placement: 'bottom',
  size: 280,
  tabs: [],
  activeId: undefined,
}

test('titles fill gaps after a close', () => {
  assert.equal(nextTerminalTitle([]), '终端 1')
  assert.equal(nextTerminalTitle(['终端 1', '终端 2']), '终端 3')
  assert.equal(nextTerminalTitle(['终端 2']), '终端 1')
})

test('adding a tab opens the dock and selects it', () => {
  const first: TerminalTab = { id: 'term-1', title: '终端 1' }
  const opened = withAddedTab(empty, first)
  assert.equal(opened.open, true)
  assert.deepEqual(opened.tabs, [first])
  assert.equal(opened.activeId, 'term-1')
  const second = withAddedTab(opened, { id: 'term-2', title: '终端 2' })
  assert.equal(second.tabs.length, 2)
  assert.equal(second.activeId, 'term-2')
})

test('closing the last tab shuts the dock; closing one keeps the others', () => {
  const two = withAddedTab(
    withAddedTab(empty, { id: 'term-1', title: '终端 1' }),
    { id: 'term-2', title: '终端 2' },
  )
  const afterFirst = withoutTab(two, 'term-1')
  assert.equal(afterFirst.tabs.length, 1)
  assert.equal(afterFirst.activeId, 'term-2')
  const closed = withoutTab(afterFirst, 'term-2')
  assert.equal(closed.open, false)
  assert.deepEqual(closed.tabs, [])
  assert.equal(closed.activeId, undefined)
})

test('selecting a tab is a no-op for unknown ids', () => {
  const opened = withAddedTab(empty, { id: 'term-1', title: '终端 1' })
  assert.equal(withActiveTab(opened, 'missing'), opened)
  const two = withAddedTab(opened, { id: 'term-2', title: '终端 2' })
  assert.equal(withActiveTab(two, 'term-1').activeId, 'term-1')
})

test('tab cap matches the host PTY cap', () => {
  assert.equal(MAX_TERMINAL_TABS, MAX_PTY_SESSIONS)
  let current = empty
  for (let index = 1; index <= MAX_TERMINAL_TABS + 2; index += 1) {
    current = withAddedTab(current, { id: `term-${String(index)}`, title: `终端 ${String(index)}` })
  }
  assert.equal(current.tabs.length, MAX_TERMINAL_TABS)
})
