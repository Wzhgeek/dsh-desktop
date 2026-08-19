// Author: Zihan Wang
// <wangzh011031@163.com>
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isModlensWrapperProvider,
  parseSelection,
  unwrapModlensProvider,
  unwrapModlensSelection,
  wrapModlensProvider,
  wrapModlensSelection,
} from '../src/host/model-pref.ts'

test('parseSelection accepts nested selection payloads', () => {
  assert.deepEqual(
    parseSelection({ selection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }),
    { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  )
})

test('parseSelection keeps optional reasoningEffort', () => {
  assert.deepEqual(
    parseSelection({ provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' }),
    { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
  )
})

test('parseSelection rejects incomplete bodies', () => {
  assert.equal(parseSelection({ provider: 'x' }), undefined)
  assert.equal(parseSelection(null), undefined)
})

test('unwraps the DeepSeek ModLens twin back to official', () => {
  assert.equal(unwrapModlensProvider('deepseek-modlens'), 'deepseek-official')
  assert.deepEqual(
    unwrapModlensSelection({
      provider: 'deepseek-modlens',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    }),
    { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
  )
})

test('unwraps auto-discovered ModLens twins by provider prefix', () => {
  assert.equal(unwrapModlensProvider('modlens-zhhc'), 'zhhc')
  assert.equal(isModlensWrapperProvider('modlens-zhhc'), true)
  assert.equal(isModlensWrapperProvider('zhhc'), false)
  assert.equal(isModlensWrapperProvider('deepseek-official'), false)
})

test('parseSelection unwraps ModLens wrappers before persist', () => {
  assert.deepEqual(
    parseSelection({ provider: 'deepseek-modlens', model: 'deepseek-v4-flash' }),
    { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  )
})

test('wraps a catalog twin without touching native-vision models', () => {
  assert.equal(wrapModlensProvider('zhhc'), 'modlens-zhhc')
  assert.equal(wrapModlensProvider('deepseek-official'), 'deepseek-modlens')
  const groups = [
    { id: 'zhhc', models: [{ id: 'deepseek-v4-flash' }, { id: 'gpt-5.6-sol' }] },
    { id: 'modlens-zhhc', models: [{ id: 'deepseek-v4-flash' }] },
  ]
  assert.deepEqual(
    wrapModlensSelection({ provider: 'zhhc', model: 'deepseek-v4-flash' }, groups),
    { provider: 'modlens-zhhc', model: 'deepseek-v4-flash' },
  )
  assert.deepEqual(
    wrapModlensSelection({ provider: 'zhhc', model: 'gpt-5.6-sol' }, groups),
    { provider: 'zhhc', model: 'gpt-5.6-sol' },
  )
})
