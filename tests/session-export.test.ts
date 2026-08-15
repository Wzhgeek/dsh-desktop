import assert from 'node:assert/strict'
import test from 'node:test'
import { serializeConversation } from '../plugins/client/src/client/export/session-export.ts'

const snapshot = {
  sessionId: 'session-test',
  nodes: [
    { kind: 'user', seq: 1, time: Date.UTC(2026, 7, 14), content: [{ type: 'text', text: 'Inspect `src/main.ts`.' }], source: {} },
    {
      kind: 'assistant',
      seq: 2,
      time: Date.UTC(2026, 7, 14, 0, 0, 1),
      turn: 1,
      step: 1,
      blocks: [
        { kind: 'reasoning', text: 'Read the implementation.' },
        { kind: 'tool-call', callId: 'call-1', name: 'read', argsRaw: '{"path":"src/main.ts"}' },
        { kind: 'text', text: 'The file is valid.' },
      ],
    },
  ],
} as never

test('serializes a structured Markdown conversation', () => {
  const output = serializeConversation(snapshot, { id: 'session-test', displayTitle: 'Review', cwd: '/repo' } as never, 'markdown')
  assert.match(output, /^# Review/m)
  assert.match(output, /## User/)
  assert.match(output, /## Assistant/)
  assert.match(output, /<summary>Reasoning<\/summary>/)
  assert.match(output, /<summary>Tool · read<\/summary>/)
  assert.match(output, /The file is valid\./)
})

test('serializes the same conversation as readable plain text', () => {
  const output = serializeConversation(snapshot, undefined, 'text')
  assert.match(output, /USER ·/)
  assert.match(output, /ASSISTANT ·/)
  assert.match(output, /\[Tool · read\]/)
})
