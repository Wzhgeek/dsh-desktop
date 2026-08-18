// Author: Zihan Wang
// <wangzh011031@163.com>
/** GitHub CLI bridge for pull requests and CI state in the desktop Git panel. */

import { execFile, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { resolveWorkspaceRoot } from './workspace-root.ts'

export const name = 'desktop-github'
export const inject = ['webServer']

const MAX_BUFFER_BYTES = 4 * 1024 * 1024
const MAX_REQUEST_BYTES = 128 * 1024
const MAX_PR_TEXT = 32 * 1024

interface CliRun {
  code: number
  stdout: string
  stderr: string
}

export interface GitHubCheck {
  name: string
  state: 'passed' | 'failed' | 'pending' | 'neutral'
  url: string
}

export interface GitHubPullRequest {
  number: number
  title: string
  url: string
  state: string
  isDraft: boolean
  baseRefName: string
  headRefName: string
  checks: GitHubCheck[]
}

interface ActiveGitHubLogin {
  root: string
  child: ReturnType<typeof spawn>
  output: string
}

export function githubLoginArgs(): string[] {
  return ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--skip-ssh-key']
}

export function parseGitHubDeviceLogin(output: string): { code?: string; url?: string } {
  const code = /one-time code:\s*([A-Z0-9-]+)/i.exec(output)?.[1]
  const url = /Open this URL to continue in your web browser:\s*(https:\/\/\S+)/i.exec(output)?.[1]
  return {
    ...(code === undefined ? {} : { code }),
    ...(url === undefined ? {} : { url }),
  }
}

function runCli(command: string, args: readonly string[], cwd: string, input?: string): Promise<CliRun> {
  return new Promise(resolveRun => {
    const child = execFile(command, [...args], {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: MAX_BUFFER_BYTES,
      env: {
        ...process.env,
        LANG: 'C',
        LC_ALL: 'C',
        GH_PROMPT_DISABLED: '1',
        GH_NO_UPDATE_NOTIFIER: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
    }, (error, stdout, stderr) => {
      resolveRun({
        code: error === null ? 0 : typeof error.code === 'number' ? error.code : 127,
        stdout: String(stdout),
        stderr: String(stderr),
      })
    })
    if (input !== undefined && child.stdin !== null) {
      child.stdin.on('error', () => {})
      child.stdin.end(input)
    }
  })
}
let activeLogin: ActiveGitHubLogin | null = null

function cancelActiveLogin(root?: string): void {
  if (activeLogin === null) return
  if (root !== undefined && activeLogin.root !== root) return
  if (activeLogin.child.exitCode === null && activeLogin.child.killed !== true) activeLogin.child.kill()
  activeLogin = null
}

function startGitHubLogin(root: string): Promise<{ code: string; url: string }> {
  if (activeLogin !== null) {
    if (activeLogin.root !== root) throw new Error('Another GitHub login is already in progress.')
    const existing = parseGitHubDeviceLogin(activeLogin.output)
    if (typeof existing.code === 'string' && typeof existing.url === 'string') return Promise.resolve({ code: existing.code, url: existing.url })
  }
  return new Promise((resolveLogin, rejectLogin) => {
    const child = spawn('gh', githubLoginArgs(), {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GH_NO_UPDATE_NOTIFIER: '1',
      },
    })
    const current: ActiveGitHubLogin = { root, child, output: '' }
    activeLogin = current
    let settled = false
    const onChunk = (chunk: Buffer | string): void => {
      current.output += String(chunk)
      const parsed = parseGitHubDeviceLogin(current.output)
      if (!settled && typeof parsed.code === 'string' && typeof parsed.url === 'string') {
        settled = true
        resolveLogin({ code: parsed.code, url: parsed.url })
      }
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.once('error', (error) => {
      if (!settled) {
        settled = true
        rejectLogin(error)
      }
      if (activeLogin?.child === child) activeLogin = null
    })
    child.once('close', () => {
      if (!settled) {
        settled = true
        const parsed = parseGitHubDeviceLogin(current.output)
        if (typeof parsed.code === 'string' && typeof parsed.url === 'string') resolveLogin({ code: parsed.code, url: parsed.url })
        else rejectLogin(new Error(current.output.trim() || 'GitHub login did not return a browser authorization code.'))
      }
      if (activeLogin?.child === child) activeLogin = null
    })
  })
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_REQUEST_BYTES) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('request body must be an object')
  return value as Record<string, unknown>
}

function requestRoot(ctx: Context, req: IncomingMessage): { ok: true; root: string } | { ok: false; error: string } {
  const cwd = new URL(req.url ?? '/', 'http://localhost').searchParams.get('cwd') ?? undefined
  return resolveWorkspaceRoot(ctx, cwd, 'DSH_DESKTOP_GIT_ROOT')
}

function parseJson<T>(value: string): T | undefined {
  try { return JSON.parse(value) as T } catch { return undefined }
}

/** Normalize GitHub's heterogeneous check/run objects into four UI states. */
export function parseGitHubChecks(value: unknown): GitHubCheck[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(entry => {
    if (typeof entry !== 'object' || entry === null) return []
    const check = entry as Record<string, unknown>
    const name = typeof check.name === 'string' ? check.name : typeof check.context === 'string' ? check.context : 'Check'
    const url = typeof check.detailsUrl === 'string' ? check.detailsUrl : typeof check.targetUrl === 'string' ? check.targetUrl : ''
    const conclusion = String(check.conclusion ?? check.state ?? '').toUpperCase()
    const status = String(check.status ?? '').toUpperCase()
    const state: GitHubCheck['state'] = status !== '' && status !== 'COMPLETED'
      ? 'pending'
      : ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion)
        ? conclusion === 'SUCCESS' ? 'passed' : 'neutral'
        : ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(conclusion)
          ? 'failed'
          : ['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS'].includes(conclusion) ? 'pending' : 'neutral'
    return [{ name, state, url }]
  })
}

