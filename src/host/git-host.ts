/**
 * Git host plugin — serves the desktop Git panel's read/write endpoints: the
 * working-tree status, hunk staging, branch and remote operations, commit
 * history/details, index-only commits, and history-preserving restoration. Git runs through
 * `child_process.execFile` with argv arrays only (never a shell), so workspace
 * paths, refs, and commit messages cannot inject a command.
 * @module @deepseek-ai/dsh-desktop/host/git
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: ctx.webServer type augmentation.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { resolveWorkspaceRoot } from './workspace-root.ts'
import type { WorkspaceRootResolution } from './workspace-root.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-git'

/** Services required before the git surface can mount. */
export const inject = ['webServer']

/** Env override for the git working root, documented as the desktop escape hatch. */
const GIT_ROOT_ENV = 'DSH_DESKTOP_GIT_ROOT'

/** Diff content cap (10 MiB) so a huge change set cannot pin the process. */
const MAX_BUFFER_BYTES = 10 * 1024 * 1024

/** JSON command-body cap; hunk requests carry ids, never patch bodies. */
const MAX_REQUEST_BYTES = 64 * 1024

/** Maximum number of commits returned in the first history page. */
const HISTORY_LIMIT = 50

/** Separators used by the machine-readable `git log` format. */
const HISTORY_RECORD_SEPARATOR = '\x1e'
const HISTORY_FIELD_SEPARATOR = '\x1f'

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

/** Repository-level state displayed above the history. */
export interface GitRepositoryMeta {
  head: string
  remote: string
  upstream: string
  ahead: number
  behind: number
}

/** One local branch exposed to the branch picker. */
export interface GitBranchSummary {
  name: string
  upstream: string
  current: boolean
}

/** One selectable textual diff hunk. */
export interface GitDiffHunk {
  id: string
  source: 'staged' | 'worktree'
  path: string
  header: string
  lines: string[]
  additions: number
  deletions: number
}

interface ParsedPatchFile {
  preamble: string
  hunks: Array<GitDiffHunk & { patch: string }>
}

/** File-change totals attached to one commit. */
export interface GitCommitStats {
  files: number
  additions: number
  deletions: number
}

/** One row in the recent commit history. */
export interface GitCommitSummary extends GitCommitStats {
  hash: string
  shortHash: string
  parents: string[]
  author: string
  authoredAt: string
  refs: string[]
  subject: string
}

/** One path changed by a selected commit. */
export interface GitCommitFile {
  path: string
  additions: number | null
  deletions: number | null
}

/** Expanded metadata and changed files for one commit. */
export interface GitCommitDetail extends GitCommitSummary {
  body: string
  changedFiles: GitCommitFile[]
}

/** Unified patch for one file in a selected commit. */
export interface GitCommitFilePatch {
  commit: string
  path: string
  patch: string
}

/** A settled git child-process run. */
interface GitRun {
  /** Process exit code, or `1` when the spawn itself failed (e.g. git absent). */
  code: number
  stdout: string
  stderr: string
}

/** Repository discovery result after applying the workspace boundary. */
type GitRepositoryResolution =
  | { ok: true; root: string }
  | { ok: false; root: string; notRepository: boolean; error: string }

/**
 * Run one git command with an argv array; never a shell. The working directory
 * pins `cwd`, and `--` separators guard against paths/refs that begin with `-`.
 * @param cwd - repository working directory.
 * @param args - git arguments, each its own argv element.
 * @returns the settled run (no throw on non-zero exit).
 */
