// Author: Zihan Wang
// <wangzh011031@163.com>
import assert from 'node:assert/strict'
import test from 'node:test'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { applyDesktopPatchOverrides } from './boot.ts'

test('re-enables agent instructions for desktop sessions', () => {
  const patches: PatchOptions[] = [{ id: 'agent-instructions', disabled: true }]
  applyDesktopPatchOverrides(patches, [])
  assert.deepEqual(patches.at(-1), { id: 'agent-instructions', disabled: false })
})

test('adds the shipped preset root override when agent presets exist', () => {
  const patches: PatchOptions[] = []
  applyDesktopPatchOverrides(patches, [{ id: 'agent-presets', config: { roots: [] } }])
  const presetPatch = patches.find(patch => patch.id === 'agent-presets')
  assert.equal(Array.isArray((presetPatch?.config as { roots?: unknown[] } | undefined)?.roots), true)
  assert.equal(((presetPatch?.config as { roots?: Array<{ path: string; trust: string }> }).roots?.[0]?.trust), 'system')
})