function parsePullRequest(value: unknown): GitHubPullRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const pr = value as Record<string, unknown>
  if (typeof pr.number !== 'number' || typeof pr.title !== 'string' || typeof pr.url !== 'string') return undefined
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: typeof pr.state === 'string' ? pr.state : 'OPEN',
    isDraft: pr.isDraft === true,
    baseRefName: typeof pr.baseRefName === 'string' ? pr.baseRefName : '',
    headRefName: typeof pr.headRefName === 'string' ? pr.headRefName : '',
    checks: parseGitHubChecks(pr.statusCheckRollup),
  }
}

async function repositoryRoot(root: string): Promise<{ ok: true; root: string; branch: string } | { ok: false; error: string }> {
  const [repository, branch] = await Promise.all([
    runCli('git', ['rev-parse', '--show-toplevel'], root),
    runCli('git', ['branch', '--show-current'], root),
  ])
  if (repository.code !== 0) return { ok: false, error: repository.stderr.trim() || 'not a Git repository' }
  return { ok: true, root: repository.stdout.trim(), branch: branch.stdout.trim() }
}

async function handleStatus(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const accepted = requestRoot(ctx, req)
  if (!accepted.ok) { writeJson(res, 403, { ok: false, error: accepted.error }); return }
  const repository = await repositoryRoot(accepted.root)
  if (!repository.ok) { writeJson(res, 200, { ok: true, available: false, authenticated: false, error: repository.error }); return }
  const version = await runCli('gh', ['--version'], repository.root)
  if (version.code !== 0) {
    writeJson(res, 200, { ok: true, available: false, authenticated: false, branch: repository.branch, error: 'GitHub CLI (gh) is not installed.' })
    return
  }
  const auth = await runCli('gh', ['auth', 'status', '--hostname', 'github.com'], repository.root)
  if (auth.code !== 0) {
    writeJson(res, 200, {
      ok: true, available: true, authenticated: false, branch: repository.branch,
      error: 'Run `gh auth login` to connect GitHub.',
    })
    return
  }
  const repo = await runCli('gh', ['repo', 'view', '--json', 'nameWithOwner,url,defaultBranchRef'], repository.root)
  if (repo.code !== 0) {
    writeJson(res, 200, { ok: true, available: true, authenticated: true, branch: repository.branch, error: repo.stderr.trim() || 'No GitHub repository is associated with this remote.' })
    return
  }
  const repositoryInfo = parseJson<{ nameWithOwner?: unknown; url?: unknown; defaultBranchRef?: { name?: unknown } }>(repo.stdout)
  const pr = repository.branch === '' ? { code: 0, stdout: '[]', stderr: '' } : await runCli('gh', [
    'pr', 'list', '--state', 'open', '--head', repository.branch, '--limit', '1',
    '--json', 'number,title,url,state,isDraft,baseRefName,headRefName,statusCheckRollup',
  ], repository.root)
  const list = pr.code === 0 ? parseJson<unknown[]>(pr.stdout) : []
  writeJson(res, 200, {
    ok: true,
    available: true,
    authenticated: true,
    branch: repository.branch,
    repository: {
      name: typeof repositoryInfo?.nameWithOwner === 'string' ? repositoryInfo.nameWithOwner : '',
      url: typeof repositoryInfo?.url === 'string' ? repositoryInfo.url : '',
      defaultBranch: typeof repositoryInfo?.defaultBranchRef?.name === 'string' ? repositoryInfo.defaultBranchRef.name : 'main',
    },
    pullRequest: parsePullRequest(list?.[0]) ?? null,
  })
}