function runGit(cwd: string, args: readonly string[], input?: string): Promise<GitRun> {
  return new Promise((resolve) => {
    const child = execFile(
      'git',
      [...args],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER_BYTES,
        timeout: 120_000,
        env: { ...process.env, LANG: 'C', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
      },
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
    if (input !== undefined && child.stdin !== null) {
      child.stdin.on('error', () => {})
      child.stdin.end(input)
    }
  })
}

/** Return a consistent dirty-worktree response before tree-changing actions. */
async function requireCleanWorktree(root: string, res: ServerResponse, action: string): Promise<boolean> {
  const status = await runGit(root, ['status', '--porcelain', '-uall'])
  if (status.code === 0 && status.stdout.trim() === '') return true
  writeJson(res, 200, {
    ok: false,
    code: 'dirty-worktree',
    error: status.code === 0
      ? `Commit or stash current changes before ${action}.`
      : status.stderr.trim() || `Unable to check the worktree before ${action}.`,
  })
  return false
}

/**
 * Resolve the git working root. Env override wins; otherwise an explicitly
 * requested registered workspace is used. Requests from older clients fall
 * back to the first workspace, then the process cwd.
 * @param ctx - plugin context (carries the optional workspace service).
 * @param requestedRoot - current session cwd supplied by the client.
 * @returns an accepted working root or a workspace-boundary error.
 */
function resolveGitRoot(ctx: Context, requestedRoot?: string): WorkspaceRootResolution {
  return resolveWorkspaceRoot(ctx, requestedRoot, GIT_ROOT_ENV)
}

/** Read the optional session-workspace path from one endpoint URL. */
function requestedGitRoot(req: IncomingMessage): string | undefined {
  const value = new URL(req.url ?? '/', 'http://localhost').searchParams.get('cwd')
  return value ?? undefined
}

/** Whether a failed rev-parse means the directory simply has no repository. */
function isNotRepository(run: GitRun): boolean {
  return `${run.stdout}\n${run.stderr}`.toLowerCase().includes('not a git repository')
}

/** Resolve and verify the repository root for one request. */
async function resolveRepository(ctx: Context, req: IncomingMessage): Promise<GitRepositoryResolution> {
  const resolved = resolveGitRoot(ctx, requestedGitRoot(req))
  if (!resolved.ok) {
    return { ok: false, root: '', notRepository: false, error: resolved.error }
  }
  const repository = await runGit(resolved.root, ['rev-parse', '--show-toplevel'])
  if (repository.code !== 0) {
    return {
      ok: false,
      root: resolved.root,
      notRepository: isNotRepository(repository),
      error: repository.stderr.trim() || repository.stdout.trim() || `git exited ${String(repository.code)}`,
    }
  }
  return { ok: true, root: repository.stdout.trim() || resolved.root }
}

/** Remove credentials and Git transport syntax from a remote display label. */
export function publicRemoteLabel(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ssh:') {
      return `${url.hostname}${url.pathname}`.replace(/\.git$/, '').replace(/\/$/, '')
    }
  } catch {
    // SCP-like Git URLs are handled below.
  }
  const scp = /^(?:[^@]+@)?([^:]+):(.+)$/.exec(trimmed)
  if (scp?.[1] !== undefined && scp[2] !== undefined) {
    return `${scp[1]}/${scp[2]}`.replace(/\.git$/, '')
  }
  return trimmed.replace(/\.git$/, '')
}

/** Parse one English `--shortstat` row into numeric totals. */
function parseShortStat(value: string): GitCommitStats {
  const files = /(\d+) files? changed/.exec(value)?.[1]
  const additions = /(\d+) insertions?\(\+\)/.exec(value)?.[1]
  const deletions = /(\d+) deletions?\(-\)/.exec(value)?.[1]
  return {
    files: files === undefined ? 0 : Number(files),
    additions: additions === undefined ? 0 : Number(additions),
    deletions: deletions === undefined ? 0 : Number(deletions),
  }
}

/** Parse the machine-delimited recent history returned by `git log`. */
export function parseGitHistory(output: string): GitCommitSummary[] {
  const history: GitCommitSummary[] = []
  for (const rawRecord of output.split(HISTORY_RECORD_SEPARATOR)) {
    const record = rawRecord.trim()
    if (record === '') continue
    const [header = '', ...statLines] = record.split('\n')
    const fields = header.split(HISTORY_FIELD_SEPARATOR)
    const hash = fields[0]
    const shortHash = fields[1]
    const parents = fields[2]
    const author = fields[3]
    const authoredAt = fields[4]
    const refs = fields[5]
    const subject = fields.slice(6).join(HISTORY_FIELD_SEPARATOR)
    if (hash === undefined || shortHash === undefined || author === undefined || authoredAt === undefined || subject === '') continue
    const stats = parseShortStat(statLines.join(' '))
    history.push({
      hash,
      shortHash,
      parents: parents?.split(' ').filter(Boolean) ?? [],
      author,
      authoredAt,
      refs: refs?.split(',').map(value => value.trim()).filter(Boolean) ?? [],
      subject,
      ...stats,
    })
  }
  return history
}

