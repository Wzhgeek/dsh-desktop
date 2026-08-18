// Author: Zihan Wang
// <wangzh011031@163.com>
/** Compact GitHub/PR/CI surface embedded above the existing two-column Git view. */

import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.mjs'
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check-big.mjs'
import CircleDot from 'lucide-react/dist/esm/icons/circle-dot.mjs'
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.mjs'
import GitFork from 'lucide-react/dist/esm/icons/git-fork.mjs'
import GitPullRequestCreate from 'lucide-react/dist/esm/icons/git-pull-request-create.mjs'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle.mjs'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
import X from 'lucide-react/dist/esm/icons/x.mjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

interface GitHubCheck {
  name: string
  state: 'passed' | 'failed' | 'pending' | 'neutral'
  url: string
}

interface GitHubPullRequest {
  number: number
  title: string
  url: string
  state: string
  isDraft: boolean
  baseRefName: string
  headRefName: string
  checks: GitHubCheck[]
}

interface GitHubStatus {
  ok: boolean
  available?: boolean
  authenticated?: boolean
  branch?: string
  error?: string
  repository?: { name: string; url: string; defaultBranch: string }
  pullRequest?: GitHubPullRequest | null
}

interface GitHubActionResponse {
  ok: boolean
  error?: string
  url?: string
  code?: string
  cancelled?: boolean
  authenticated?: boolean
}

