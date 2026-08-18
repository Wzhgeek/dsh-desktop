// Author: Zihan Wang
// <wangzh011031@163.com>
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPullRequestBody, githubLoginArgs, parseGitHubChecks, parseGitHubDeviceLogin } from './github-host.ts'

test('normalizes GitHub check runs and commit statuses', () => {
  assert.deepEqual(parseGitHubChecks([
    { name: 'unit', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/example/check/1' },
    { name: 'build', status: 'IN_PROGRESS', conclusion: '', detailsUrl: 'https://github.com/example/check/2' },
    { context: 'lint', state: 'FAILURE', targetUrl: 'https://github.com/example/check/3' },
  ]), [
    { name: 'unit', state: 'passed', url: 'https://github.com/example/check/1' },
    { name: 'build', state: 'pending', url: 'https://github.com/example/check/2' },
    { name: 'lint', state: 'failed', url: 'https://github.com/example/check/3' },
  ])
})

test('appends details and a validated closing issue to the PR template', () => {
  assert.equal(
    buildPullRequestBody('## Summary\n\n- Describe.', 'Adds the project view.', '#123'),
    '## Summary\n\n- Describe.\n\nAdds the project view.\n\nFixes #123',
  )
  assert.doesNotMatch(buildPullRequestBody('Template', '', 'not-an-issue'), /Fixes/)
})

test('builds a non-interactive browser login command', () => {
  assert.deepEqual(githubLoginArgs(), [
    'auth', 'login',
    '--hostname', 'github.com',
    '--git-protocol', 'https',
    '--web',
    '--skip-ssh-key',
  ])
})

test('parses GitHub device login output', () => {
  assert.deepEqual(
    parseGitHubDeviceLogin('\n! First copy your one-time code: 95FE-B08C\nOpen this URL to continue in your web browser: https://github.com/login/device\n'),
    { code: '95FE-B08C', url: 'https://github.com/login/device' },
  )
})