/** Parse NUL-delimited `--numstat` output without treating paths as argv. */
export function parseNumstat(output: string): GitCommitFile[] {
  const files: GitCommitFile[] = []
  for (const row of output.split('\0')) {
    if (row === '') continue
    const firstTab = row.indexOf('\t')
    const secondTab = firstTab < 0 ? -1 : row.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0) continue
    const additions = row.slice(0, firstTab)
    const deletions = row.slice(firstTab + 1, secondTab)
    const path = row.slice(secondTab + 1)
    if (path === '') continue
    files.push({
      path,
      additions: additions === '-' ? null : Number(additions),
      deletions: deletions === '-' ? null : Number(deletions),
    })
  }
  return files
}

/** Require a full object ID and resolve it to an existing commit. */
async function resolveCommit(root: string, value: unknown): Promise<GitRun> {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) {
    return { code: 1, stdout: '', stderr: 'invalid commit id' }
  }
  return await runGit(root, ['rev-parse', '--verify', `${value}^{commit}`])
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

/** Decode the display path from a traditional unified-diff file marker. */
function patchDisplayPath(value: string): string {
  let path = value.trimEnd()
  if (path.startsWith('"') && path.endsWith('"')) {
    path = path.slice(1, -1)
      .replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)))
      .replace(/\\([\\"nt])/g, (_match, escaped: string) => ({ '\\': '\\', '"': '"', n: '\n', t: '\t' })[escaped] ?? escaped)
  }
  if (path.startsWith('a/') || path.startsWith('b/')) return path.slice(2)
  return path === '/dev/null' ? '' : path
}

/** Split a unified Git diff into file preambles and independently selectable hunks. */
function parsePatch(output: string, source: GitDiffHunk['source']): ParsedPatchFile[] {
  const lines = output.match(/[^\n]*(?:\n|$)/g)?.filter(line => line !== '') ?? []
  const sections: string[][] = []
  let section: string[] | null = null
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (section !== null) sections.push(section)
      section = [line]
    } else if (section !== null) {
      section.push(line)
    }
  }
  if (section !== null) sections.push(section)

  return sections.flatMap((fileLines): ParsedPatchFile[] => {
    const hunkStarts: number[] = []
    for (let index = 0; index < fileLines.length; index += 1) {
      if (fileLines[index]?.startsWith('@@ ') === true) hunkStarts.push(index)
    }
    if (hunkStarts.length === 0) return []
    const firstHunk = hunkStarts[0]
    if (firstHunk === undefined) return []
    const preamble = fileLines.slice(0, firstHunk).join('')
    const newPathMarker = fileLines.find(line => line.startsWith('+++ '))?.slice(4) ?? ''
    const oldPathMarker = fileLines.find(line => line.startsWith('--- '))?.slice(4) ?? ''
    const path = patchDisplayPath(newPathMarker) || patchDisplayPath(oldPathMarker)
    const hunks = hunkStarts.map((start, hunkIndex) => {
      const end = hunkStarts[hunkIndex + 1] ?? fileLines.length
      const hunkLines = fileLines.slice(start, end)
      const patch = hunkLines.join('')
      const id = createHash('sha256')
        .update(source).update('\0').update(fileLines[0] ?? '').update('\0').update(patch)
        .digest('hex').slice(0, 20)
      let additions = 0
      let deletions = 0
      for (const line of hunkLines.slice(1)) {
        if (line.startsWith('+')) additions += 1
        else if (line.startsWith('-')) deletions += 1
      }
      return {
        id,
        source,
        path,
        header: hunkLines[0]?.trimEnd() ?? '',
        lines: hunkLines.slice(1).map(line => line.replace(/\n$/, '')),
        additions,
        deletions,
        patch,
      }
    })
    return [{ preamble, hunks }]
  })
}

/** Parse public hunk projections from a Git unified diff. */
export function parseDiffHunks(output: string, source: GitDiffHunk['source']): GitDiffHunk[] {
  return parsePatch(output, source).flatMap(file => file.hunks.map(({ patch: _patch, ...hunk }) => hunk))
}

/** Parse local branch rows from the NUL-delimited for-each-ref projection. */
export function parseBranches(output: string, currentBranch: string): GitBranchSummary[] {
  return output.split('\n').flatMap((row): GitBranchSummary[] => {
    if (row === '') return []
    const [name = '', upstream = ''] = row.split('\0')
    if (name === '') return []
    return [{ name, upstream, current: name === currentBranch }]
  })
}