async function handleLogin(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const accepted = requestRoot(ctx, req)
  if (!accepted.ok) { writeJson(res, 403, { ok: false, error: accepted.error }); return }
  const repository = await repositoryRoot(accepted.root)
  if (!repository.ok) { writeJson(res, 200, { ok: false, error: repository.error }); return }
  const version = await runCli('gh', ['--version'], repository.root)
  if (version.code !== 0) {
    writeJson(res, 200, { ok: false, error: 'GitHub CLI (gh) is not installed.' })
    return
  }
  try {
    const body = await readJson(req)
    if (body.action === 'cancel') {
      cancelActiveLogin(repository.root)
      writeJson(res, 200, { ok: true, cancelled: true })
      return
    }
    const auth = await runCli('gh', ['auth', 'status', '--hostname', 'github.com'], repository.root)
    if (auth.code === 0) {
      writeJson(res, 200, { ok: true, authenticated: true })
      return
    }
    const login = await startGitHubLogin(repository.root)
    writeJson(res, 200, { ok: true, ...login })
  } catch (error) {
    writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

async function readPullRequestTemplate(root: string): Promise<string> {
  const candidates = [
    '.github/pull_request_template.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'pull_request_template.md',
    'PULL_REQUEST_TEMPLATE.md',
  ]
  for (const candidate of candidates) {
    try {
      const value = await readFile(join(root, candidate), 'utf8')
      if (value.trim() !== '') return value.trim()
    } catch {
      // Continue through the conventional template locations.
    }
  }
  return ['## Summary', '', '- Describe the change.', '', '## Validation', '', '- [ ] Tests pass'].join('\n')
}

/** Compose the template-backed body and an optional issue-closing keyword. */
export function buildPullRequestBody(template: string, details: string, issue: string): string {
  const normalizedIssue = /^#?\d+$/.test(issue.trim()) ? issue.trim().replace(/^#/, '') : ''
  return [template.trim(), details.trim(), normalizedIssue === '' ? '' : `Fixes #${normalizedIssue}`]
    .filter(section => section !== '')
    .join('\n\n')
    .slice(0, MAX_PR_TEXT)
}

async function handleCreatePullRequest(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const accepted = requestRoot(ctx, req)
  if (!accepted.ok) { writeJson(res, 403, { ok: false, error: accepted.error }); return }
  const repository = await repositoryRoot(accepted.root)
  if (!repository.ok) { writeJson(res, 200, { ok: false, error: repository.error }); return }
  try {
    const body = await readJson(req)
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const details = typeof body.details === 'string' ? body.details.trim() : ''
    const issue = typeof body.issue === 'string' ? body.issue.trim() : ''
    const base = typeof body.base === 'string' ? body.base.trim() : ''
    if (title.length === 0 || title.length > 240 || details.length > MAX_PR_TEXT || !/^#?\d*$/.test(issue)) {
      writeJson(res, 400, { ok: false, error: 'title or linked issue is invalid' }); return
    }
    if (repository.branch === '') { writeJson(res, 200, { ok: false, error: 'Create or switch to a branch before opening a pull request.' }); return }
    const template = await readPullRequestTemplate(repository.root)
    const prBody = buildPullRequestBody(template, details, issue)
    const args = ['pr', 'create', '--title', title, '--body-file', '-', '--head', repository.branch]
    if (base !== '') args.push('--base', base)
    if (body.draft === true) args.push('--draft')
    const result = await runCli('gh', args, repository.root, prBody)
    if (result.code !== 0) { writeJson(res, 200, { ok: false, error: result.stderr.trim() || result.stdout.trim() || 'Unable to create pull request.' }); return }
    const url = result.stdout.trim().split('\n').find(line => /^https:\/\//.test(line)) ?? result.stdout.trim()
    writeJson(res, 200, { ok: true, url })
  } catch (error) {
    writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

export function apply(ctx: Context): void {
  const server = ctx.webServer
  ctx.effect(() => server.register({
    kind: 'exact', path: '/api/desktop/github/status',
    handler: (req, res) => req.method === 'GET' ? void handleStatus(ctx, req, res) : writeJson(res, 405, { ok: false, error: 'method not allowed' }),
  }), 'desktop-github:status')
  ctx.effect(() => server.register({
    kind: 'exact', path: '/api/desktop/github/pull-request',
    handler: (req, res) => req.method === 'POST' ? void handleCreatePullRequest(ctx, req, res) : writeJson(res, 405, { ok: false, error: 'method not allowed' }),
  }), 'desktop-github:pull-request')
  ctx.effect(() => server.register({
    kind: 'exact', path: '/api/desktop/github/login',
    handler: (req, res) => req.method === 'POST' ? void handleLogin(ctx, req, res) : writeJson(res, 405, { ok: false, error: 'method not allowed' }),
  }), 'desktop-github:login')
}

