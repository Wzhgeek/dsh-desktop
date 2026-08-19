// Author: Zihan Wang
// <wangzh011031@163.com>
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyVisionPatch,
  keyHint,
  parseModlensFile,
  parseVisionPatch,
  resolveProvider,
  toPublicView,
} from '../src/host/vision-engine.ts'

const SAMPLE_KEY = 'AIzaSyDummyTestKeyForHintCheck1234'

test('parseVisionPatch accepts gemini and openai fields and rejects junk', () => {
  assert.deepEqual(
    parseVisionPatch({ provider: 'gemini-api', geminiApiKey: SAMPLE_KEY }),
    { provider: 'gemini-api', geminiApiKey: SAMPLE_KEY },
  )
  assert.deepEqual(
    parseVisionPatch({ provider: 'openai', openaiBaseUrl: 'https://example.com/v1', openaiModel: 'gpt-4o' }),
    { provider: 'openai', openaiBaseUrl: 'https://example.com/v1', openaiModel: 'gpt-4o' },
  )
  assert.equal(parseVisionPatch({}), undefined)
  assert.equal(parseVisionPatch({ provider: 'claude-cli' }), undefined)
  assert.equal(parseVisionPatch({ geminiApiKey: 'short' }), undefined)
  assert.equal(parseVisionPatch({ openaiBaseUrl: 'javascript:alert(1)' }), undefined)
})

test('empty secrets keep the previous key', () => {
  const previous = parseModlensFile(JSON.stringify({
    provider: 'openai',
    providers: {
      'gemini-api': { apiKey: SAMPLE_KEY },
      openai: { apiKey: 'sk-keep-this-key-please', baseUrl: 'http://127.0.0.1:8317/v1' },
    },
  }))
  const next = applyVisionPatch(previous, { provider: 'gemini-api' })
  assert.equal(resolveProvider(next), 'gemini-api')
  assert.equal(
    (next.providers as { 'gemini-api': { apiKey: string } })['gemini-api'].apiKey,
    SAMPLE_KEY,
  )
})

test('public view never echoes the full key', () => {
  const view = toPublicView({
    provider: 'gemini-api',
    providers: { 'gemini-api': { apiKey: SAMPLE_KEY } },
  })
  assert.equal(view.geminiConfigured, true)
  assert.equal(view.geminiHint, keyHint(SAMPLE_KEY))
  assert.equal(JSON.stringify(view).includes(SAMPLE_KEY), false)
  assert.equal(keyHint('abcd'), '已配置')
})
