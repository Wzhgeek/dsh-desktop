/**
 * Git panel view tab: renders the workspace git status, the staged and
 * worktree diffs, and a commit composer that POSTs to the desktop host
 * endpoints.
 * @module @dsh-desktop/client/git
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
// Type-only: pulls the SlotMap merge (ctx.slots) into the program.
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * The `conversation.view` slot row, restated locally. ui-conversation declares
 * this key (and the runtime slot exists because that package is composed into
 * the web profile), but the client bundle cannot depend on
 * `@deepseek-ai/dsh-client-ui-conversation`; this augmentation supplies only
 * the compile-time view of the one slot this tab targets.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.view': { kind: 'list'; scope: 'session'; owner: GitViewOwnerProps }
  }
}

/** Owner share of the git view tab (mirrors ui-conversation's inspect handoff). */
export interface GitViewOwnerProps {
  /** One-shot inspect request from another view; the panel ignores it. */
  inspect?: { callId: string } | null
  /** Acknowledge the inspect request once applied; the panel never issues one. */
  onInspectDone?: () => void
}

/** Full props of the git view entry: the framework session/global standard kit. */
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

/** GET /api/desktop/git/status response body. */
export interface GitStatusPayload {
  ok: boolean
  error?: string
  status?: GitStatus
  diff?: GitDiff
}

/** POST /api/desktop/git/commit response body. */
export interface GitCommitPayload {
  ok: boolean
  error?: string
  output?: string
}

/** Fetch and decode the status payload. */
async function fetchStatus(): Promise<GitStatusPayload> {
  const res = await fetch('/api/desktop/git/status')
  return await res.json() as GitStatusPayload
}

/**
 * The git view tab. Session-scope slot props arrive (the framework standard
 * kit); this view reads everything it needs over HTTP, so it uses none of them.
 * @param _props - the conversation.view runtime share.
 * @returns the git panel.
 */
export function GitPanel(_props: GitViewProps): JSX.Element {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [commitResult, setCommitResult] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const payload = await fetchStatus()
      if (!payload.ok) {
        setError(payload.error ?? 'git status failed')
        return
      }
      setStatus(payload.status ?? null)
      setDiff(payload.diff ?? null)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const commit = useCallback(async () => {
    const trimmed = message.trim()
    if (trimmed === '' || busy) return
    setBusy(true)
    setCommitResult(null)
    try {
      const res = await fetch('/api/desktop/git/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      })
      const payload = await res.json() as GitCommitPayload
      if (payload.ok) {
        setCommitResult(payload.output ?? 'committed')
        setMessage('')
      } else {
        setCommitResult(`commit failed: ${payload.error ?? 'unknown error'}`)
      }
      await refresh()
    } catch (err) {
      setCommitResult(`commit failed: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }, [message, busy, refresh])

  const changed = status?.changed ?? []
  const changedCount = changed.length

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600 }}>Git</span>
        <span style={{ color: 'var(--dsw-alias-label-secondary, #888)' }}>
          {status === null ? '…' : `branch ${status.branch || '(detached)'} · ${changedCount} changed`}
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          style={buttonStyle}
        >
          Refresh
        </button>
      </div>

      {error !== null && <div style={{ color: '#c0392b' }}>{error}</div>}

      {changedCount > 0 && (
        <ul style={{ margin: 0, padding: '0 0 0 16px', fontFamily: 'monospace', fontSize: 12 }}>
          {changed.map((file) => (
            <li key={file.path}>
              <span style={{ display: 'inline-block', width: '2ch', color: '#8a6d3b' }}>
                {file.index.trim() === '' ? '·' : file.index}
              </span>
              <span style={{ display: 'inline-block', width: '2ch', color: '#7f8c8d' }}>
                {file.worktree.trim() === '' ? '·' : file.worktree}
              </span>
              <span style={{ marginLeft: 4 }}>{file.path}</span>
            </li>
          ))}
        </ul>
      )}

      {diff?.staged !== undefined && diff.staged !== '' && (
        <section>
          <div style={sectionTitleStyle}>Staged diff</div>
          <pre style={preStyle}>{diff.staged}</pre>
        </section>
      )}

      {diff?.worktree !== undefined && diff.worktree !== '' && (
        <section>
          <div style={sectionTitleStyle}>Worktree diff</div>
          <pre style={preStyle}>{diff.worktree}</pre>
        </section>
      )}

      {changedCount === 0 && error === null && (
        <div style={{ color: '#27ae60' }}>Working tree clean.</div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void commit()
        }}
        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
      >
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Commit message"
          disabled={busy}
          style={{ flex: 1, padding: '6px 8px', fontFamily: 'inherit' }}
        />
        <button
          type="submit"
          disabled={busy || message.trim() === ''}
          style={buttonStyle}
        >
          {busy ? 'Committing…' : 'Commit'}
        </button>
      </form>

      {commitResult !== null && (
        <div style={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {commitResult}
        </div>
      )}
    </div>
  )
}

const buttonStyle: CSSProperties = {
  padding: '6px 12px',
  cursor: 'pointer',
  borderRadius: 4,
  border: '1px solid #ccc',
  background: 'transparent',
}

const sectionTitleStyle: CSSProperties = {
  fontWeight: 600,
  marginBottom: 4,
}

const preStyle: CSSProperties = {
  margin: 0,
  padding: 8,
  background: 'rgba(127,127,127,0.08)',
  borderRadius: 4,
  overflow: 'auto',
  fontFamily: 'monospace',
  fontSize: 12,
  lineHeight: 1.4,
  maxHeight: 320,
}