/** Rebuild a patch containing only server-recognized selected hunk IDs. */
function selectedPatch(files: ParsedPatchFile[], requestedIds: readonly string[]): string | null {
  const requested = new Set(requestedIds)
  let found = 0
  const parts: string[] = []
  for (const file of files) {
    const selected = file.hunks.filter((hunk) => requested.has(hunk.id))
    if (selected.length === 0) continue
    parts.push(file.preamble, ...selected.map(hunk => hunk.patch))
    found += selected.length
  }
  return found === requested.size ? parts.join('') : null
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
    let bytes = 0
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength
      if (bytes > MAX_REQUEST_BYTES) {
        tooLarge = true
        chunks.length = 0
        return
      }
      if (!tooLarge) chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) reject(new Error('request body is too large'))
      else resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

/** GET /api/desktop/git/status — branch, changed files, and diffs. */
async function handleStatus(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const repository = await resolveRepository(ctx, req)
  if (!repository.ok) {
    if (repository.notRepository) {
      writeJson(res, 200, { ok: true, repository: false, root: repository.root })
    } else {
      writeJson(res, 400, { ok: false, error: repository.error })
    }
    return
  }
  const root = repository.root
  try {
    const [branch, porcelain, staged, worktree, head, remote, upstream, aheadBehind, history, branches] = await Promise.all([
      runGit(root, ['branch', '--show-current']),
      runGit(root, ['status', '--porcelain', '-uall']),
      runGit(root, ['diff', '--cached', '--no-ext-diff', '--no-color', '--unified=3']),
      runGit(root, ['diff', '--no-ext-diff', '--no-color', '--unified=3']),
      runGit(root, ['rev-parse', '--verify', 'HEAD']),
      runGit(root, ['remote', 'get-url', 'origin']),
      runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
      runGit(root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']),
      runGit(root, [
        'log', `-${String(HISTORY_LIMIT)}`, '--date=iso-strict', '--shortstat',
        `--pretty=format:${HISTORY_RECORD_SEPARATOR}%H${HISTORY_FIELD_SEPARATOR}%h${HISTORY_FIELD_SEPARATOR}%P${HISTORY_FIELD_SEPARATOR}%an${HISTORY_FIELD_SEPARATOR}%aI${HISTORY_FIELD_SEPARATOR}%D${HISTORY_FIELD_SEPARATOR}%s`,
      ]),
      runGit(root, ['for-each-ref', '--sort=refname', '--format=%(refname:short)%00%(upstream:short)', 'refs/heads/']),
    ])
    if (porcelain.code !== 0) {
      writeJson(res, 200, {
        ok: false,
        error: porcelain.stderr.trim() || `git exited ${String(porcelain.code)}`,
      })
      return
    }
    const [behindRaw = '0', aheadRaw = '0'] = aheadBehind.stdout.trim().split(/\s+/)
    const currentBranch = branch.stdout.trim()
    writeJson(res, 200, {
      ok: true,
      repository: true,
      root,
      status: {
        branch: currentBranch,
        changed: parseStatusPorcelain(porcelain.stdout),
      },
      diff: { staged: staged.stdout, worktree: worktree.stdout },
      hunks: {
        staged: staged.code === 0 ? parseDiffHunks(staged.stdout, 'staged') : [],
        worktree: worktree.code === 0 ? parseDiffHunks(worktree.stdout, 'worktree') : [],
      },
      branches: branches.code === 0 ? parseBranches(branches.stdout, currentBranch) : [],
      meta: {
        head: head.code === 0 ? head.stdout.trim() : '',
        remote: remote.code === 0 ? publicRemoteLabel(remote.stdout) : '',
        upstream: upstream.code === 0 ? upstream.stdout.trim() : '',
        ahead: aheadBehind.code === 0 ? Number(aheadRaw) || 0 : 0,
        behind: aheadBehind.code === 0 ? Number(behindRaw) || 0 : 0,
      },
      history: history.code === 0 ? parseGitHistory(history.stdout) : [],
    })
  } catch (error: unknown) {
    writeJson(res, 500, { ok: false, error: String(error) })
  }
}

/** GET /api/desktop/git/commit — expanded metadata for one history row. */
async function handleCommitDetail(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const repository = await resolveRepository(ctx, req)
  if (!repository.ok) {
    writeJson(res, repository.notRepository ? 200 : 400, {
      ok: false,
      error: repository.notRepository ? 'This workspace is not a Git repository.' : repository.error,
    })
    return
  }
  const requestedCommit = new URL(req.url ?? '/', 'http://localhost').searchParams.get('commit')
  const commit = await resolveCommit(repository.root, requestedCommit)
  if (commit.code !== 0) {
    writeJson(res, 400, { ok: false, error: commit.stderr.trim() || 'commit not found' })
    return
  }
  const hash = commit.stdout.trim()
  const [metadata, body, files] = await Promise.all([
    runGit(repository.root, [
      'show', '-s', '--date=iso-strict',
      `--format=%H${HISTORY_FIELD_SEPARATOR}%h${HISTORY_FIELD_SEPARATOR}%P${HISTORY_FIELD_SEPARATOR}%an${HISTORY_FIELD_SEPARATOR}%aI${HISTORY_FIELD_SEPARATOR}%D${HISTORY_FIELD_SEPARATOR}%s`,
      hash,
    ]),
    runGit(repository.root, ['show', '-s', '--format=%B', hash]),
    runGit(repository.root, ['diff-tree', '--root', '--no-commit-id', '--numstat', '-r', '-z', '--no-renames', hash, '--']),
  ])
  if (metadata.code !== 0 || files.code !== 0) {
    writeJson(res, 200, { ok: false, error: metadata.stderr.trim() || files.stderr.trim() || 'commit detail failed' })
    return
  }
  const summary = parseGitHistory(`${HISTORY_RECORD_SEPARATOR}${metadata.stdout.trim()}`)[0]
  if (summary === undefined) {
    writeJson(res, 200, { ok: false, error: 'commit detail could not be parsed' })
    return
  }
  const changedFiles = parseNumstat(files.stdout)
  const additions = changedFiles.reduce((total, file) => total + (file.additions ?? 0), 0)
  const deletions = changedFiles.reduce((total, file) => total + (file.deletions ?? 0), 0)
  const detail: GitCommitDetail = {
    ...summary,
    files: changedFiles.length,
    additions,
    deletions,
    body: body.stdout.trim(),
    changedFiles,
  }
  writeJson(res, 200, { ok: true, commit: detail })
}

/** GET /api/desktop/git/commit-file — unified patch for one changed path. */
async function handleCommitFile(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const repository = await resolveRepository(ctx, req)
  if (!repository.ok) {
    writeJson(res, repository.notRepository ? 200 : 400, {
      ok: false,
      error: repository.notRepository ? 'This workspace is not a Git repository.' : repository.error,
    })
    return
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  const requestedPath = url.searchParams.get('path')
  if (requestedPath === null || requestedPath === '' || requestedPath.length > 4096 || requestedPath.includes('\0')) {
    writeJson(res, 400, { ok: false, error: 'a valid file path is required' })
    return
  }
  const commit = await resolveCommit(repository.root, url.searchParams.get('commit'))
  if (commit.code !== 0) {
    writeJson(res, 400, { ok: false, error: commit.stderr.trim() || 'commit not found' })
    return
  }
  const hash = commit.stdout.trim()
  const changed = await runGit(repository.root, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', hash, '--'])
  const changedPaths = new Set(changed.stdout.split('\0').filter(Boolean))
  if (changed.code !== 0 || !changedPaths.has(requestedPath)) {
    writeJson(res, 404, { ok: false, error: 'file is not part of this commit' })
    return
  }
  const patch = await runGit(repository.root, [
    'show', '--format=', '--no-ext-diff', '--no-color', '--unified=4', hash, '--', requestedPath,
  ])
  if (patch.code !== 0) {
    writeJson(res, 200, { ok: false, error: patch.stderr.trim() || 'commit file patch failed' })
    return
  }
  const value: GitCommitFilePatch = { commit: hash, path: requestedPath, patch: patch.stdout }
  writeJson(res, 200, { ok: true, file: value })
}

/** POST /api/desktop/git/hunks — stage/unstage selected hunks or the full tree. */
async function handleHunks(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let action: 'stage' | 'unstage' | 'stage-all' | 'unstage-all'
  let hunkIds: string[] = []
  try {
    const parsed = JSON.parse(await readBody(req)) as { action?: unknown; hunkIds?: unknown }
    if (parsed.action !== 'stage' && parsed.action !== 'unstage' && parsed.action !== 'stage-all' && parsed.action !== 'unstage-all') {
      throw new Error('unknown hunk action')
    }
    action = parsed.action
    if (action === 'stage' || action === 'unstage') {
      if (!Array.isArray(parsed.hunkIds) || parsed.hunkIds.length === 0 || parsed.hunkIds.length > 500) {
        throw new Error('select between 1 and 500 hunks')
      }
      if (!parsed.hunkIds.every(id => typeof id === 'string' && /^[0-9a-f]{20}$/.test(id))) {
        throw new Error('invalid hunk id')
      }
      hunkIds = [...new Set(parsed.hunkIds as string[])]
      if (hunkIds.length !== parsed.hunkIds.length) throw new Error('duplicate hunk id')
    }
  } catch (error) {
    writeJson(res, 400, { ok: false, error: `invalid hunk request: ${String(error)}` })
    return
  }
  const repository = await resolveRepository(ctx, req)
  if (!repository.ok) {
    writeJson(res, 200, { ok: false, error: repository.notRepository ? 'This workspace is not a Git repository.' : repository.error })
    return
  }
  const root = repository.root
  let result: GitRun
  if (action === 'stage-all') {
    result = await runGit(root, ['add', '-A'])
  } else if (action === 'unstage-all') {
    const head = await runGit(root, ['rev-parse', '--verify', 'HEAD'])
    result = head.code === 0
      ? await runGit(root, ['reset', '--mixed', 'HEAD', '--'])
      : await runGit(root, ['rm', '--cached', '--recursive', '--ignore-unmatch', '--', '.'])
  } else {
    const source = action === 'stage' ? 'worktree' : 'staged'
    const args = source === 'staged'
      ? ['diff', '--cached', '--no-ext-diff', '--no-color', '--unified=3']
      : ['diff', '--no-ext-diff', '--no-color', '--unified=3']
    const diff = await runGit(root, args)
    if (diff.code !== 0) {
      writeJson(res, 200, { ok: false, error: diff.stderr.trim() || 'Unable to refresh the selected hunks.' })
      return
    }
    const patch = selectedPatch(parsePatch(diff.stdout, source), hunkIds)
    if (patch === null) {
      writeJson(res, 409, { ok: false, code: 'stale-hunks', error: 'The diff changed. Refresh and select the hunks again.' })
      return
    }
    const applyArgs = ['apply', '--cached', '--whitespace=nowarn']
    if (action === 'unstage') applyArgs.push('--reverse')
    result = await runGit(root, applyArgs, patch)
  }
  if (result.code !== 0) {
    writeJson(res, 200, { ok: false, error: result.stderr.trim() || result.stdout.trim() || `git ${action} failed` })
    return
  }
  writeJson(res, 200, { ok: true, output: result.stdout.trim() || result.stderr.trim() })
}

/** POST /api/desktop/git/sync — fetch, fast-forward pull, or push. */
async function handleSync(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let action: 'fetch' | 'pull' | 'push'
  try {
    const parsed = JSON.parse(await readBody(req)) as { action?: unknown }
    if (parsed.action !== 'fetch' && parsed.action !== 'pull' && parsed.action !== 'push') throw new Error('unknown sync action')
    action = parsed.action
  } catch (error) {
    writeJson(res, 400, { ok: false, error: `invalid sync request: ${String(error)}` })
    return
  }
  const repository = await resolveRepository(ctx, req)
  if (!repository.ok) {
    writeJson(res, 200, { ok: false, error: repository.notRepository ? 'This workspace is not a Git repository.' : repository.error })
    return
  }
  const root = repository.root
  if (action === 'pull' && !await requireCleanWorktree(root, res, 'pulling')) return

  let result: GitRun
  if (action === 'fetch') {
    result = await runGit(root, ['fetch', '--prune'])
  } else if (action === 'pull') {
    result = await runGit(root, ['pull', '--ff-only'])
  } else {
    const [upstream, branch, origin] = await Promise.all([
      runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
      runGit(root, ['branch', '--show-current']),
      runGit(root, ['remote', 'get-url', 'origin']),
    ])
    if (upstream.code === 0) {
      result = await runGit(root, ['push'])
    } else if (branch.stdout.trim() !== '' && origin.code === 0) {
      result = await runGit(root, ['push', '--set-upstream', 'origin', 'HEAD'])
    } else {
      writeJson(res, 200, { ok: false, error: 'Configure an upstream or origin remote before pushing.' })
      return
    }
  }
  if (result.code !== 0) {
    writeJson(res, 200, { ok: false, error: result.stderr.trim() || result.stdout.trim() || `git ${action} failed` })
    return
  }
  writeJson(res, 200, { ok: true, output: result.stdout.trim() || result.stderr.trim() || `${action} completed` })
}

/** POST /api/desktop/git/branch — switch local branches or create one. */
async function handleBranch(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let action: 'switch' | 'create'
  let branch: string
  try {
    const parsed = JSON.parse(await readBody(req)) as { action?: unknown; branch?: unknown }
    if (parsed.action !== 'switch' && parsed.action !== 'create') throw new Error('unknown branch action')
    if (typeof parsed.branch !== 'string' || parsed.branch.trim() === '' || parsed.branch !== parsed.branch.trim()) {
      throw new Error('branch name is required')
    }
    action = parsed.action
    branch = parsed.branch
  } catch (error) {
    writeJson(res, 400, { ok: false, error: `invalid branch request: ${String(error)}` })
    return
  }
  const repository = await resolveRepository(ctx, req)
  if (!repository.ok) {
    writeJson(res, 200, { ok: false, error: repository.notRepository ? 'This workspace is not a Git repository.' : repository.error })
    return
  }
  const root = repository.root
  const valid = await runGit(root, ['check-ref-format', '--branch', branch])
  if (valid.code !== 0) {
    writeJson(res, 400, { ok: false, error: 'Enter a valid Git branch name.' })
    return
  }
  if (!await requireCleanWorktree(root, res, action === 'create' ? 'creating a branch' : 'switching branches')) return
  if (action === 'switch') {
    const exists = await runGit(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
    if (exists.code !== 0) {
      writeJson(res, 400, { ok: false, error: 'That local branch does not exist.' })
      return
    }
  }
  const result = action === 'create'
    ? await runGit(root, ['switch', '--create', branch])
    : await runGit(root, ['switch', '--no-guess', branch])
  if (result.code !== 0) {
    writeJson(res, 200, { ok: false, error: result.stderr.trim() || result.stdout.trim() || `git branch ${action} failed` })
    return
  }
  writeJson(res, 200, { ok: true, output: result.stdout.trim() || result.stderr.trim(), branch })
}

/** POST /api/desktop/git/commit — commit exactly the current index. */
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
  const repository = await resolveRepository(ctx, req)
  if (!repository.ok) {
    writeJson(res, 200, {
      ok: false,
      error: repository.notRepository ? 'This workspace is not a Git repository.' : repository.error,
    })
    return
  }
  const root = repository.root
  const staged = await runGit(root, ['diff', '--cached', '--quiet', '--exit-code'])
  if (staged.code === 0) {
    writeJson(res, 200, { ok: false, error: 'Stage at least one change before committing.' })
    return
  }
  if (staged.code !== 1) {
    writeJson(res, 200, { ok: false, error: staged.stderr.trim() || 'Unable to inspect staged changes.' })
    return
  }
  const commit = await runGit(root, ['commit', '-m', trimmed])
  if (commit.code !== 0) {
    writeJson(res, 200, { ok: false, error: commit.stderr.trim() || commit.stdout.trim() || `git commit exited ${String(commit.code)}` })
    return
  }
  writeJson(res, 200, { ok: true, output: commit.stdout.trim() })
}

/** POST /api/desktop/git/restore — restore a historical tree in a new commit. */
async function handleRestore(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let requestedCommit: unknown
  try {
    const parsed = JSON.parse(await readBody(req)) as { commit?: unknown }
    requestedCommit = parsed.commit
  } catch (error) {
    writeJson(res, 400, { ok: false, error: `invalid restore request: ${String(error)}` })
    return
  }
  const repository = await resolveRepository(ctx, req)
  if (!repository.ok) {
    writeJson(res, 200, {
      ok: false,
      error: repository.notRepository ? 'This workspace is not a Git repository.' : repository.error,
    })
    return
  }
  const root = repository.root
  const dirty = await runGit(root, ['status', '--porcelain'])
  if (dirty.code !== 0 || dirty.stdout.trim() !== '') {
    writeJson(res, 200, {
      ok: false,
      code: 'dirty-worktree',
      error: 'Commit or discard current changes before restoring a version.',
    })
    return
  }
  const target = await resolveCommit(root, requestedCommit)
  if (target.code !== 0) {
    writeJson(res, 400, { ok: false, error: target.stderr.trim() || 'commit not found' })
    return
  }
  const hash = target.stdout.trim()
  const head = await runGit(root, ['rev-parse', '--verify', 'HEAD'])
  if (head.code !== 0) {
    writeJson(res, 200, { ok: false, error: head.stderr.trim() || 'repository has no commits' })
    return
  }
  if (head.stdout.trim() === hash) {
    writeJson(res, 200, { ok: false, error: 'This is already the current version.' })
    return
  }
  const ancestor = await runGit(root, ['merge-base', '--is-ancestor', hash, 'HEAD'])
  if (ancestor.code !== 0) {
    writeJson(res, 200, { ok: false, error: 'Only commits from the current branch history can be restored.' })
    return
  }
  const restore = await runGit(root, ['restore', `--source=${hash}`, '--staged', '--worktree', '--', '.'])
  if (restore.code !== 0) {
    writeJson(res, 200, { ok: false, error: restore.stderr.trim() || restore.stdout.trim() || 'git restore failed' })
    return
  }
  const restoredStatus = await runGit(root, ['status', '--porcelain'])
  if (restoredStatus.code !== 0 || restoredStatus.stdout.trim() === '') {
    await runGit(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', '.'])
    writeJson(res, 200, {
      ok: false,
      error: restoredStatus.code === 0 ? 'The selected commit has the same file tree as HEAD.' : restoredStatus.stderr.trim(),
    })
    return
  }
  const shortHash = hash.slice(0, 7)
  const commit = await runGit(root, [
    'commit', '-m', `Restore workspace to ${shortHash}`,
    '-m', `Restores tracked files to commit ${hash} without rewriting history.`,
  ])
  if (commit.code !== 0) {
    await runGit(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', '.'])
    writeJson(res, 200, { ok: false, error: commit.stderr.trim() || commit.stdout.trim() || 'restore commit failed' })
    return
  }
  const restoredHead = await runGit(root, ['rev-parse', '--verify', 'HEAD'])
  writeJson(res, 200, {
    ok: true,
    output: commit.stdout.trim(),
    head: restoredHead.code === 0 ? restoredHead.stdout.trim() : '',
  })
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
    handler: (req, res) => {
      if (req.method === 'GET') void handleStatus(ctx, req, res)
      else writeJson(res, 405, { ok: false, error: 'method not allowed' })
    },
  }), 'desktop-git:status')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/desktop/git/commit',
    handler: (req, res) => {
      if (req.method === 'GET') void handleCommitDetail(ctx, req, res)
      else if (req.method === 'POST') void handleCommit(ctx, req, res)
      else writeJson(res, 405, { ok: false, error: 'method not allowed' })
    },
  }), 'desktop-git:commit')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/desktop/git/commit-file',
    handler: (req, res) => {
      if (req.method === 'GET') void handleCommitFile(ctx, req, res)
      else writeJson(res, 405, { ok: false, error: 'method not allowed' })
    },
  }), 'desktop-git:commit-file')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/desktop/git/restore',
    handler: (req, res) => {
      if (req.method === 'POST') void handleRestore(ctx, req, res)
      else writeJson(res, 405, { ok: false, error: 'method not allowed' })
    },
  }), 'desktop-git:restore')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/desktop/git/hunks',
    handler: (req, res) => {
      if (req.method === 'POST') void handleHunks(ctx, req, res)
      else writeJson(res, 405, { ok: false, error: 'method not allowed' })
    },
  }), 'desktop-git:hunks')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/desktop/git/sync',
    handler: (req, res) => {
      if (req.method === 'POST') void handleSync(ctx, req, res)
      else writeJson(res, 405, { ok: false, error: 'method not allowed' })
    },
  }), 'desktop-git:sync')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/desktop/git/branch',
    handler: (req, res) => {
      if (req.method === 'POST') void handleBranch(ctx, req, res)
      else writeJson(res, 405, { ok: false, error: 'method not allowed' })
    },
  }), 'desktop-git:branch')
}
