// Author: Zihan Wang
// <wangzh011031@163.com>
import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchJson } from '../plugins/client/src/client/project/http.ts'

test('reads a normal JSON payload', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, value: 42 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  try {
    const value = await fetchJson<{ ok: boolean; value: number }>('http://example.test', { method: 'GET' })
    assert.deepEqual(value, { ok: true, value: 42 })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('surfaces plain-text backend errors instead of JSON parse failures', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  try {
    await assert.rejects(
      () => fetchJson('http://example.test'),
      /not found/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects malformed JSON responses with the raw body', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('not found', { status: 200, headers: { 'content-type': 'text/plain' } })
  try {
    await assert.rejects(
      () => fetchJson('http://example.test'),
      /not found/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
