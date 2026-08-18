/** Project workspace host: content search, durable memory, and validation runs. */

import { execFile, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { access, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { resolveWorkspaceRoot } from './workspace-root.ts'

export const name = 'desktop-project'
export const inject = ['webServer']

const MEMORY_FILE = 'AGENTS.local.md'
const MAX_REQUEST_BYTES = 256 * 1024
const MAX_MEMORY_BYTES = 128 * 1024
const MAX_SEARCH_BUFFER = 4 * 1024 * 1024
const MAX_RUN_OUTPUT = 768 * 1024
const SEARCH_LIMIT = 60

export interface WorkspaceContentHit {
  path: string
  relativePath: string
  line: number
  column: number
  preview: string
}

export interface ProjectCommand {
  id: string
  label: string
  kind: 'test' | 'build' | 'check'
  executable: string
  args: string[]
  display: string
}

export interface ProjectRun {
  id: string
  commandId: string
  label: string
  display: string
  status: 'running' | 'passed' | 'failed' | 'cancelled'
  startedAt: number
  finishedAt?: number
  durationMs?: number
  exitCode?: number | null
  output: string
  summary: { passed?: number; failed?: number; tests?: number }
}

interface ActiveRun {
  child: ChildProcess
  run: ProjectRun
  cancelled: boolean
}

const runs = new Map<string, ActiveRun>()
let runSequence = 0

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
  if (chunks.length === 0) return {}
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('request body must be an object')
  return value as Record<string, unknown>
}

function requestedRoot(req: IncomingMessage): string | undefined {
  return new URL(req.url ?? '/', 'http://localhost').searchParams.get('cwd') ?? undefined
}

async function resolveRequestRoot(ctx: Context, req: IncomingMessage): Promise<{ ok: true; root: string } | { ok: false; error: string }> {
  const result = resolveWorkspaceRoot(ctx, requestedRoot(req), process.env.DSH_DESKTOP_GIT_ROOT === undefined
    ? 'DSH_DESKTOP_WORKSPACE_ROOT'
    : 'DSH_DESKTOP_GIT_ROOT')
  if (!result.ok) return result
  try {
    if (!(await stat(result.root)).isDirectory()) return { ok: false, error: 'workspace is not a directory' }
    return result
  } catch {
    return { ok: false, error: 'workspace is unavailable' }
  }
}

interface CommandRun {
  code: number
  stdout: string
  stderr: string
}

function runFile(command: string, args: readonly string[], cwd: string, maxBuffer = MAX_SEARCH_BUFFER): Promise<CommandRun> {
  return new Promise(resolveRun => {
    execFile(command, [...args], {
      cwd,
      encoding: 'utf8',
      timeout: 12_000,
      maxBuffer,
      env: { ...process.env, LANG: 'C', LC_ALL: 'C', NO_COLOR: '1' },
    }, (error, stdout, stderr) => {
      resolveRun({
        code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1,
        stdout: String(stdout),
        stderr: String(stderr),
      })
    })
  })
}

/** Parse ripgrep's JSON event stream without relying on terminal formatting. */
export function parseRipgrepJson(root: string, output: string): WorkspaceContentHit[] {
  const hits: WorkspaceContentHit[] = []
  for (const rawLine of output.split('\n')) {
    if (rawLine === '' || hits.length >= SEARCH_LIMIT) continue
    try {
      const event = JSON.parse(rawLine) as {
        type?: unknown
        data?: {
          path?: { text?: unknown }
          lines?: { text?: unknown }
          line_number?: unknown
          submatches?: Array<{ start?: unknown }>
        }
      }
      if (event.type !== 'match' || typeof event.data?.path?.text !== 'string'
        || typeof event.data.lines?.text !== 'string' || typeof event.data.line_number !== 'number') continue
      const relativePath = event.data.path.text.replace(/^\.\//, '').split(sep).join('/')
      const firstMatch = event.data.submatches?.[0]
      hits.push({
        path: resolve(root, relativePath),
        relativePath,
        line: event.data.line_number,
        column: typeof firstMatch?.start === 'number' ? firstMatch.start + 1 : 1,
        preview: event.data.lines.text.trimEnd().slice(0, 500),
      })
    } catch {
      // A malformed diagnostic line is not a search result.
    }
  }
  return hits
}

function parseGitGrep(root: string, output: string): WorkspaceContentHit[] {
  const hits: WorkspaceContentHit[] = []
  for (const rawLine of output.split('\n')) {
    if (hits.length >= SEARCH_LIMIT) break
    const match = /^(.+?):(\d+):(\d+):(.*)$/.exec(rawLine)
    if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined || match[4] === undefined) continue
    hits.push({
      path: resolve(root, match[1]),
      relativePath: match[1].split(sep).join('/'),
      line: Number(match[2]),
      column: Number(match[3]),
      preview: match[4].slice(0, 500),
    })
  }
  return hits
}

/** Search source contents with ripgrep, falling back to tracked Git files. */
export async function searchWorkspaceContent(root: string, query: string): Promise<{ engine: 'rg' | 'git-grep'; items: WorkspaceContentHit[] }> {
  const rg = await runFile('rg', [
    '--json', '--line-number', '--column', '--color=never', '--hidden', '--fixed-strings',
    '--glob', '!.git/**', '--glob', '!node_modules/**', '--glob', '!dist/**', '--glob', '!build/**',
    '--max-columns', '800', '--max-filesize', '2M', '--', query, '.',
  ], root)
  if (rg.code === 0 || rg.code === 1 && rg.stderr.trim() === '') {
    return { engine: 'rg', items: parseRipgrepJson(root, rg.stdout) }
  }
  const grep = await runFile('git', ['grep', '-n', '--column', '-I', '-F', '-e', query, '--', '.'], root)
  if (grep.code > 1) throw new Error(grep.stderr.trim() || 'content search is unavailable')
  return { engine: 'git-grep', items: parseGitGrep(root, grep.stdout) }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

function commandExecutable(name: string): string {
  return process.platform === 'win32' && ['npm', 'pnpm', 'yarn'].includes(name) ? `${name}.cmd` : name
}

function scriptCommand(manager: string, script: string): ProjectCommand {
  const executable = commandExecutable(manager)
  const args = manager === 'yarn' ? [script] : manager === 'npm' ? ['run', script] : ['run', script]
  const kind = script.startsWith('test') ? 'test' : script.startsWith('build') ? 'build' : 'check'
  return { id: `script:${script}`, label: script, kind, executable, args, display: `${manager} ${args.join(' ')}` }
}

/** Detect conventional test/build entry points without executing project code. */
export async function detectProjectCommands(root: string): Promise<ProjectCommand[]> {
  const commands: ProjectCommand[] = []
  const packagePath = join(root, 'package.json')
  if (await exists(packagePath)) {
    try {
      const value = JSON.parse(await readFile(packagePath, 'utf8')) as { scripts?: Record<string, unknown> }
      const manager = await exists(join(root, 'pnpm-lock.yaml')) ? 'pnpm'
        : await exists(join(root, 'yarn.lock')) ? 'yarn'
          : await exists(join(root, 'bun.lock')) || await exists(join(root, 'bun.lockb')) ? 'bun' : 'npm'
      const names = Object.keys(value.scripts ?? {}).filter(script => /^(test|build|check|lint|typecheck)(?::|$)/.test(script))
      const priority = (script: string): number => script === 'test' ? 0 : script === 'build' ? 1 : script === 'check' ? 2 : 3
      for (const script of names.sort((a, b) => priority(a) - priority(b) || a.localeCompare(b)).slice(0, 10)) {
        if (typeof value.scripts?.[script] === 'string') commands.push(scriptCommand(manager, script))
      }
    } catch {
      // Invalid package metadata should not hide other detected runners.
    }
  }
  if (await exists(join(root, 'Makefile'))) {
    const makefile = await readFile(join(root, 'Makefile'), 'utf8').catch(() => '')
    for (const target of ['test', 'build']) {
      if (new RegExp(`^${target}\\s*:`, 'm').test(makefile) && !commands.some(item => item.label === target)) {
        commands.push({ id: `make:${target}`, label: target, kind: target as 'test' | 'build', executable: 'make', args: [target], display: `make ${target}` })
      }
    }
  }
  if (commands.length === 0 && await exists(join(root, 'Cargo.toml'))) {
    commands.push(
      { id: 'cargo:test', label: 'test', kind: 'test', executable: 'cargo', args: ['test'], display: 'cargo test' },
      { id: 'cargo:build', label: 'build', kind: 'build', executable: 'cargo', args: ['build'], display: 'cargo build' },
    )
  }
  if (commands.length === 0 && await exists(join(root, 'go.mod'))) {
    commands.push(
      { id: 'go:test', label: 'test', kind: 'test', executable: 'go', args: ['test', './...'], display: 'go test ./...' },
      { id: 'go:build', label: 'build', kind: 'build', executable: 'go', args: ['build', './...'], display: 'go build ./...' },
    )
  }
  const rootEntries = await readdir(root).catch(() => [] as string[])
  const hasPythonTests = rootEntries.some(entry => /^(test_.+|.+_test)\.py$/.test(entry))
  if (!commands.some(item => item.kind === 'test')
    && (hasPythonTests || await exists(join(root, 'pyproject.toml')) || await exists(join(root, 'pytest.ini')))) {
    commands.push({ id: 'python:pytest', label: 'pytest', kind: 'test', executable: 'python', args: ['-m', 'pytest'], display: 'python -m pytest' })
  }
  return commands.slice(0, 12)
}

/** Derive an editable initial memory from files already present in the project. */
export async function detectProjectMemory(root: string, detectedCommands?: ProjectCommand[]): Promise<string> {
  const commands = detectedCommands ?? await detectProjectCommands(root)
  const details: string[] = []
  if (await exists(join(root, 'pnpm-lock.yaml'))) details.push('- Package manager: use pnpm, not npm or yarn.')
  else if (await exists(join(root, 'yarn.lock'))) details.push('- Package manager: use Yarn.')
  else if (await exists(join(root, 'bun.lock')) || await exists(join(root, 'bun.lockb'))) details.push('- Package manager: use Bun.')
  else if (await exists(join(root, 'package-lock.json'))) details.push('- Package manager: use npm.')
  const test = commands.find(command => command.kind === 'test')
  const build = commands.find(command => command.kind === 'build')
  if (test !== undefined) details.push(`- Run the primary test suite with \`${test.display}\`.`)
  if (build !== undefined) details.push(`- Build the project with \`${build.display}\`.`)
  if (await exists(join(root, 'tsconfig.json'))) details.push('- This project uses TypeScript; keep strict type checks passing.')
  return details.length === 0 ? '' : `# Project memory\n\n${details.join('\n')}\n`
}

function appendOutput(run: ProjectRun, chunk: Buffer | string): void {
  const text = stripAnsi(String(chunk)).replaceAll('\r\n', '\n')
  run.output = `${run.output}${text}`.slice(-MAX_RUN_OUTPUT)
}

function stripAnsi(value: string): string {
  return value.replace(/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '')
}

export function summarizeRunOutput(output: string): ProjectRun['summary'] {
  const passed = /(?:^|\s)(\d+)\s+passed\b/im.exec(output)?.[1]
  const failed = /(?:^|\s)(\d+)\s+failed\b/im.exec(output)?.[1]
  const tests = /(?:Tests?|tests?)[:\s]+(\d+)\s+(?:total|tests?)/im.exec(output)?.[1]
  return {
    ...(passed === undefined ? {} : { passed: Number(passed) }),
    ...(failed === undefined ? {} : { failed: Number(failed) }),
    ...(tests === undefined ? {} : { tests: Number(tests) }),
  }
}

function startProjectRun(root: string, command: ProjectCommand): ProjectRun {
  const existing = runs.get(root)
  if (existing?.run.status === 'running') throw new Error('another project command is already running')
  const run: ProjectRun = {
    id: `${Date.now().toString(36)}-${String(++runSequence)}`,
    commandId: command.id,
    label: command.label,
    display: command.display,
    status: 'running',
    startedAt: Date.now(),
    output: '',
    summary: {},
  }
  const child = spawn(command.executable, command.args, {
    cwd: root,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: process.env.CI ?? '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  const active: ActiveRun = { child, run, cancelled: false }
  runs.set(root, active)
  child.stdout?.on('data', chunk => appendOutput(run, chunk as Buffer))
  child.stderr?.on('data', chunk => appendOutput(run, chunk as Buffer))
  child.on('error', error => appendOutput(run, `\n${error.message}\n`))
  child.on('close', code => {
    const finishedAt = Date.now()
    run.finishedAt = finishedAt
    run.durationMs = finishedAt - run.startedAt
    run.exitCode = code
    run.status = active.cancelled ? 'cancelled' : code === 0 ? 'passed' : 'failed'
    run.summary = summarizeRunOutput(run.output)
  })
  return run
}

async function handleContentSearch(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const resolved = await resolveRequestRoot(ctx, req)
  if (!resolved.ok) { writeJson(res, 403, { ok: false, error: resolved.error }); return }
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams.get('q')?.trim() ?? ''
  if (query.length < 2 || query.length > 200) { writeJson(res, 400, { ok: false, error: 'query must contain 2 to 200 characters' }); return }
  try {
    const result = await searchWorkspaceContent(resolved.root, query)
    writeJson(res, 200, { ok: true, ...result })
  } catch (error) {
    writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error), items: [] })
  }
}

async function handleMemory(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const resolved = await resolveRequestRoot(ctx, req)
  if (!resolved.ok) { writeJson(res, 403, { ok: false, error: resolved.error }); return }
  const path = join(resolved.root, MEMORY_FILE)
  if (req.method === 'GET') {
    const commands = await detectProjectCommands(resolved.root)
    const content = await readFile(path, 'utf8').catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    })
    const sources = []
    for (const file of ['AGENTS.md', 'CLAUDE.md', MEMORY_FILE, 'CLAUDE.local.md']) {
      if (await exists(join(resolved.root, file))) sources.push(file)
    }
    writeJson(res, 200, {
      ok: true,
      root: resolved.root,
      path,
      file: MEMORY_FILE,
      content,
      exists: sources.includes(MEMORY_FILE),
      sources,
      detected: await detectProjectMemory(resolved.root, commands),
      commands,
    })
    return
  }
  if (req.method !== 'PUT') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
  try {
    const body = await readJson(req)
    if (typeof body.content !== 'string' || Buffer.byteLength(body.content, 'utf8') > MAX_MEMORY_BYTES) {
      writeJson(res, 400, { ok: false, error: 'memory content is invalid or too large' }); return
    }
    await writeFile(path, body.content, 'utf8')
    writeJson(res, 200, { ok: true, path, bytes: Buffer.byteLength(body.content, 'utf8') })
  } catch (error) {
    writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

async function handleRuns(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const resolved = await resolveRequestRoot(ctx, req)
  if (!resolved.ok) { writeJson(res, 403, { ok: false, error: resolved.error }); return }
  const commands = await detectProjectCommands(resolved.root)
  if (req.method === 'GET') {
    writeJson(res, 200, { ok: true, root: resolved.root, commands, run: runs.get(resolved.root)?.run ?? null })
    return
  }
  if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
  try {
    const body = await readJson(req)
    if (body.action === 'cancel') {
      const active = runs.get(resolved.root)
      if (active?.run.status !== 'running') { writeJson(res, 200, { ok: false, error: 'no project command is running' }); return }
      active.cancelled = true
      active.child.kill()
      writeJson(res, 200, { ok: true, run: active.run })
      return
    }
    if (body.action !== 'run' || typeof body.commandId !== 'string') {
      writeJson(res, 400, { ok: false, error: 'a detected commandId is required' }); return
    }
    const command = commands.find(candidate => candidate.id === body.commandId)
    if (command === undefined) { writeJson(res, 400, { ok: false, error: 'command is not part of the detected project tasks' }); return }
    writeJson(res, 200, { ok: true, run: startProjectRun(resolved.root, command) })
  } catch (error) {
    writeJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

export function apply(ctx: Context): void {
  const server = ctx.webServer
  ctx.effect(() => server.register({
    kind: 'exact', path: '/api/desktop/workspace/search-content',
    handler: (req, res) => req.method === 'GET' ? void handleContentSearch(ctx, req, res) : writeJson(res, 405, { ok: false, error: 'method not allowed' }),
  }), 'desktop-project:content-search')
  ctx.effect(() => server.register({
    kind: 'exact', path: '/api/desktop/project/memory',
    handler: (req, res) => void handleMemory(ctx, req, res),
  }), 'desktop-project:memory')
  ctx.effect(() => server.register({
    kind: 'exact', path: '/api/desktop/project/runs',
    handler: (req, res) => void handleRuns(ctx, req, res),
  }), 'desktop-project:runs')
  ctx.effect(() => () => {
    for (const active of runs.values()) if (active.run.status === 'running') active.child.kill()
    runs.clear()
  }, 'desktop-project:teardown')
}
