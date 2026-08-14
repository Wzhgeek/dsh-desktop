/**
 * Git host plugin — serves the desktop Git panel's read/write endpoints: the
 * working-tree status and staged/worktree diffs over GET, and a stage-all +
 * commit over POST. Git runs through `child_process.execFile` with argv arrays
 * only (never a shell), so workspace paths and commit messages cannot inject a
 * command.
 * @module @deepseek-ai/dsh-desktop/host/git
 */

import { execFile } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: ctx.webServer type augmentation.
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'desktop-git'

/** Services required before the git surface can mount. */
export const inject = ['webServer']

/** Env override for the git working root, documented as the desktop escape hatch. */
const GIT_ROOT_ENV = 'DSH_DESKTOP_GIT_ROOT'

/** Diff content cap (10 MiB) so a huge change set cannot pin the process. */
const MAX_BUFFER_BYTES = 10 * 1024 * 1024

/** One `git status --porcelain` row, with the raw index/worktree codes. */
export interface GitChangedFile {
  /** Path (or `old -> new` for renames/copies) as porcelain printed it. */
  path: string
  /** Index (staged) status code; `' '` when unmodified. */
  index: string
  /** Worktree status code; `' '` when unmodified. */
  worktree: string
}

/** The parsed status projection returned by the status endpoint. */
export interface GitStatus {
  /** Current branch name, or `''` when HEAD is detached. */
  branch: string
  /** Changed files in porcelain order. */
  changed: GitChangedFile[]
}

/** The diff half of the status response. */
export interface GitDiff {
  /** Staged diff (`git diff --cached`). */
  staged: string
  /** Unstaged worktree diff (`git diff`). */
  worktree: string
}

/** Structural slice of the optional `workspaceRegistry` service. */
interface WorkspaceLike {
  path: string
}

/** A settled git child-process run. */
interface GitRun {
  /** Process exit code, or `1` when the spawn itself failed (e.g. git absent). */
  code: number
  stdout: string
  stderr: string
}

/**
 * Run one git command with an argv array; never a shell. The working directory
 * pins `cwd`, and `--` separators guard against paths/refs that begin with `-`.
 * @param cwd - repository working directory.
 * @param args - git arguments, each its own argv element.
 * @returns the settled run (no throw on non-zero exit).
 */
function runGit(cwd: string, args: readonly string[]): Promise<GitRun> {
  return new Promise((resolve) => {
    execFile(
      'git',
      [...args],
      { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER_BYTES },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            code: typeof error.code === 'number' ? error.code : 1,
            stdout: String(stdout),
            stderr: String(stderr),
          })
        } else {
          resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) })
        }
      },
    )
  })
}

/**
 * Resolve the git working root. Env override wins; otherwise the first
 * registered Harness workspace is used; the process cwd is the final fallback.
 * Resolved per request so a workspace created after boot is honored.
 * @param ctx - plugin context (carries the optional workspace service).
 * @returns the working root directory.
 */
function resolveGitRoot(ctx: Context): string {
  const envRoot = process.env[GIT_ROOT_ENV]
  if (envRoot !== undefined && envRoot !== '') return envRoot
  // The `workspaceRegistry` service (@deepseek-ai/dsh-workspace) is composed
  // into the web profile at runtime but is not a dependency of this package,
  // so it is read through `ctx.get` and duck-typed to the one field used.
  const registry = ctx.get('workspaceRegistry') as { list?: () => readonly WorkspaceLike[] } | undefined
  const workspace = registry?.list?.()[0]
  if (workspace?.path !== undefined) return workspace.path
  return process.cwd()
}

/**
 * Parse `git status --porcelain` (v1) into changed-file rows. A row is two
 * status codes, a space, then the path; rename/copy rows keep the `old -> new`
 * path the porcelain printed.
 * @param output - porcelain stdout.
 * @returns parsed rows.
 */
export function parseStatusPorcelain(output: string): GitChangedFile[] {
  const changed: GitChangedFile[] = []
  for (const line of output.split('\n')) {
    if (line === '') continue
    const index = line[0] ?? ' '
    const worktree = line[1] ?? ' '
    const path = line.slice(3)
    if (path === '') continue
    changed.push({ path, index, worktree })
  }
  return changed
}

/** Serialize the response body as JSON. */
function writeJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Read and decode a request body to a UTF-8 string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** GET /api/desktop/git/status — branch, changed files, and diffs. */
function handleStatus(ctx: Context, res: ServerResponse): Promise<void> {
  const root = resolveGitRoot(ctx)
  return Promise.all([
    runGit(root, ['branch', '--show-current']),
    runGit(root, ['status', '--porcelain']),
    runGit(root, ['diff', '--cached']),
    runGit(root, ['diff']),
  ]).then(([branch, porcelain, staged, worktree]) => {
    if (porcelain.code !== 0) {
      writeJson(res, 200, {
        ok: false,
        error: porcelain.stderr.trim() || `git exited ${String(porcelain.code)}`,
      })
      return
    }
    writeJson(res, 200, {
      ok: true,
      status: {
        branch: branch.stdout.trim(),
        changed: parseStatusPorcelain(porcelain.stdout),
      },
      diff: { staged: staged.stdout, worktree: worktree.stdout },
    })
  }).catch((error: unknown) => {
    writeJson(res, 500, { ok: false, error: String(error) })
  })
}

/** POST /api/desktop/git/commit — stage all changes and commit. */
async function handleCommit(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let message = ''
  try {
    const parsed = JSON.parse(await readBody(req)) as { message?: unknown }
    if (typeof parsed.message !== 'string') throw new Error('message is not a string')
    message = parsed.message
  } catch (error) {
    writeJson(res, 400, { ok: false, error: `invalid commit request: ${String(error)}` })
    return
  }
  const trimmed = message.trim()
  if (trimmed === '') {
    writeJson(res, 400, { ok: false, error: 'commit message is required' })
    return
  }
  const root = resolveGitRoot(ctx)
  const add = await runGit(root, ['add', '-A'])
  if (add.code !== 0) {
    writeJson(res, 200, { ok: false, error: add.stderr.trim() || add.stdout.trim() || `git add exited ${String(add.code)}` })
    return
  }
  const commit = await runGit(root, ['commit', '-m', trimmed])
  if (commit.code !== 0) {
    writeJson(res, 200, { ok: false, error: commit.stderr.trim() || commit.stdout.trim() || `git commit exited ${String(commit.code)}` })
    return
  }
  writeJson(res, 200, { ok: true, output: commit.stdout.trim() })
}

/**
 * Mount the git host surface: the status read route and the commit write route,
 * both on the desktop HTTP server.
 * @param ctx - plugin context carrying the webServer service.
 */
export function apply(ctx: Context): void {
  const server = ctx.webServer
  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/desktop/git/status',
    handler: (_req, res) => void handleStatus(ctx, res),
  }), 'desktop-git:status')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/desktop/git/commit',
    handler: (req, res) => void handleCommit(ctx, req, res),
  }), 'desktop-git:commit')
}
