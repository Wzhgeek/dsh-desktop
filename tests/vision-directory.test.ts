// Author: Zihan Wang
// <wangzh011031@163.com>
import assert from 'node:assert/strict'
import test from 'node:test'
import { hasModlensTwin } from '../plugins/client/src/client/model/unwrap.ts'
import { maskDirectoryState } from '../plugins/client/src/client/vision/directory.ts'

test('hasModlensTwin sees the DeepSeek wrap and skips native-vision ids', () => {
  const groups = [
    { id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] },
    { id: 'deepseek-modlens', models: [{ id: 'deepseek-v4-flash' }] },
    { id: 'zhhc', models: [{ id: 'gpt-5.6-sol' }, { id: 'deepseek-v4-flash' }] },
    { id: 'modlens-zhhc', models: [{ id: 'deepseek-v4-flash' }] },
  ]
  assert.equal(hasModlensTwin(groups, 'deepseek-official', 'deepseek-v4-flash'), true)
  assert.equal(hasModlensTwin(groups, 'zhhc', 'deepseek-v4-flash'), true)
  assert.equal(hasModlensTwin(groups, 'zhhc', 'gpt-5.6-sol'), false)
})

test('maskDirectoryState hides twins and unwraps the current route', () => {
  const masked = maskDirectoryState({
    current: { provider: 'deepseek-modlens', model: 'deepseek-v4-flash' },
    routable: true,
    groups: [
      {
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [{ id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' }],
      },
      {
        id: 'deepseek-modlens',
        name: 'DeepSeek (modlens vision)',
        models: [{ id: 'deepseek-v4-flash', name: 'deepseek-v4-flash (modlens vision)' }],
      },
    ],
    failures: [],
    status: 'ready',
    error: null,
  } as Parameters<typeof maskDirectoryState>[0])
  assert.equal(masked.current?.provider, 'deepseek-official')
  assert.equal(masked.groups.some(group => group.id === 'deepseek-modlens'), false)
  assert.equal(masked.groups[0]?.models.some(model => /\(modlens vision\)/i.test(model.name)), false)
})
