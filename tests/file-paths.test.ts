import assert from 'node:assert/strict'
import test from 'node:test'
import { parseFileReference } from '../plugins/client/src/client/desktop/file-paths.ts'

test('recognizes local paths and source locations', () => {
  assert.deepEqual(parseFileReference('/Volumes/code/src/main.ts:42:7'), {
    raw: '/Volumes/code/src/main.ts:42:7',
    path: '/Volumes/code/src/main.ts',
    line: 42,
    column: 7,
  })
  assert.deepEqual(parseFileReference('./src/main.ts#L12'), {
    raw: './src/main.ts#L12',
    path: './src/main.ts',
    line: 12,
  })
  assert.equal(parseFileReference('https://example.com/file.ts'), undefined)
  assert.equal(parseFileReference('main.ts'), undefined)
})
