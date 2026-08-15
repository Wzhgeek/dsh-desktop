import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeFileOpener } from '../plugins/client/src/client/desktop/file-openers.ts'

test('normalizes supported and stale file opener preferences', () => {
  assert.equal(normalizeFileOpener('vscode'), 'vscode')
  assert.equal(normalizeFileOpener('cursor'), 'cursor')
  assert.equal(normalizeFileOpener('finder'), 'finder')
  assert.equal(normalizeFileOpener('terminal'), 'terminal')
  assert.equal(normalizeFileOpener('unknown'), 'system')
  assert.equal(normalizeFileOpener(null), 'system')
})
