// Author: Zihan Wang
// <wangzh011031@163.com>
import assert from 'node:assert/strict'
import test from 'node:test'
import { entryIdsFromBundlePatch, setPatchDisabled, shippedBundles } from '../src/host/installed.ts'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('shipped bundles exclude web template layers', () => {
  const shipped = shippedBundles('web')
  assert.equal(shipped.has('@deepseek-ai/dsh-base'), true)
  assert.equal(shipped.has('@deepseek-ai/dsh-web-app'), true)
  assert.equal(shipped.has('@liustack/modlens'), false)
})

test('setPatchDisabled toggles id rows without dropping other patches', () => {
  const base = [{ insert: [{ id: 'keep', name: 'x' }] }, { id: 'modlens', disabled: true }]
  const enabled = setPatchDisabled(base, ['modlens'], false)
  assert.equal(enabled.some(row => typeof row === 'object' && row !== null && (row as { id?: string }).id === 'modlens'), false)
  assert.equal(enabled.length, 1)
  const disabled = setPatchDisabled(enabled, ['modlens'], true)
  assert.deepEqual(disabled.at(-1), { id: 'modlens', disabled: true })
})

test('reads insert ids from a bundle patch file', async () => {
  const dir = join(tmpdir(), `dsh-installed-${String(Date.now())}`)
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'cordis.patch.yml')
  await writeFile(path, '- insert:\n    - id: modlens\n      name: "@liustack/modlens"\n', 'utf8')
  assert.deepEqual(entryIdsFromBundlePatch(path), ['modlens'])
  await rm(dir, { recursive: true, force: true })
})