function githubEndpoint(path: string, cwd: string): string {
  return `${path}?${new URLSearchParams({ cwd }).toString()}`
}

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function GitHubStrip({ cwd }: { cwd: string | undefined }): JSX.Element | null {
  const [status, setStatus] = useState<GitHubStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [authorizing, setAuthorizing] = useState(false)
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [authCode, setAuthCode] = useState<string | null>(null)
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [issue, setIssue] = useState('')
  const [base, setBase] = useState('')
  const [draft, setDraft] = useState(false)
  const [creating, setCreating] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (cwd === undefined) return
    setLoading(true)
    try {
      const response = await fetch(githubEndpoint('/api/desktop/github/status', cwd))
      const value = await response.json() as GitHubStatus
      setStatus(value)
      if (value.repository !== undefined) setBase(current => current || value.repository?.defaultBranch || 'main')
    } catch (error) {
      setStatus({ ok: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      setLoading(false)
    }
  }, [cwd])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 30_000)
    return () => window.clearInterval(timer)
  }, [refresh])
  useEffect(() => {
    if (!authorizing || status?.authenticated === true) return
    const timer = window.setInterval(() => { void refresh() }, 2_000)
    return () => window.clearInterval(timer)
  }, [authorizing, refresh, status?.authenticated])

  const checks = status?.pullRequest?.checks ?? []
  const pullRequest = status?.pullRequest ?? null
  const checkCounts = useMemo(() => ({
    passed: checks.filter(check => check.state === 'passed').length,
    failed: checks.filter(check => check.state === 'failed').length,
    pending: checks.filter(check => check.state === 'pending').length,
  }), [checks])

  const createPullRequest = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (cwd === undefined || creating || title.trim() === '') return
    setCreating(true)
    setActionError(null)
    try {
      const response = await fetch(githubEndpoint('/api/desktop/github/pull-request', cwd), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), details: details.trim(), issue: issue.trim(), base: base.trim(), draft }),
      })
      const value = await response.json() as GitHubActionResponse
      if (!value.ok) throw new Error(value.error ?? 'Unable to create pull request.')
      setCreateOpen(false)
      setTitle('')
      setDetails('')
      setIssue('')
      await refresh()
      if (value.url !== undefined) openExternal(value.url)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setCreating(false)
    }
  }, [base, creating, cwd, details, draft, issue, refresh, title])

  const connectGitHub = useCallback(async () => {
    if (cwd === undefined || authorizing) return
    setAuthorizing(true)
    setActionError(null)
    setAuthNotice(null)
    setAuthCode(null)
    setAuthUrl(null)
    try {
      const response = await fetch(githubEndpoint('/api/desktop/github/login', cwd), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      })
      const value = await response.json() as GitHubActionResponse
      if (!value.ok) throw new Error(value.error ?? 'Unable to start GitHub login.')
      if (value.authenticated === true) {
        setAuthorizing(false)
        await refresh()
        return
      }
      setAuthCode(value.code ?? null)
      setAuthUrl(value.url ?? null)
      setAuthNotice(value.code === undefined
        ? 'GitHub login started. Finish authorization in your browser.'
        : `Enter code ${value.code} on GitHub to connect this repository.`)
      if (value.url !== undefined) openExternal(value.url)
      await refresh()
    } catch (error) {
      setAuthorizing(false)
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }, [authorizing, cwd, refresh])

  const cancelGitHubLogin = useCallback(async () => {
    if (cwd === undefined) return
    try {
      const response = await fetch(githubEndpoint('/api/desktop/github/login', cwd), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      const value = await response.json() as GitHubActionResponse
      if (!value.ok) throw new Error(value.error ?? 'Unable to cancel GitHub login.')
      setAuthorizing(false)
      setAuthNotice(null)
      setAuthCode(null)
      setAuthUrl(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }, [cwd])

  useEffect(() => {
    if (status?.authenticated === true) {
      setAuthorizing(false)
      setAuthNotice(null)
      setAuthCode(null)
      setAuthUrl(null)
    }
  }, [status?.authenticated])

  if (cwd === undefined) return null
  const connected = status?.available === true && status.authenticated === true && status.repository !== undefined
  const canAuthorize = status?.available === true && status.authenticated !== true
  return (
    <>
      <style>{GITHUB_CSS}</style>
      <section className={`dsh-github-strip ${connected ? 'is-connected' : ''}`} aria-label="GitHub integration">
        <span className="dsh-github-brand"><GitFork size={15} aria-hidden="true" /><strong>GitHub</strong></span>
        {loading && status === null ? <span className="dsh-github-loading"><LoaderCircle size={13} className="dsh-git-spin" />Connecting</span> : null}
        {!loading && !connected ? <span className="dsh-github-disconnected"><AlertTriangle size={13} />{status?.error ?? 'GitHub is unavailable.'}</span> : null}
        {!connected && canAuthorize && !authorizing ? (
          <button type="button" className="dsh-github-create" onClick={() => { void connectGitHub() }}>
            <GitPullRequestCreate size={13} />
            Connect GitHub
          </button>
        ) : null}
        {!connected && authorizing ? (
          <>
            {authCode !== null ? <span className="dsh-github-code" title="GitHub device code">{authCode}</span> : <span className="dsh-github-loading"><LoaderCircle size={13} className="dsh-git-spin" />Preparing login</span>}
            {authUrl !== null ? <button type="button" className="dsh-github-link" onClick={() => openExternal(authUrl)}>Open browser<ExternalLink size={11} /></button> : null}
            <button type="button" className="dsh-github-cancel" onClick={() => { void cancelGitHubLogin() }}>Cancel login</button>
          </>
        ) : null}
        {connected ? (
          <>
            <button type="button" className="dsh-github-link" title="Open repository" onClick={() => openExternal(status.repository?.url ?? '')}>
              {status.repository?.name}<ExternalLink size={11} />
            </button>
            <span className="dsh-github-branch">{status.branch}</span>
            {pullRequest === null ? <span className="dsh-github-no-pr">No open PR</span> : (
              <button type="button" className="dsh-github-pr" title={pullRequest.title} onClick={() => openExternal(pullRequest.url)}>
                <GitPullRequestCreate size={13} />#{pullRequest.number}<strong>{pullRequest.title}</strong><ExternalLink size={11} />
              </button>
            )}
            {pullRequest !== null && checks.length > 0 ? (
              <span className="dsh-github-checks" title={`${String(checks.length)} CI checks`}>
                {checkCounts.failed > 0 ? <span className="is-failed"><AlertTriangle size={12} />{checkCounts.failed}</span> : null}
                {checkCounts.pending > 0 ? <span className="is-pending"><CircleDot size={12} />{checkCounts.pending}</span> : null}
                {checkCounts.passed > 0 ? <span className="is-passed"><CheckCircle2 size={12} />{checkCounts.passed}</span> : null}
              </span>
            ) : null}
            {pullRequest === null ? (
              <button type="button" className="dsh-github-create" disabled={status.branch === ''} onClick={() => { setActionError(null); setCreateOpen(true) }}>
                <GitPullRequestCreate size={13} />Create PR
              </button>
            ) : null}
          </>
        ) : null}
        <button type="button" className="dsh-github-refresh" title="Refresh GitHub" aria-label="Refresh GitHub" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw size={13} className={loading ? 'dsh-git-spin' : undefined} />
        </button>
      </section>
      {authNotice !== null ? <div className="dsh-git-banner dsh-git-banner-success" role="status"><CheckCircle2 size={15} aria-hidden="true" /><span>{authNotice}</span><button type="button" aria-label="Dismiss message" onClick={() => setAuthNotice(null)}><X size={14} aria-hidden="true" /></button></div> : null}
      {!createOpen && actionError !== null ? <div className="dsh-git-banner dsh-git-banner-error" role="alert"><AlertTriangle size={15} aria-hidden="true" /><span>{actionError}</span><button type="button" aria-label="Dismiss message" onClick={() => setActionError(null)}><X size={14} aria-hidden="true" /></button></div> : null}

      {createOpen ? (
        <div className="dsh-github-dialog-backdrop" role="presentation" onPointerDown={event => { if (event.currentTarget === event.target && !creating) setCreateOpen(false) }}>
          <form className="dsh-github-dialog" role="dialog" aria-modal="true" aria-labelledby="dsh-github-dialog-title" onSubmit={createPullRequest}>
            <header><span><GitPullRequestCreate size={18} /><strong id="dsh-github-dialog-title">Create pull request</strong></span><button type="button" aria-label="Close" disabled={creating} onClick={() => setCreateOpen(false)}><X size={15} /></button></header>
            <label>Title<input value={title} autoFocus maxLength={240} required onChange={event => setTitle(event.currentTarget.value)} /></label>
            <div className="dsh-github-fields"><label>Base<input value={base} onChange={event => setBase(event.currentTarget.value)} /></label><label>Issue<input value={issue} inputMode="numeric" placeholder="#123" onChange={event => setIssue(event.currentTarget.value)} /></label></div>
            <label>Details<textarea value={details} rows={5} placeholder="Summary and validation notes" onChange={event => setDetails(event.currentTarget.value)} /></label>
            <label className="dsh-github-draft"><input type="checkbox" checked={draft} onChange={event => setDraft(event.currentTarget.checked)} />Draft pull request</label>
            {actionError !== null ? <p role="alert"><AlertTriangle size={13} />{actionError}</p> : null}
            <footer><button type="button" disabled={creating} onClick={() => setCreateOpen(false)}>Cancel</button><button className="is-primary" type="submit" disabled={creating || title.trim() === ''}>{creating ? <LoaderCircle size={14} className="dsh-git-spin" /> : <GitPullRequestCreate size={14} />}{creating ? 'Creating' : 'Create PR'}</button></footer>
          </form>
        </div>
      ) : null}
    </>
  )
}

const GITHUB_CSS = `
.dsh-github-strip { min-height: 38px; padding: 4px 14px; display: flex; align-items: center; gap: 9px; border-bottom: 1px solid var(--git-border); color: var(--git-muted); background: color-mix(in srgb,var(--git-surface-raised) 34%,transparent); font-size: 10px; }
.dsh-github-brand, .dsh-github-loading, .dsh-github-disconnected, .dsh-github-checks, .dsh-github-checks > span { display: inline-flex; align-items: center; gap: 5px; }
.dsh-github-brand { color: var(--git-text); }
.dsh-github-disconnected { min-width: 0; flex: 1; color: #d7a95a; }
.dsh-github-link, .dsh-github-pr, .dsh-github-create, .dsh-github-refresh, .dsh-github-cancel { border: 0; color: inherit; background: transparent; cursor: pointer; }
.dsh-github-link, .dsh-github-pr, .dsh-github-create, .dsh-github-cancel { min-height: 26px; padding: 3px 7px; display: inline-flex; align-items: center; gap: 5px; border-radius: 4px; white-space: nowrap; font: inherit; }
.dsh-github-link:hover, .dsh-github-pr:hover, .dsh-github-create:hover, .dsh-github-cancel:hover { color: var(--git-text); background: var(--git-surface-raised); }
.dsh-github-link { color: #72b7fa; }
.dsh-github-code { padding: 3px 8px; border: 1px solid var(--git-border); border-radius: 4px; color: var(--git-text); background: color-mix(in srgb,var(--git-surface-raised) 75%,transparent); font: 700 10px/18px var(--dsh-desktop-code-font,monospace); letter-spacing: .04em; }
.dsh-github-cancel { color: #f0a08f; }
.dsh-github-branch, .dsh-github-no-pr { padding-left: 9px; border-left: 1px solid var(--git-border); white-space: nowrap; }
.dsh-github-pr { min-width: 0; max-width: 380px; color: var(--git-text); }
.dsh-github-pr strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.dsh-github-checks { white-space: nowrap; }
.dsh-github-checks .is-failed { color: #f07c78; }.dsh-github-checks .is-pending { color: #d7a95a; }.dsh-github-checks .is-passed { color: #63c58a; }
.dsh-github-create { margin-left: auto; color: var(--git-text); border: 1px solid color-mix(in srgb,var(--git-accent) 40%,var(--git-border)); background: var(--git-accent-soft); }
.dsh-github-refresh { width: 28px; height: 28px; margin-left: auto; display: grid; place-items: center; border-radius: 4px; }
.dsh-github-create + .dsh-github-refresh { margin-left: 0; }
.dsh-github-refresh:hover { color: var(--git-text); background: var(--git-surface-raised); }
.dsh-github-dialog-backdrop { position: fixed; z-index: 1100; inset: 0; padding: 20px; display: grid; place-items: center; background: rgba(0,0,0,.62); backdrop-filter: blur(3px); }
.dsh-github-dialog { width: min(520px,100%); padding: 18px; display: grid; gap: 12px; border: 1px solid var(--git-border); border-radius: 7px; color: var(--git-text); background: var(--git-surface-raised); box-shadow: 0 24px 70px rgba(0,0,0,.38); }
.dsh-github-dialog header { display: flex; align-items: center; justify-content: space-between; }.dsh-github-dialog header > span { display: flex; align-items: center; gap: 8px; }.dsh-github-dialog header svg { color: var(--git-accent); }
.dsh-github-dialog header button { width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 4px; color: var(--git-muted); background: transparent; cursor: pointer; }
.dsh-github-dialog label { display: grid; gap: 5px; color: var(--git-muted); font-size: 10px; font-weight: 600; }
.dsh-github-dialog input:not([type="checkbox"]), .dsh-github-dialog textarea { width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1px solid var(--git-border); border-radius: 5px; outline: 0; color: var(--git-text); background: var(--git-surface); font: 11px/18px inherit; }
.dsh-github-dialog input:focus, .dsh-github-dialog textarea:focus { border-color: var(--git-accent); }.dsh-github-dialog textarea { resize: vertical; }
.dsh-github-fields { display: grid; grid-template-columns: 1fr 140px; gap: 10px; }
.dsh-github-dialog .dsh-github-draft { display: flex; align-items: center; gap: 7px; color: var(--git-text); }
.dsh-github-dialog .dsh-github-draft input { accent-color: var(--git-accent); }
.dsh-github-dialog p { margin: 0; display: flex; align-items: flex-start; gap: 6px; color: #f07c78; font-size: 10px; line-height: 16px; }
.dsh-github-dialog footer { display: flex; justify-content: flex-end; gap: 7px; }
.dsh-github-dialog footer button { min-height: 32px; padding: 6px 11px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--git-border); border-radius: 5px; color: var(--git-text); background: transparent; font: 500 11px/18px inherit; cursor: pointer; }
.dsh-github-dialog footer button.is-primary { color: white; border-color: transparent; background: var(--git-accent); }
@media (max-width: 760px) { .dsh-github-strip { overflow-x: auto; }.dsh-github-pr strong { display: none; }.dsh-github-fields { grid-template-columns: 1fr; } }
`
