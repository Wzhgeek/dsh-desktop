/**
 * Git workspace view: repository sync, branches, hunk staging, recent history,
 * index-only commits, commit details, and history-preserving restoration.
 * @module @dsh-desktop/client/git
 */

import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.mjs'
import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down.mjs'
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up.mjs'
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check-big.mjs'
import CircleDot from 'lucide-react/dist/esm/icons/circle-dot.mjs'
import Copy from 'lucide-react/dist/esm/icons/copy.mjs'
import Download from 'lucide-react/dist/esm/icons/download.mjs'
import FileCode2 from 'lucide-react/dist/esm/icons/file-code-2.mjs'
import GitBranch from 'lucide-react/dist/esm/icons/git-branch.mjs'
import GitCommitHorizontal from 'lucide-react/dist/esm/icons/git-commit-horizontal.mjs'
import History from 'lucide-react/dist/esm/icons/history.mjs'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle.mjs'
import Minus from 'lucide-react/dist/esm/icons/minus.mjs'
import Plus from 'lucide-react/dist/esm/icons/plus.mjs'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.mjs'
import Search from 'lucide-react/dist/esm/icons/search.mjs'
import Upload from 'lucide-react/dist/esm/icons/upload.mjs'
import X from 'lucide-react/dist/esm/icons/x.mjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
// Type-only: pulls the SlotMap merge (ctx.slots) into the program.
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { GitHubStrip } from './GitHubStrip.tsx'

/**
 * The `conversation.view` slot row, restated locally. ui-conversation declares
 * this key, but this bundle cannot depend on that client package directly.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.view': { kind: 'list'; scope: 'session'; owner: GitViewOwnerProps }
  }
}

/** Owner share of the Git view tab (mirrors ui-conversation's inspect handoff). */
export interface GitViewOwnerProps {
  inspect?: { callId: string } | null
  onInspectDone?: () => void
}

/** Full props of the Git view entry: the framework session/global standard kit. */
export type GitViewProps = PropsRuntime<'conversation.view'>

/** One changed-file row as the host parsed it. */
export interface GitChangedFile {
  path: string
  index: string
  worktree: string
}

/** Status projection returned by the host. */
export interface GitStatus {
  branch: string
  changed: GitChangedFile[]
}

/** Diff half of the status response. */
export interface GitDiff {
  staged: string
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

/** One local branch returned for the branch picker. */
export interface GitBranchSummary {
  name: string
  upstream: string
  current: boolean
}

/** One independently selectable diff hunk. */
export interface GitDiffHunk {
  id: string
  source: 'staged' | 'worktree'
  path: string
  header: string
  lines: string[]
  additions: number
  deletions: number
}

/** One recent commit returned with the status payload. */
export interface GitCommitSummary {
  hash: string
  shortHash: string
  parents: string[]
  author: string
  authoredAt: string
  refs: string[]
  subject: string
  files: number
  additions: number
  deletions: number
}

/** One file changed by an expanded commit. */
export interface GitCommitFile {
  path: string
  additions: number | null
  deletions: number | null
}

/** Expanded commit metadata loaded when a history row is selected. */
export interface GitCommitDetail extends GitCommitSummary {
  body: string
  changedFiles: GitCommitFile[]
}

/** GET /api/desktop/git/status response body. */
export interface GitStatusPayload {
  ok: boolean
  repository?: boolean
  root?: string
  error?: string
  status?: GitStatus
  diff?: GitDiff
  hunks?: { staged: GitDiffHunk[]; worktree: GitDiffHunk[] }
  branches?: GitBranchSummary[]
  meta?: GitRepositoryMeta
  history?: GitCommitSummary[]
}

/** GET /api/desktop/git/commit response body. */
export interface GitCommitDetailPayload {
  ok: boolean
  error?: string
  commit?: GitCommitDetail
}

/** One commit-file patch returned when a changed-file row is opened. */
export interface GitCommitFilePatchPayload {
  ok: boolean
  error?: string
  file?: { commit: string; path: string; patch: string }
}

/** POST response shared by commit and restore actions. */
export interface GitActionPayload {
  ok: boolean
  error?: string
  output?: string
  head?: string
  code?: string
}

type ActionMessage = { kind: 'success' | 'error'; text: string }
type BusyAction = 'commit' | 'restore' | 'hunks' | 'fetch' | 'pull' | 'push' | 'branch' | null
type ConfirmAction = { kind: 'pull' | 'push' } | { kind: 'switch'; branch: string }

const EMPTY_META: GitRepositoryMeta = {
  head: '',
  remote: '',
  upstream: '',
  ahead: 0,
  behind: 0,
}

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** Build one workspace-scoped desktop Git endpoint URL. */
function gitEndpoint(path: string, cwd: string, values?: Record<string, string>): string {
  const query = new URLSearchParams({ cwd, ...values })
  return `${path}?${query.toString()}`
}

/** Fetch and decode JSON, preserving a useful HTTP failure. */
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const value = await response.json() as T
  if (!response.ok) {
    const error = (value as { error?: unknown }).error
    throw new Error(typeof error === 'string' ? error : `Git request failed (${String(response.status)})`)
  }
  return value
}

/** Return a compact repository name from a platform path. */
function repositoryName(root: string | null): string {
  const pieces = root?.split(/[\\/]/).filter(Boolean) ?? []
  return pieces.at(-1) ?? 'Repository'
}

