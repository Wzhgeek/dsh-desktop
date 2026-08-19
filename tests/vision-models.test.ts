// Author: Zihan Wang
// <wangzh011031@163.com>
import assert from 'node:assert/strict'
import test from 'node:test'
import { looksNativeVision, patchNativeVisionSettings } from '../src/host/vision-models.ts'

test('looksNativeVision covers gateway GPT/Claude/Gemini ids', () => {
  assert.equal(looksNativeVision('gpt-5.6-sol'), true)
  assert.equal(looksNativeVision('gpt-5.5'), true)
  assert.equal(looksNativeVision('claude-opus-4-6'), true)
  assert.equal(looksNativeVision('gemini-3.5-flash'), true)
  assert.equal(looksNativeVision('deepseek-v4-flash'), false)
  assert.equal(looksNativeVision('mimo-v2.5'), false)
})

test('patchNativeVisionSettings adds image input only to vision models', () => {
  const source = `llm-pi-ai:
  providers:
    {
      zhhc:
        {
          models:
            [
              { id: gpt-5.6-sol },
              { id: deepseek-v4-flash },
              { id: claude-opus-5, input: [text, image] }
            ]
        }
    }
`
  const next = patchNativeVisionSettings(source)
  assert.match(next, /id: gpt-5\.6-sol,\s*input: \[text, image\]/)
  assert.match(next, /\{ id: deepseek-v4-flash \}/)
  assert.equal((next.match(/claude-opus-5, input: \[text, image\]/g) ?? []).length, 1)
})
