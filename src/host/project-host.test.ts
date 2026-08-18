import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  detectProjectCommands,
  detectProjectMemory,
  parseRipgrepJson,
  summarizeRunOutput,
} from './project-host.ts'

test('parses structured ripgrep matches into source locations', () => {
  const root = join(tmpdir(), 'workspace')
  const output = `${JSON.stringify({
    type: 'match',
    data: {
      path: { text: './src/main.ts' },
      lines: { text: 'const answer = runTask()\n' },
      line_number: 42,
      submatches: [{ start: 15, end: 22, match: { text: 'runTask' } }],
    },
  })}\n`
  assert.deepEqual(parseRipgrepJson(root, output), [{
    path: join(root, 'src/main.ts'),
    relativePath: 'src/main.ts',
    line: 42,
    column: 16,
    preview: 'const answer = runTask()',
  }])
})

test('detects package-manager scripts and derives initial project memory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-host-'))
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', build: 'tsc', dev: 'vite' } }))
    await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    await writeFile(join(root, 'tsconfig.json'), '{}\n')
    const commands = await detectProjectCommands(root)
    assert.deepEqual(commands.map(command => command.display), ['pnpm run test', 'pnpm run build'])
    const memory = await detectProjectMemory(root, commands)
    assert.match(memory, /use pnpm, not npm or yarn/)
    assert.match(memory, /`pnpm run test`/)
    assert.match(memory, /TypeScript/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('summarizes common test result lines', () => {
  assert.deepEqual(summarizeRunOutput('Tests: 12 total\n10 passed, 2 failed\n'), {
    passed: 10,
    failed: 2,
    tests: 12,
  })
})