/** Human-readable relative timestamp, with the exact timestamp in a title. */
function relativeTime(value: string): string {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return value
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${String(days)}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${String(months)}mo ago`
  return `${String(Math.floor(months / 12))}y ago`
}

/** Exact timestamp for tooltips and commit details. */
function exactTime(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? DATE_FORMATTER.format(date) : value
}

/** Remove the subject line from a full Git commit message. */
function commitDescription(commit: GitCommitDetail): string {
  const body = commit.body.trim()
  if (body === commit.subject) return ''
  if (body.startsWith(`${commit.subject}\n`)) return body.slice(commit.subject.length).trim()
  return body
}

/** Convert thrown values to concise UI copy. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Compact selectable hunk list shared by staged and worktree sections. */
function HunkList(props: {
  hunks: GitDiffHunk[]
  selected: Set<string>
  onToggle: (id: string) => void
}): JSX.Element {
  return (
    <div className="dsh-git-hunk-list">
      {props.hunks.map((hunk) => (
        <article className={`dsh-git-hunk ${props.selected.has(hunk.id) ? 'is-selected' : ''}`} key={hunk.id}>
          <label className="dsh-git-hunk-heading">
            <input type="checkbox" checked={props.selected.has(hunk.id)} onChange={() => props.onToggle(hunk.id)} />
            <span title={hunk.path}>{hunk.path}</span>
            <code className="is-add">+{hunk.additions}</code>
            <code className="is-delete">-{hunk.deletions}</code>
          </label>
          <code className="dsh-git-hunk-range">{hunk.header}</code>
          <pre>
            {hunk.lines.slice(0, 12).map((line, index) => (
              <span className={line.startsWith('+') ? 'is-add' : line.startsWith('-') ? 'is-delete' : undefined} key={`${hunk.id}:${String(index)}`}>{line || ' '}{'\n'}</span>
            ))}
            {hunk.lines.length > 12 && <span className="is-more">... {hunk.lines.length - 12} more lines</span>}
          </pre>
        </article>
      ))}
    </div>
  )
}

/** Syntax-colored, bounded unified patch used by the commit file inspector. */
function PatchPreview({ patch }: { patch: string }): JSX.Element {
  const lines = patch.split('\n')
  const visible = lines.slice(0, 400)
  return (
    <pre className="dsh-git-file-patch">
      {visible.map((line, index) => (
        <span
          className={line.startsWith('+') && !line.startsWith('+++')
            ? 'is-add'
            : line.startsWith('-') && !line.startsWith('---')
              ? 'is-delete'
              : line.startsWith('@@')
                ? 'is-range'
                : undefined}
          key={`${String(index)}:${line.slice(0, 32)}`}
        >
          {line || ' '}{'\n'}
        </span>
      ))}
      {lines.length > visible.length ? <span className="is-more">... {lines.length - visible.length} more lines</span> : null}
    </pre>
  )
}

/** Render the session-scoped Git workspace. */
export function GitPanel(props: GitViewProps): JSX.Element {
  const cwd = props.useSessions((sessions) => sessions.byId[props.sessionId]?.cwd)
  const rootRef = useRef<HTMLDivElement>(null)
  const requestVersionRef = useRef(0)
  const [payload, setPayload] = useState<GitStatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null)
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [detail, setDetail] = useState<GitCommitDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [selectedHunks, setSelectedHunks] = useState<Set<string>>(() => new Set())
  const [newBranchOpen, setNewBranchOpen] = useState(false)
  const [newBranch, setNewBranch] = useState('')
  const [historyQuery, setHistoryQuery] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [filePatch, setFilePatch] = useState<string | null>(null)
  const [filePatchLoading, setFilePatchLoading] = useState(false)

  const refresh = useCallback(async () => {
    const version = requestVersionRef.current + 1
    requestVersionRef.current = version
    setError(null)
    setLoading(true)
    if (cwd === undefined) {
      setPayload(null)
      setError('This session has no workspace.')
      setLoading(false)
      return
    }
    try {
      const next = await fetchJson<GitStatusPayload>(gitEndpoint('/api/desktop/git/status', cwd))
      if (version !== requestVersionRef.current) return
      if (!next.ok) {
        setError(next.error ?? 'Git status failed.')
        return
      }
      setPayload(next)
      const availableHunks = new Set([
        ...(next.hunks?.staged ?? []).map(hunk => hunk.id),
        ...(next.hunks?.worktree ?? []).map(hunk => hunk.id),
      ])
      setSelectedHunks(current => new Set([...current].filter(id => availableHunks.has(id))))
      const history = next.history ?? []
      setSelectedHash((current) => (
        current !== null && history.some(commit => commit.hash === current)
          ? current
          : history[0]?.hash ?? null
      ))
    } catch (caught) {
      if (version === requestVersionRef.current) setError(errorText(caught))
    } finally {
      if (version === requestVersionRef.current) setLoading(false)
    }
  }, [cwd])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: 'start' })
  }, [])

  useEffect(() => {
    if (cwd === undefined || selectedHash === null) {
      setDetail(null)
      setDetailLoading(false)
      return
    }
    let cancelled = false
    setDetail(null)
    setDetailLoading(true)
    void fetchJson<GitCommitDetailPayload>(gitEndpoint('/api/desktop/git/commit', cwd, { commit: selectedHash }))
      .then((next) => {
        if (cancelled) return
        if (!next.ok || next.commit === undefined) throw new Error(next.error ?? 'Commit detail failed.')
        setDetail(next.commit)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setActionMessage({ kind: 'error', text: errorText(caught) })
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => { cancelled = true }
  }, [cwd, selectedHash])

  useEffect(() => {
    setSelectedFile(null)
    setFilePatch(null)
    setFilePatchLoading(false)
  }, [selectedHash])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && busyAction === null) void refresh()
    }, 15_000)
    return () => { window.clearInterval(timer) }
  }, [autoRefresh, busyAction, refresh])

  const commitChanges = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = message.trim()
    if (trimmed === '' || busyAction !== null || cwd === undefined) return
    setBusyAction('commit')
    setActionMessage(null)
    try {
      const next = await fetchJson<GitActionPayload>(gitEndpoint('/api/desktop/git/commit', cwd), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      })
      if (!next.ok) throw new Error(next.error ?? 'Commit failed.')
      setMessage('')
      setSelectedHash(null)
      setActionMessage({ kind: 'success', text: 'Changes committed.' })
      await refresh()
    } catch (caught) {
      setActionMessage({ kind: 'error', text: errorText(caught) })
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, cwd, message, refresh])

  const restoreVersion = useCallback(async () => {
    if (selectedHash === null || cwd === undefined || busyAction !== null) return
    setBusyAction('restore')
    setActionMessage(null)
    try {
      const next = await fetchJson<GitActionPayload>(gitEndpoint('/api/desktop/git/restore', cwd), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commit: selectedHash }),
      })
      if (!next.ok) throw new Error(next.error ?? 'Version restore failed.')
      setRestoreOpen(false)
      setSelectedHash(null)
      setActionMessage({ kind: 'success', text: `Restored ${selectedHash.slice(0, 7)} in a new commit.` })
      await refresh()
    } catch (caught) {
      setRestoreOpen(false)
      setActionMessage({ kind: 'error', text: errorText(caught) })
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, cwd, refresh, selectedHash])

  const applyHunkAction = useCallback(async (
    action: 'stage' | 'unstage' | 'stage-all' | 'unstage-all',
    hunkIds: string[] = [],
  ) => {
    if (cwd === undefined || busyAction !== null) return
    setBusyAction('hunks')
    setActionMessage(null)
    try {
      const next = await fetchJson<GitActionPayload>(gitEndpoint('/api/desktop/git/hunks', cwd), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, hunkIds }),
      })
      if (!next.ok) throw new Error(next.error ?? 'Unable to update the index.')
      const labels = {
        stage: 'Selected hunks staged.',
        unstage: 'Selected hunks unstaged.',
        'stage-all': 'All changes staged.',
        'unstage-all': 'All changes unstaged.',
      }
      setActionMessage({ kind: 'success', text: labels[action] })
      await refresh()
    } catch (caught) {
      setActionMessage({ kind: 'error', text: errorText(caught) })
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, cwd, refresh])

  const syncRepository = useCallback(async (action: 'fetch' | 'pull' | 'push') => {
    if (cwd === undefined || busyAction !== null) return
    setConfirmAction(null)
    setBusyAction(action)
    setActionMessage(null)
    try {
      const next = await fetchJson<GitActionPayload>(gitEndpoint('/api/desktop/git/sync', cwd), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!next.ok) throw new Error(next.error ?? `Git ${action} failed.`)
      setActionMessage({
        kind: 'success',
        text: action === 'fetch' ? 'Remote references updated.' : action === 'pull' ? 'Branch is up to date.' : 'Commits pushed.',
      })
      await refresh()
    } catch (caught) {
      setActionMessage({ kind: 'error', text: errorText(caught) })
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, cwd, refresh])

  const changeBranch = useCallback(async (action: 'switch' | 'create', branch: string) => {
    if (cwd === undefined || busyAction !== null) return
    setConfirmAction(null)
    setBusyAction('branch')
    setActionMessage(null)
    try {
      const next = await fetchJson<GitActionPayload>(gitEndpoint('/api/desktop/git/branch', cwd), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, branch }),
      })
      if (!next.ok) throw new Error(next.error ?? `Unable to ${action} branch.`)
      setNewBranch('')
      setNewBranchOpen(false)
      setSelectedHash(null)
      setActionMessage({ kind: 'success', text: action === 'create' ? `Created and switched to ${branch}.` : `Switched to ${branch}.` })
      await refresh()
    } catch (caught) {
      setActionMessage({ kind: 'error', text: errorText(caught) })
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, cwd, refresh])

  const createBranch = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const branch = newBranch.trim()
    if (branch !== '') void changeBranch('create', branch)
  }, [changeBranch, newBranch])

  const toggleHunk = useCallback((id: string) => {
    setSelectedHunks((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const openCommitFile = useCallback(async (path: string) => {
    if (cwd === undefined || detail === null) return
    setSelectedFile(path)
    setFilePatch(null)
    setFilePatchLoading(true)
    try {
      const next = await fetchJson<GitCommitFilePatchPayload>(gitEndpoint('/api/desktop/git/commit-file', cwd, {
        commit: detail.hash,
        path,
      }))
      if (!next.ok || next.file === undefined) throw new Error(next.error ?? 'Unable to load this file patch.')
      setFilePatch(next.file.patch)
    } catch (caught) {
      setActionMessage({ kind: 'error', text: errorText(caught) })
      setSelectedFile(null)
    } finally {
      setFilePatchLoading(false)
    }
  }, [cwd, detail])

  const copyCommitHash = useCallback(async () => {
    if (detail === null) return
    try {
      await navigator.clipboard.writeText(detail.hash)
      setActionMessage({ kind: 'success', text: `Copied ${detail.shortHash}.` })
    } catch (caught) {
      setActionMessage({ kind: 'error', text: errorText(caught) })
    }
  }, [detail])

  const repository = payload?.repository ?? null
  const root = payload?.root ?? cwd ?? null
  const status = payload?.status ?? null
  const diff = payload?.diff ?? null
  const meta = payload?.meta ?? EMPTY_META
  const history = payload?.history ?? []
  const branches = payload?.branches ?? []
  const stagedHunks = payload?.hunks?.staged ?? []
  const worktreeHunks = payload?.hunks?.worktree ?? []
  const changed = status?.changed ?? []
  const allHunks = useMemo(() => [...stagedHunks, ...worktreeHunks], [stagedHunks, worktreeHunks])
  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLocaleLowerCase()
    if (query === '') return history
    return history.filter(commit => [commit.subject, commit.author, commit.shortHash, ...commit.refs]
      .some(value => value.toLocaleLowerCase().includes(query)))
  }, [history, historyQuery])
  const isClean = changed.length === 0
  const hasStaged = changed.some(file => file.index !== ' ' && file.index !== '?')
  const hasWorktree = changed.some(file => file.worktree !== ' ' || file.index === '?')
  const selectedStaged = stagedHunks.filter(hunk => selectedHunks.has(hunk.id)).map(hunk => hunk.id)
  const selectedWorktree = worktreeHunks.filter(hunk => selectedHunks.has(hunk.id)).map(hunk => hunk.id)
  const isCurrent = detail?.hash === meta.head
  const canRestore = detail !== null && !isCurrent && isClean && busyAction === null

  const toggleFileHunks = useCallback((path: string) => {
    const ids = allHunks.filter(hunk => hunk.path === path).map(hunk => hunk.id)
    if (ids.length === 0) return
    setSelectedHunks((current) => {
      const next = new Set(current)
      const allSelected = ids.every(id => next.has(id))
      for (const id of ids) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }, [allHunks])

  return (
    <div className="dsh-git-root" ref={rootRef}>
      <style>{GIT_PANEL_CSS}</style>

      <header className="dsh-git-toolbar">
        <div className="dsh-git-repository">
          <span className="dsh-git-repository-icon"><GitBranch size={17} aria-hidden="true" /></span>
          <div className="dsh-git-repository-copy">
            <strong>{repositoryName(root)}</strong>
            <span title={root ?? undefined}>{root ?? 'No workspace selected'}</span>
          </div>
        </div>
        {repository === true && (
          <div className="dsh-git-toolbar-tools">
            <div className="dsh-git-branch-control">
              <GitBranch size={13} aria-hidden="true" />
              <select
                aria-label="Current branch"
                value={status?.branch ?? ''}
                disabled={busyAction !== null || status?.branch === ''}
                onChange={(event) => {
                  if (event.target.value !== status?.branch) setConfirmAction({ kind: 'switch', branch: event.target.value })
                }}
              >
                {branches.map(branch => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
              </select>
              <button
                type="button"
                className="dsh-git-compact-button"
                aria-label="Create branch"
                title="Create branch"
                disabled={busyAction !== null}
                onClick={() => setNewBranchOpen(open => !open)}
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            </div>
            <div className="dsh-git-toolbar-meta">
              {meta.remote !== '' && <span className="dsh-git-remote" title={meta.remote}>{meta.remote}</span>}
              {meta.ahead > 0 && <span title="Commits ahead of upstream"><ArrowUp size={12} aria-hidden="true" />{meta.ahead}</span>}
              {meta.behind > 0 && <span title="Commits behind upstream"><ArrowDown size={12} aria-hidden="true" />{meta.behind}</span>}
            </div>
            <span className="dsh-git-toolbar-actions">
              <button
                type="button"
                className={`dsh-git-auto-button ${autoRefresh ? 'is-active' : ''}`}
                aria-label="Toggle automatic Git refresh"
                aria-pressed={autoRefresh}
                title="Refresh automatically every 15 seconds"
                onClick={() => setAutoRefresh(value => !value)}
              >
                <CircleDot size={13} aria-hidden="true" />
                Auto
              </button>
              <button
                type="button"
                className="dsh-git-icon-button"
                aria-label="Fetch remote changes"
                title="Fetch"
                disabled={busyAction !== null || meta.remote === ''}
                onClick={() => void syncRepository('fetch')}
              >
                <RefreshCw size={15} aria-hidden="true" className={busyAction === 'fetch' ? 'dsh-git-spin' : undefined} />
              </button>
              <button
                type="button"
                className="dsh-git-icon-button"
                aria-label="Pull remote changes"
                title="Pull (fast-forward only)"
                disabled={busyAction !== null || meta.upstream === ''}
                onClick={() => setConfirmAction({ kind: 'pull' })}
              >
                <Download size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="dsh-git-icon-button"
                aria-label="Push local commits"
                title="Push"
                disabled={busyAction !== null || meta.remote === '' || status?.branch === ''}
                onClick={() => setConfirmAction({ kind: 'push' })}
              >
                <Upload size={15} aria-hidden="true" />
              </button>
            </span>
          </div>
        )}
        <button
          type="button"
          className="dsh-git-icon-button"
          aria-label="Refresh Git status"
          title="Refresh"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} aria-hidden="true" className={loading ? 'dsh-git-spin' : undefined} />
        </button>
      </header>

      {repository === true ? <GitHubStrip cwd={cwd} /> : null}

      {repository === true && newBranchOpen && (
        <form className="dsh-git-new-branch" onSubmit={createBranch}>
          <GitBranch size={14} aria-hidden="true" />
          <label htmlFor="dsh-git-new-branch">New branch</label>
          <input
            id="dsh-git-new-branch"
            value={newBranch}
            autoFocus
            spellCheck={false}
            placeholder="feature/name"
            disabled={busyAction !== null}
            onChange={(event) => setNewBranch(event.target.value)}
          />
          <button type="button" className="dsh-git-secondary-button" onClick={() => setNewBranchOpen(false)}>Cancel</button>
          <button type="submit" className="dsh-git-primary-button" disabled={newBranch.trim() === '' || busyAction !== null}>Create</button>
        </form>
      )}

      {error !== null && (
        <div className="dsh-git-banner dsh-git-banner-error" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {actionMessage !== null && (
        <div className={`dsh-git-banner dsh-git-banner-${actionMessage.kind}`} role="status">
          {actionMessage.kind === 'success'
            ? <CheckCircle2 size={15} aria-hidden="true" />
            : <AlertTriangle size={15} aria-hidden="true" />}
          <span>{actionMessage.text}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setActionMessage(null)}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {repository === false && error === null && (
        <div className="dsh-git-empty">
          <GitBranch size={28} aria-hidden="true" />
          <strong>Not a Git repository</strong>
          <code>{root}</code>
        </div>
      )}

      {repository === null && error === null && (
        <div className="dsh-git-empty" aria-label="Loading Git repository">
          <LoaderCircle size={24} className="dsh-git-spin" aria-hidden="true" />
          <span>Loading repository...</span>
        </div>
      )}

      {repository === true && (
        <div className="dsh-git-grid">
          <section className="dsh-git-pane dsh-git-history" aria-labelledby="dsh-git-history-title">
            <div className="dsh-git-pane-heading">
              <h2 id="dsh-git-history-title">Version history</h2>
              <span className="dsh-git-history-count">{filteredHistory.length}/{history.length}</span>
            </div>

            <div className="dsh-git-pane-scroll">
              {!isClean && (
                <details className="dsh-git-working-changes">
                  <summary>
                    <span><FileCode2 size={14} aria-hidden="true" /><strong>Working changes</strong></span>
                    <span>{changed.length} changed</span>
                  </summary>

                  <div className="dsh-git-file-list">
                    {changed.map((file) => {
                      const fileHunkIds = allHunks.filter(hunk => hunk.path === file.path).map(hunk => hunk.id)
                      const fileSelected = fileHunkIds.length > 0 && fileHunkIds.every(id => selectedHunks.has(id))
                      return (
                        <button
                          type="button"
                          className="dsh-git-file"
                          aria-pressed={fileSelected}
                          disabled={fileHunkIds.length === 0}
                          title={fileHunkIds.length > 0 ? 'Select or clear all text hunks in this file' : 'Use Stage all for this file type'}
                          key={`${file.index}:${file.worktree}:${file.path}`}
                          onClick={() => toggleFileHunks(file.path)}
                        >
                          <span className="dsh-git-file-state">{file.index.trim() || file.worktree.trim() || 'M'}</span>
                          <span title={file.path}>{file.path}</span>
                          <span>{fileHunkIds.length > 0 ? `${String(fileHunkIds.length)} hunks` : 'whole file'}</span>
                        </button>
                      )
                    })}
                  </div>

                  {hasStaged && (
                    <section className="dsh-git-change-group" aria-labelledby="dsh-git-staged-title">
                      <div className="dsh-git-change-group-heading">
                        <div><span className="dsh-git-eyebrow">Index</span><h3 id="dsh-git-staged-title">Staged</h3></div>
                        <span>{stagedHunks.length} {stagedHunks.length === 1 ? 'hunk' : 'hunks'}</span>
                      </div>
                      {stagedHunks.length > 0
                        ? <HunkList hunks={stagedHunks} selected={selectedHunks} onToggle={toggleHunk} />
                        : <p className="dsh-git-no-hunks">Binary, metadata, or whole-file change</p>}
                      <div className="dsh-git-change-actions">
                        <button
                          type="button"
                          className="dsh-git-secondary-button"
                          disabled={selectedStaged.length === 0 || busyAction !== null}
                          onClick={() => void applyHunkAction('unstage', selectedStaged)}
                        >
                          Unstage selected
                        </button>
                        <button type="button" className="dsh-git-secondary-button" disabled={busyAction !== null} onClick={() => void applyHunkAction('unstage-all')}>
                          Unstage all
                        </button>
                      </div>
                    </section>
                  )}

                  {hasWorktree && (
                    <section className="dsh-git-change-group" aria-labelledby="dsh-git-worktree-hunks-title">
                      <div className="dsh-git-change-group-heading">
                        <div><span className="dsh-git-eyebrow">Workspace</span><h3 id="dsh-git-worktree-hunks-title">Not staged</h3></div>
                        <span>{worktreeHunks.length} {worktreeHunks.length === 1 ? 'hunk' : 'hunks'}</span>
                      </div>
                      {worktreeHunks.length > 0
                        ? <HunkList hunks={worktreeHunks} selected={selectedHunks} onToggle={toggleHunk} />
                        : <p className="dsh-git-no-hunks">Select “Stage all” for untracked or non-text changes.</p>}
                      <div className="dsh-git-change-actions">
                        <button
                          type="button"
                          className="dsh-git-secondary-button"
                          disabled={selectedWorktree.length === 0 || busyAction !== null}
                          onClick={() => void applyHunkAction('stage', selectedWorktree)}
                        >
                          Stage selected
                        </button>
                        <button type="button" className="dsh-git-secondary-button" disabled={busyAction !== null} onClick={() => void applyHunkAction('stage-all')}>
                          Stage all
                        </button>
                      </div>
                    </section>
                  )}

                  <form className="dsh-git-commit-form" onSubmit={commitChanges}>
                    <label htmlFor="dsh-git-message">Commit message</label>
                    <textarea
                      id="dsh-git-message"
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      placeholder="Describe this change"
                      rows={3}
                      disabled={busyAction !== null}
                    />
                    <button className="dsh-git-primary-button" type="submit" disabled={!hasStaged || message.trim() === '' || busyAction !== null}>
                      {busyAction === 'commit'
                        ? <LoaderCircle size={15} className="dsh-git-spin" aria-hidden="true" />
                        : <GitCommitHorizontal size={15} aria-hidden="true" />}
                      {busyAction === 'commit' ? 'Committing...' : 'Commit staged changes'}
                    </button>
                  </form>

                  {diff?.staged !== undefined && diff.staged !== '' && (
                    <details className="dsh-git-diff">
                      <summary>Staged diff</summary>
                      <pre>{diff.staged}</pre>
                    </details>
                  )}
                  {diff?.worktree !== undefined && diff.worktree !== '' && (
                    <details className="dsh-git-diff">
                      <summary>Worktree diff</summary>
                      <pre>{diff.worktree}</pre>
                    </details>
                  )}
                </details>
              )}

              <label className="dsh-git-history-search">
                <Search size={13} aria-hidden="true" />
                <input
                  type="search"
                  value={historyQuery}
                  aria-label="Search commits"
                  placeholder="Search message, author, hash or branch"
                  onChange={(event) => setHistoryQuery(event.target.value)}
                />
                {historyQuery !== '' ? (
                  <button type="button" aria-label="Clear commit search" onClick={() => setHistoryQuery('')}>
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </label>

              {filteredHistory.length === 0 ? (
                <div className="dsh-git-no-history"><History size={20} aria-hidden="true" />{history.length === 0 ? 'No commits yet' : 'No matching commits'}</div>
              ) : (
                <div className="dsh-git-timeline">
                  {filteredHistory.map((commit, index) => {
                    const selected = selectedHash === commit.hash
                    const current = meta.head === commit.hash
                    const refs = commit.refs.filter(ref => ref !== '').slice(0, 3)
                    return (
                      <button
                        type="button"
                        className={`dsh-git-commit-row ${selected ? 'is-selected' : ''}`}
                        aria-pressed={selected}
                        key={commit.hash}
                        onClick={() => setSelectedHash(commit.hash)}
                      >
                        <span className="dsh-git-track" aria-hidden="true">
                          <span className={`dsh-git-dot ${current ? 'is-current' : ''}`} />
                          {index < filteredHistory.length - 1 && <span className="dsh-git-line" />}
                          {commit.parents.length > 1 ? <span className="dsh-git-merge-line" /> : null}
                        </span>
                        <span className="dsh-git-commit-content">
                          <span className="dsh-git-commit-title">
                            <strong>{commit.subject}</strong>
                            {current && <span className="dsh-git-current-badge">HEAD</span>}
                          </span>
                          <span className="dsh-git-commit-meta">
                            <span>{commit.author}</span>
                            <time dateTime={commit.authoredAt} title={exactTime(commit.authoredAt)}>{relativeTime(commit.authoredAt)}</time>
                            {refs.map(ref => <span className="dsh-git-ref" key={ref}>{ref.replace(/^HEAD -> /, '')}</span>)}
                          </span>
                          <span className="dsh-git-commit-stats">
                            <code>{commit.shortHash}</code>
                            {commit.files > 0 && <span><FileCode2 size={12} aria-hidden="true" />{commit.files}</span>}
                            {commit.additions > 0 && <span className="is-add"><Plus size={12} aria-hidden="true" />{commit.additions}</span>}
                            {commit.deletions > 0 && <span className="is-delete"><Minus size={12} aria-hidden="true" />{commit.deletions}</span>}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </section>

          <aside className="dsh-git-pane dsh-git-detail" aria-label="Commit details">
            <div className="dsh-git-pane-heading">
              <h2>Commit changes</h2>
              <span className="dsh-git-detail-context">{detail?.shortHash ?? 'Select a commit'}</span>
            </div>
            <div className="dsh-git-detail-scroll">
            {detailLoading && (
              <div className="dsh-git-detail-loading"><LoaderCircle size={20} className="dsh-git-spin" aria-hidden="true" />Loading commit...</div>
            )}
            {!detailLoading && detail === null && (
              <div className="dsh-git-detail-empty"><GitCommitHorizontal size={22} aria-hidden="true" />Select a commit</div>
            )}
            {!detailLoading && detail !== null && (
              <>
                <div className="dsh-git-detail-header">
                  <span className="dsh-git-eyebrow">Selected commit</span>
                  <h2>{detail.subject}</h2>
                  <div className="dsh-git-detail-meta">
                    <span>{detail.author}</span>
                    <time dateTime={detail.authoredAt}>{exactTime(detail.authoredAt)}</time>
                    <span className="dsh-git-hash-row">
                      <code>{detail.hash}</code>
                      <button type="button" aria-label="Copy commit hash" title="Copy commit hash" onClick={() => { void copyCommitHash() }}>
                        <Copy size={13} aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                  {commitDescription(detail) !== '' && <p>{commitDescription(detail)}</p>}
                </div>

                <div className="dsh-git-detail-stats" aria-label="Commit statistics">
                  <span><strong>{detail.files}</strong>files</span>
                  <span className="is-add"><strong>+{detail.additions}</strong>added</span>
                  <span className="is-delete"><strong>-{detail.deletions}</strong>removed</span>
                </div>

                <div className="dsh-git-detail-files">
                  <h3>Changed files</h3>
                  {detail.changedFiles.map(file => (
                    <button
                      type="button"
                      className={`dsh-git-detail-file ${selectedFile === file.path ? 'is-selected' : ''}`}
                      aria-pressed={selectedFile === file.path}
                      key={file.path}
                      onClick={() => { void openCommitFile(file.path) }}
                    >
                      <FileCode2 size={14} aria-hidden="true" />
                      <span title={file.path}>{file.path}</span>
                      <code>
                        {file.additions === null ? 'binary' : `+${String(file.additions)} -${String(file.deletions ?? 0)}`}
                      </code>
                    </button>
                  ))}
                  {filePatchLoading ? (
                    <div className="dsh-git-file-patch-loading"><LoaderCircle size={15} className="dsh-git-spin" aria-hidden="true" />Loading patch...</div>
                  ) : null}
                  {!filePatchLoading && selectedFile !== null && filePatch !== null ? (
                    <section className="dsh-git-file-inspector" aria-label={`Patch for ${selectedFile}`}>
                      <div>
                        <strong title={selectedFile}>{selectedFile}</strong>
                        <button type="button" aria-label="Close file patch" onClick={() => { setSelectedFile(null); setFilePatch(null) }}>
                          <X size={13} aria-hidden="true" />
                        </button>
                      </div>
                      {filePatch === '' ? <p>No textual diff for this file.</p> : <PatchPreview patch={filePatch} />}
                    </section>
                  ) : null}
                </div>

                <div className="dsh-git-restore-zone">
                  <button
                    type="button"
                    className="dsh-git-restore-button"
                    disabled={!canRestore}
                    title={!isClean ? 'Commit current changes before restoring' : isCurrent ? 'This is the current version' : 'Restore this version'}
                    onClick={() => setRestoreOpen(true)}
                  >
                    <RotateCcw size={15} aria-hidden="true" />
                    {isCurrent ? 'Current version' : 'Restore this version'}
                  </button>
                  {!isClean && !isCurrent && <span>Commit current changes first.</span>}
                </div>
              </>
            )}
            </div>
          </aside>
        </div>
      )}

      {restoreOpen && detail !== null && (
        <div className="dsh-git-dialog-backdrop" role="presentation">
          <div className="dsh-git-dialog" role="dialog" aria-modal="true" aria-labelledby="dsh-git-restore-title">
            <div className="dsh-git-dialog-icon"><RotateCcw size={19} aria-hidden="true" /></div>
            <div className="dsh-git-dialog-copy">
              <h2 id="dsh-git-restore-title">Restore {detail.shortHash}?</h2>
              <p>The tracked files will match this version. A new commit will record the restore, so existing history stays intact.</p>
              <strong>{detail.subject}</strong>
            </div>
            <div className="dsh-git-dialog-actions">
              <button type="button" className="dsh-git-secondary-button" disabled={busyAction !== null} onClick={() => setRestoreOpen(false)}>Cancel</button>
              <button type="button" className="dsh-git-primary-button" disabled={busyAction !== null} onClick={() => void restoreVersion()}>
                {busyAction === 'restore'
                  ? <LoaderCircle size={15} className="dsh-git-spin" aria-hidden="true" />
                  : <RotateCcw size={15} aria-hidden="true" />}
                {busyAction === 'restore' ? 'Restoring...' : 'Restore version'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmAction !== null && (
        <div className="dsh-git-dialog-backdrop" role="presentation">
          <div className="dsh-git-dialog" role="dialog" aria-modal="true" aria-labelledby="dsh-git-action-title">
            <div className="dsh-git-dialog-icon">
              {confirmAction.kind === 'switch'
                ? <GitBranch size={19} aria-hidden="true" />
                : confirmAction.kind === 'pull'
                  ? <Download size={19} aria-hidden="true" />
                  : <Upload size={19} aria-hidden="true" />}
            </div>
            <div className="dsh-git-dialog-copy">
              <h2 id="dsh-git-action-title">
                {confirmAction.kind === 'switch'
                  ? `Switch to ${confirmAction.branch}?`
                  : confirmAction.kind === 'pull' ? 'Pull remote commits?' : 'Push local commits?'}
              </h2>
              <p>
                {confirmAction.kind === 'switch'
                  ? 'The workspace files will be updated to match the selected branch.'
                  : confirmAction.kind === 'pull'
                    ? 'Only a fast-forward update is allowed; merge commits will not be created.'
                    : `Local commits on ${status?.branch ?? 'this branch'} will be published to its upstream.`}
              </p>
            </div>
            <div className="dsh-git-dialog-actions">
              <button type="button" className="dsh-git-secondary-button" onClick={() => setConfirmAction(null)}>Cancel</button>
              <button
                type="button"
                className="dsh-git-primary-button"
                onClick={() => {
                  if (confirmAction.kind === 'switch') void changeBranch('switch', confirmAction.branch)
                  else void syncRepository(confirmAction.kind)
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const GIT_PANEL_CSS = `
[data-conversation-scroll]:has(.dsh-git-root) {
  overflow-y: hidden !important;
  scrollbar-gutter: auto;
}
.dsh-git-root {
  --git-border: var(--dsw-alias-border-l1, rgba(127,127,127,.2));
  --git-border-soft: color-mix(in srgb, var(--git-border) 65%, transparent);
  --git-surface: var(--dsw-alias-bg-layer-1, #171719);
  --git-surface-raised: var(--dsw-alias-bg-layer-2, #202023);
  --git-text: var(--dsw-alias-label-primary, #f2f2f3);
  --git-muted: var(--dsw-alias-label-secondary, #98989f);
  --git-accent: var(--dsh-desktop-accent, var(--dsw-alias-state-business-primary, #7c5cff));
  --git-accent-soft: color-mix(in srgb, var(--git-accent) 14%, transparent);
  height: calc(100vh - 76px);
  max-height: calc(100vh - 76px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--git-text);
  background: var(--dsw-alias-bg-base, #141416);
}
.dsh-git-toolbar {
  min-height: 62px;
  padding: 10px 16px;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto 32px;
  align-items: center;
  gap: 14px;
  border-bottom: 1px solid var(--git-border);
}
.dsh-git-repository { min-width: 0; display: flex; align-items: center; gap: 10px; }
.dsh-git-repository-icon {
  width: 32px; height: 32px; display: grid; place-items: center; flex: 0 0 auto;
  border: 1px solid color-mix(in srgb, var(--git-accent) 30%, var(--git-border));
  border-radius: 6px; color: var(--git-accent); background: var(--git-accent-soft);
}
.dsh-git-repository-copy { min-width: 0; display: grid; gap: 1px; }
.dsh-git-repository-copy strong { font-size: 14px; font-weight: 600; }
.dsh-git-repository-copy span { overflow: hidden; color: var(--git-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.dsh-git-toolbar-meta { min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 9px; color: var(--git-muted); font-size: 11px; }
.dsh-git-toolbar-meta > span { display: inline-flex; align-items: center; gap: 3px; }
.dsh-git-remote { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-git-toolbar-tools { min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
.dsh-git-toolbar-actions { display: inline-flex; align-items: center; gap: 5px; }
.dsh-git-auto-button {
  height: 32px; padding: 0 8px; display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--git-border); border-radius: 5px; color: var(--git-muted); background: transparent;
  font: 500 10px/16px inherit; cursor: pointer;
}
.dsh-git-auto-button:hover, .dsh-git-auto-button.is-active { color: var(--git-text); background: var(--git-surface-raised); }
.dsh-git-auto-button.is-active svg { color: #63c58a; }
.dsh-git-branch-control {
  height: 32px; min-width: 136px; max-width: 210px; display: grid; grid-template-columns: 16px minmax(80px,1fr) 28px; align-items: center; gap: 5px; padding-left: 8px;
  border: 1px solid var(--git-border); border-radius: 5px; color: var(--git-text); background: var(--git-accent-soft);
}
.dsh-git-branch-control select { min-width: 0; height: 30px; border: 0; outline: 0; color: inherit; background: transparent; font: 500 11px/18px inherit; }
.dsh-git-compact-button { width: 28px; height: 28px; display: grid; place-items: center; padding: 0; border: 0; border-left: 1px solid var(--git-border); color: var(--git-muted); background: transparent; cursor: pointer; }
.dsh-git-compact-button:hover:not(:disabled) { color: var(--git-text); }
.dsh-git-icon-button, .dsh-git-banner button {
  width: 32px; height: 32px; display: grid; place-items: center; padding: 0;
  border: 1px solid var(--git-border); border-radius: 5px; color: var(--git-muted); background: transparent; cursor: pointer;
}
.dsh-git-icon-button:hover:not(:disabled), .dsh-git-banner button:hover { color: var(--git-text); background: var(--git-surface-raised); }
.dsh-git-icon-button:disabled { cursor: default; opacity: .55; }
.dsh-git-banner { min-height: 38px; padding: 7px 14px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--git-border); font-size: 12px; }
.dsh-git-banner span { flex: 1; }
.dsh-git-banner button { width: 26px; height: 26px; border: 0; }
.dsh-git-banner-error { color: #ff8b86; background: rgba(239,68,68,.08); }
.dsh-git-banner-success { color: #6fd09b; background: rgba(34,197,94,.08); }
.dsh-git-new-branch { min-height: 46px; padding: 7px 14px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--git-border); background: var(--git-surface); }
.dsh-git-new-branch label { color: var(--git-muted); font-size: 11px; white-space: nowrap; }
.dsh-git-new-branch input { width: min(280px,32vw); height: 30px; box-sizing: border-box; padding: 5px 8px; border: 1px solid var(--git-border); border-radius: 5px; outline: 0; color: var(--git-text); background: var(--git-surface-raised); font: 11px/18px var(--dsh-desktop-code-font, monospace); }
.dsh-git-new-branch input:focus { border-color: var(--git-accent); box-shadow: 0 0 0 2px var(--git-accent-soft); }
.dsh-git-grid { min-height: 0; flex: 1; display: grid; grid-template-columns: minmax(340px, 1.08fr) minmax(300px, .92fr); padding-bottom: 126px; box-sizing: border-box; }
.dsh-git-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid var(--git-border); }
.dsh-git-pane:last-child { border-right: 0; }
.dsh-git-pane-heading { min-height: 44px; padding: 0 16px; display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--git-border); background: var(--dsw-alias-bg-base, #141416); }
.dsh-git-pane-scroll, .dsh-git-detail-scroll { min-height: 0; flex: 1; overflow: auto; overscroll-behavior: contain; }
.dsh-git-detail-scroll { display: flex; flex-direction: column; }
.dsh-git-eyebrow { display: block; margin-bottom: 3px; color: var(--git-muted); font-size: 10px; font-weight: 600; text-transform: uppercase; }
.dsh-git-pane h2 { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; }
.dsh-git-detail-context { max-width: 160px; overflow: hidden; color: var(--git-muted); text-overflow: ellipsis; white-space: nowrap; font: 10px/16px var(--dsh-desktop-code-font, monospace); }
.dsh-git-count, .dsh-git-history-count { color: var(--git-muted); font-size: 11px; white-space: nowrap; }
.dsh-git-count { display: inline-flex; align-items: center; gap: 4px; }
.dsh-git-count.is-clean { color: #67c990; }
.dsh-git-working-changes { border-bottom: 1px solid var(--git-border); background: color-mix(in srgb, var(--git-surface-raised) 42%, transparent); }
.dsh-git-working-changes > summary { min-height: 38px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--git-muted); cursor: pointer; font-size: 10px; list-style: none; }
.dsh-git-working-changes > summary::-webkit-details-marker { display: none; }
.dsh-git-working-changes > summary > span { display: inline-flex; align-items: center; gap: 7px; }
.dsh-git-working-changes > summary strong { color: var(--git-text); font-size: 11px; }
.dsh-git-working-changes[open] > summary { border-bottom: 1px solid var(--git-border-soft); }
.dsh-git-file-list { padding: 7px 0; border-bottom: 1px solid var(--git-border); }
.dsh-git-file {
  width: 100%; min-height: 32px; padding: 5px 16px; display: grid; grid-template-columns: 20px minmax(0,1fr) auto; align-items: center; gap: 8px;
  border: 0; color: inherit; background: transparent; text-align: left; font: 11px/18px var(--dsh-desktop-code-font, monospace); cursor: pointer;
}
.dsh-git-file:hover:not(:disabled), .dsh-git-file[aria-pressed="true"] { background: var(--git-accent-soft); }
.dsh-git-file:disabled { cursor: default; opacity: .72; }
.dsh-git-file > span:nth-child(2) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-git-file > span:last-child { color: var(--git-muted); font: 9px/14px inherit; white-space: nowrap; }
.dsh-git-file-state { width: 20px; color: #e7b65f; font-weight: 700; }
.dsh-git-change-group { border-bottom: 1px solid var(--git-border); }
.dsh-git-change-group-heading { min-height: 50px; padding: 9px 16px; display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; box-sizing: border-box; }
.dsh-git-change-group-heading h3 { margin: 0; font-size: 12px; line-height: 17px; }
.dsh-git-change-group-heading > span { color: var(--git-muted); font-size: 10px; }
.dsh-git-hunk-list { padding: 0 10px 8px; display: grid; gap: 7px; }
.dsh-git-hunk { min-width: 0; overflow: hidden; border: 1px solid var(--git-border-soft); border-radius: 5px; background: color-mix(in srgb, var(--git-surface-raised) 68%, transparent); }
.dsh-git-hunk.is-selected { border-color: color-mix(in srgb, var(--git-accent) 58%, var(--git-border)); box-shadow: 0 0 0 1px var(--git-accent-soft); }
.dsh-git-hunk-heading { min-height: 32px; padding: 5px 8px; display: grid; grid-template-columns: 15px minmax(0,1fr) auto auto; align-items: center; gap: 6px; cursor: pointer; }
.dsh-git-hunk-heading input { width: 14px; height: 14px; margin: 0; accent-color: var(--git-accent); }
.dsh-git-hunk-heading > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 10px/16px var(--dsh-desktop-code-font, monospace); }
.dsh-git-hunk-heading code, .dsh-git-hunk-range { font: 9px/14px var(--dsh-desktop-code-font, monospace); }
.dsh-git-hunk .is-add { color: #63c58a; }
.dsh-git-hunk .is-delete { color: #f07c78; }
.dsh-git-hunk-range { display: block; padding: 3px 8px; overflow: hidden; color: color-mix(in srgb, var(--git-accent) 72%, var(--git-text)); border-top: 1px solid var(--git-border-soft); text-overflow: ellipsis; white-space: nowrap; }
.dsh-git-hunk pre { max-height: 150px; margin: 0; padding: 6px 8px 8px; overflow: auto; color: var(--git-muted); background: rgba(0,0,0,.13); font: 9px/14px var(--dsh-desktop-code-font, monospace); }
.dsh-git-hunk pre span { display: block; min-width: max-content; }
.dsh-git-hunk pre .is-more { padding-top: 3px; color: var(--git-muted); }
.dsh-git-no-hunks { margin: 0; padding: 0 16px 10px; color: var(--git-muted); font-size: 10px; line-height: 16px; }
.dsh-git-change-actions { padding: 0 10px 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.dsh-git-commit-form { padding: 14px 16px; display: grid; gap: 8px; border-bottom: 1px solid var(--git-border); }
.dsh-git-commit-form label { color: var(--git-muted); font-size: 11px; font-weight: 600; }
.dsh-git-commit-form textarea {
  width: 100%; min-height: 62px; box-sizing: border-box; resize: vertical; padding: 8px 9px;
  border: 1px solid var(--git-border); border-radius: 5px; outline: 0; color: var(--git-text); background: var(--git-surface-raised); font: inherit;
}
.dsh-git-commit-form textarea:focus { border-color: color-mix(in srgb, var(--git-accent) 68%, var(--git-border)); box-shadow: 0 0 0 2px var(--git-accent-soft); }
.dsh-git-primary-button, .dsh-git-secondary-button, .dsh-git-restore-button {
  min-height: 32px; padding: 6px 10px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: 1px solid transparent; border-radius: 5px; font: 500 12px/18px inherit; cursor: pointer;
}
.dsh-git-primary-button { color: white; background: var(--git-accent); }
.dsh-git-primary-button:hover:not(:disabled) { filter: brightness(1.08); }
.dsh-git-primary-button:disabled, .dsh-git-secondary-button:disabled, .dsh-git-restore-button:disabled { cursor: not-allowed; opacity: .45; }
.dsh-git-secondary-button { color: var(--git-text); border-color: var(--git-border); background: transparent; }
.dsh-git-diff { border-bottom: 1px solid var(--git-border); }
.dsh-git-diff summary { padding: 10px 16px; color: var(--git-muted); font-size: 11px; cursor: pointer; }
.dsh-git-diff pre { max-height: 280px; margin: 0; padding: 12px 16px; overflow: auto; border-top: 1px solid var(--git-border-soft); background: rgba(0,0,0,.14); font: 11px/17px var(--dsh-desktop-code-font, monospace); }
.dsh-git-history-search {
  height: 34px; margin: 8px 12px 2px; padding: 0 9px; display: grid; grid-template-columns: 14px minmax(0,1fr) 22px; align-items: center; gap: 6px;
  border: 1px solid var(--git-border-soft); border-radius: 5px; color: var(--git-muted); background: color-mix(in srgb, var(--git-surface-raised) 65%, transparent);
}
.dsh-git-history-search:focus-within { border-color: color-mix(in srgb, var(--git-accent) 55%, var(--git-border)); }
.dsh-git-history-search input { width: 100%; border: 0; outline: 0; color: var(--git-text); background: transparent; font: 11px/18px inherit; }
.dsh-git-history-search input::placeholder { color: var(--git-muted); }
.dsh-git-history-search button { width: 22px; height: 22px; display: grid; place-items: center; border: 0; color: var(--git-muted); background: transparent; cursor: pointer; }
.dsh-git-timeline { padding: 4px 0 18px; }
.dsh-git-commit-row {
  width: 100%; min-height: 68px; padding: 0 14px 0 0; display: grid; grid-template-columns: 40px minmax(0,1fr);
  border: 0; text-align: left; color: inherit; background: transparent; cursor: pointer;
  content-visibility: auto; contain-intrinsic-size: 0 68px;
}
.dsh-git-commit-row:hover { background: color-mix(in srgb, var(--git-surface-raised) 72%, transparent); }
.dsh-git-commit-row.is-selected { background: var(--git-accent-soft); }
.dsh-git-track { position: relative; min-height: 68px; display: flex; justify-content: center; }
.dsh-git-dot { position: relative; z-index: 2; width: 8px; height: 8px; margin-top: 17px; box-sizing: border-box; border: 2px solid #4aa3ff; border-radius: 50%; background: var(--dsw-alias-bg-base, #141416); }
.dsh-git-dot.is-current { width: 11px; height: 11px; margin-top: 15px; border: 3px solid #4aa3ff; box-shadow: 0 0 0 3px rgba(74,163,255,.15); }
.dsh-git-line { position: absolute; top: 24px; bottom: -18px; width: 1px; background: #388bd8; }
.dsh-git-merge-line { position: absolute; top: 20px; left: 20px; width: 18px; height: 34px; border-left: 1px solid #e5a82f; border-bottom: 1px solid #e5a82f; border-radius: 0 0 0 9px; }
.dsh-git-commit-content { min-width: 0; padding: 10px 0 9px; display: grid; gap: 3px; border-bottom: 1px solid var(--git-border-soft); }
.dsh-git-commit-title { min-width: 0; display: flex; align-items: center; gap: 7px; }
.dsh-git-commit-title strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 550; }
.dsh-git-current-badge { padding: 1px 5px; flex: 0 0 auto; border-radius: 3px; color: var(--git-accent); background: var(--git-accent-soft); font: 700 9px/14px inherit; }
.dsh-git-commit-meta, .dsh-git-commit-stats { display: flex; align-items: center; gap: 8px; color: var(--git-muted); font-size: 10px; }
.dsh-git-commit-meta span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-git-commit-meta time::before { content: '/'; margin-right: 8px; opacity: .55; }
.dsh-git-ref { max-width: 120px; padding: 0 5px; border: 1px solid rgba(74,163,255,.46); border-radius: 8px; color: #69b4ff; line-height: 14px; }
.dsh-git-commit-stats > span { display: inline-flex; align-items: center; gap: 2px; }
.dsh-git-commit-stats code { color: color-mix(in srgb, var(--git-accent) 72%, var(--git-text)); font: 10px/16px var(--dsh-desktop-code-font, monospace); }
.dsh-git-commit-stats .is-add, .dsh-git-detail-stats .is-add { color: #63c58a; }
.dsh-git-commit-stats .is-delete, .dsh-git-detail-stats .is-delete { color: #f07c78; }
.dsh-git-detail-loading, .dsh-git-detail-empty, .dsh-git-no-history { min-height: 160px; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--git-muted); font-size: 12px; }
.dsh-git-detail-header { padding: 18px 18px 16px; border-bottom: 1px solid var(--git-border); }
.dsh-git-detail-header h2 { margin: 0 0 12px; font-size: 17px; line-height: 24px; }
.dsh-git-detail-meta { display: grid; gap: 4px; color: var(--git-muted); font-size: 11px; }
.dsh-git-detail-meta code { overflow: hidden; color: color-mix(in srgb, var(--git-accent) 70%, var(--git-text)); text-overflow: ellipsis; font: 10px/16px var(--dsh-desktop-code-font, monospace); }
.dsh-git-hash-row { min-width: 0; display: grid; grid-template-columns: minmax(0,1fr) 26px; align-items: center; gap: 5px; }
.dsh-git-hash-row button, .dsh-git-file-inspector > div button { width: 26px; height: 26px; display: grid; place-items: center; border: 0; border-radius: 4px; color: var(--git-muted); background: transparent; cursor: pointer; }
.dsh-git-hash-row button:hover, .dsh-git-file-inspector > div button:hover { color: var(--git-text); background: var(--git-surface-raised); }
.dsh-git-detail-header p { margin: 13px 0 0; color: var(--git-muted); font-size: 12px; line-height: 18px; white-space: pre-wrap; }
.dsh-git-detail-stats { min-height: 60px; padding: 10px 18px; display: grid; grid-template-columns: repeat(3,1fr); align-items: center; border-bottom: 1px solid var(--git-border); }
.dsh-git-detail-stats span { display: grid; gap: 1px; color: var(--git-muted); font-size: 10px; }
.dsh-git-detail-stats strong { color: inherit; font-size: 15px; }
.dsh-git-detail-files { flex: 1 0 auto; min-height: 0; padding: 14px 0; }
.dsh-git-detail-files h3 { margin: 0 18px 8px; color: var(--git-muted); font-size: 10px; text-transform: uppercase; }
.dsh-git-detail-file { width: 100%; min-height: 30px; padding: 5px 18px; display: grid; grid-template-columns: 16px minmax(0,1fr) auto; align-items: center; gap: 7px; border: 0; color: var(--git-muted); background: transparent; text-align: left; font: 11px/18px inherit; cursor: pointer; }
.dsh-git-detail-file:hover, .dsh-git-detail-file.is-selected { background: var(--git-accent-soft); }
.dsh-git-detail-file > span { overflow: hidden; color: var(--git-text); text-overflow: ellipsis; white-space: nowrap; }
.dsh-git-detail-file code { color: var(--git-muted); font: 10px/16px var(--dsh-desktop-code-font, monospace); }
.dsh-git-file-patch-loading { min-height: 60px; display: flex; align-items: center; justify-content: center; gap: 7px; color: var(--git-muted); font-size: 11px; }
.dsh-git-file-inspector { margin: 8px 12px 0; overflow: hidden; border: 1px solid var(--git-border); border-radius: 5px; background: rgba(0,0,0,.13); }
.dsh-git-file-inspector > div { min-height: 32px; padding: 3px 6px 3px 9px; display: grid; grid-template-columns: minmax(0,1fr) 26px; align-items: center; border-bottom: 1px solid var(--git-border-soft); }
.dsh-git-file-inspector > div strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 10px/16px var(--dsh-desktop-code-font, monospace); }
.dsh-git-file-inspector p { margin: 0; padding: 14px; color: var(--git-muted); font-size: 11px; }
.dsh-git-file-patch { max-height: 310px; margin: 0; padding: 9px 10px; overflow: auto; color: var(--git-muted); font: 9px/14px var(--dsh-desktop-code-font, monospace); }
.dsh-git-file-patch span { display: block; min-width: max-content; }
.dsh-git-file-patch .is-add { color: #63c58a; background: rgba(34,197,94,.06); }
.dsh-git-file-patch .is-delete { color: #f07c78; background: rgba(239,68,68,.06); }
.dsh-git-file-patch .is-range { color: #69b4ff; }
.dsh-git-file-patch .is-more { padding-top: 5px; color: var(--git-muted); }
.dsh-git-restore-zone { padding: 14px 18px; display: grid; gap: 6px; border-top: 1px solid var(--git-border); }
.dsh-git-restore-button { width: 100%; color: var(--git-text); border-color: color-mix(in srgb, var(--git-accent) 42%, var(--git-border)); background: var(--git-accent-soft); }
.dsh-git-restore-button:hover:not(:disabled) { border-color: var(--git-accent); }
.dsh-git-restore-zone > span { color: #e6af62; font-size: 10px; text-align: center; }
.dsh-git-empty { flex: 1; min-height: 240px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; color: var(--git-muted); }
.dsh-git-empty strong { color: var(--git-text); }
.dsh-git-empty code { max-width: min(520px,80vw); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.dsh-git-dialog-backdrop { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 20px; background: rgba(0,0,0,.62); backdrop-filter: blur(3px); }
.dsh-git-dialog { width: min(430px,100%); padding: 20px; display: grid; grid-template-columns: 38px 1fr; gap: 12px; border: 1px solid var(--git-border); border-radius: 7px; background: var(--git-surface-raised); box-shadow: 0 20px 60px rgba(0,0,0,.34); }
.dsh-git-dialog-icon { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 6px; color: var(--git-accent); background: var(--git-accent-soft); }
.dsh-git-dialog-copy h2 { margin: 0 0 7px; font-size: 16px; }
.dsh-git-dialog-copy p { margin: 0 0 10px; color: var(--git-muted); font-size: 12px; line-height: 18px; }
.dsh-git-dialog-copy strong { font-size: 12px; }
.dsh-git-dialog-actions { grid-column: 1/-1; display: flex; justify-content: flex-end; gap: 8px; padding-top: 8px; }
.dsh-git-spin { animation: dsh-git-spin .8s linear infinite; }
@keyframes dsh-git-spin { to { transform: rotate(360deg); } }
@media (max-width: 980px) {
  .dsh-git-toolbar-meta .dsh-git-remote { display: none; }
}
@media (max-width: 680px) {
  .dsh-git-toolbar { grid-template-columns: minmax(0,1fr) 32px; }
  .dsh-git-toolbar-tools { grid-column: 1/-1; grid-row: 2; width: 100%; justify-content: flex-start; overflow-x: auto; }
  .dsh-git-toolbar-meta { display: none; }
  .dsh-git-grid { display: block; overflow: auto; }
  .dsh-git-pane { min-height: 320px; border-right: 0; border-bottom: 1px solid var(--git-border); }
  .dsh-git-detail { min-height: 420px; }
}
@media (prefers-reduced-motion: reduce) { .dsh-git-spin { animation: none; } }
`
