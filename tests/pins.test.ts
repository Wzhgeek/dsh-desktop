// Author: Zihan Wang
// <wangzh011031@163.com>
import assert from 'node:assert/strict'
import test from 'node:test'
import { isPinned, MAX_PINS, parsePins, pinItem, togglePin, unpinItem } from '../plugins/client/src/client/pins/store.ts'
import { bindingsForGroup, relativeLabel } from '../plugins/client/src/client/pins/match.ts'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'

test('parses, toggles, and bounds the pin list', () => {
  const original = globalThis.localStorage
  const memory = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value) },
      removeItem: (key: string) => { memory.delete(key) },
    },
  })
  try {
    assert.deepEqual(parsePins([{ type: 'session', id: 's1', pinnedAt: 3 }, { type: 'workspace', id: 'w1' }]), [
      { type: 'session', id: 's1', pinnedAt: 3 },
      { type: 'workspace', id: 'w1', pinnedAt: 0 },
    ])
    assert.deepEqual(parsePins([{ type: 'session', id: 's1\u0000' }]), [])
    pinItem('session', 'a', 1)
    pinItem('workspace', 'b', 2)
    assert.equal(isPinned('session', 'a'), true)
    togglePin('session', 'a')
    assert.equal(isPinned('session', 'a'), false)
    unpinItem('workspace', 'b')
    for (let index = 0; index < MAX_PINS + 4; index += 1) pinItem('session', `s-${String(index)}`, index)
    assert.equal(parsePins(JSON.parse(memory.get('dsh-desktop:pins:v1') ?? '[]')).length, MAX_PINS)
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original })
  }
})

test('binds sidebar group titles back to workspace and session ids', () => {
  const sessions = {
    ids: ['s1', 's2', 's3'],
    byId: {
      s1: { id: 's1', displayTitle: '模型身份询问', blank: false, running: false, updatedAt: 3 },
      s2: { id: 's2', displayTitle: '新会话', blank: true, running: false, updatedAt: 2 },
      s3: { id: 's3', displayTitle: '阅读项目', blank: false, running: false, updatedAt: 1 },
    },
    current: 's1',
    phase: 'ready',
    subagentsByParent: {},
  } as unknown as SessionListState
  const workspaces = {
    items: [{
      workspaceId: 'w1',
      path: '/tmp/demo',
      title: 'Test_dsh',
      sessionIds: ['s1', 's3'],
      createdAt: '',
      updatedAt: '',
    }],
    archivedSessionIds: [],
    recentWorkspaceId: 'w1',
  } as unknown as WorkspaceListState
  assert.deepEqual(bindingsForGroup('Test_dsh', ['模型身份询问', '阅读项目'], sessions, workspaces), {
    workspace: { type: 'workspace', id: 'w1' },
    sessions: [{ type: 'session', id: 's1' }, { type: 'session', id: 's3' }],
  })
  assert.equal(relativeLabel(Date.now() - 1_000), '刚刚')
  assert.equal(relativeLabel(Date.now() - 3 * 3_600_000), '3小时')
})
