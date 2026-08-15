/** Task overview opened from the conversation utilities. */

import Bot from 'lucide-react/dist/esm/icons/bot.mjs'
import Check from 'lucide-react/dist/esm/icons/check.mjs'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.mjs'
import CircleDot from 'lucide-react/dist/esm/icons/circle-dot.mjs'
import FileImage from 'lucide-react/dist/esm/icons/file-image.mjs'
import GitBranch from 'lucide-react/dist/esm/icons/git-branch.mjs'
import GitCommitHorizontal from 'lucide-react/dist/esm/icons/git-commit-horizontal.mjs'
import Laptop from 'lucide-react/dist/esm/icons/laptop.mjs'
import ListTree from 'lucide-react/dist/esm/icons/list-tree.mjs'
import Monitor from 'lucide-react/dist/esm/icons/monitor.mjs'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
import TerminalSquare from 'lucide-react/dist/esm/icons/square-terminal.mjs'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { openDesktopPath } from '../desktop/file-openers.ts'

export type PinnedSummaryProps = PropsRuntime<'conversation.session.header.utilities'> & PropsRenderSlots<never>

interface GitChangedFile {
  path: string
  index: string
  worktree: string
}

interface GitOverviewPayload {
  ok: boolean
  repository?: boolean
  error?: string
  status?: { branch: string; changed: GitChangedFile[] }
  hunks?: {
    staged: Array<{ additions: number; deletions: number }>
    worktree: Array<{ additions: number; deletions: number }>
  }
  meta?: {
    remote: string
    upstream: string
    ahead: number
    behind: number
  }
}

interface SourceItem {
  id: string
  name: string
  detail: string
}

/** Render a compact, live task overview in the conversation's upper-right corner. */
export function PinnedSummary({ sessionId, useSession, useSessions }: PinnedSummaryProps): JSX.Element | null {
  const nodes = useSession(snapshot => snapshot.nodes)
  const cwd = useSessions(snapshot => snapshot.byId[sessionId]?.cwd)
  const catalog = useSessions(snapshot => snapshot.subagentsByParent[sessionId])
  const jobs = useSessions(snapshot => snapshot.jobsBySession[sessionId] ?? EMPTY_JOBS)
  const sources = useMemo(() => collectSources(nodes), [nodes])
  const [open, setOpen] = useState(false)
  const [chatActive, setChatActive] = useState(false)
  const [git, setGit] = useState<GitOverviewPayload | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const panelId = useId()

  const refreshGit = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (cwd === undefined) {
      setGit(null)
      return
    }
    setGitLoading(true)
    try {
      const response = await fetch(gitEndpoint(cwd), signal === undefined ? undefined : { signal })
      const payload = await response.json() as GitOverviewPayload
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? `Git status failed (${String(response.status)})`)
      setGit(payload)
    } catch (error) {
      if (signal?.aborted === true) return
      setGit({ ok: false, error: errorText(error) })
    } finally {
      if (signal?.aborted !== true) setGitLoading(false)
    }
  }, [cwd])

  useEffect(() => {
    const header = root.current?.closest('header')
    if (header === undefined || header === null) return
    const sync = (): void => {
      const tabs = [...header.querySelectorAll<HTMLElement>('[role="tab"]')]
      const active = tabs[0]?.getAttribute('aria-selected') === 'true'
      setChatActive(active)
      if (!active) setOpen(false)
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(header, { attributes: true, subtree: true, attributeFilter: ['aria-selected'] })
    return () => { observer.disconnect() }
  }, [])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void refreshGit(controller.signal)
    const timer = window.setInterval(() => { void refreshGit(controller.signal) }, 15_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [open, refreshGit])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const openGit = (): void => {
    const tab = [...(root.current?.closest('header')?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])]
      .find(candidate => candidate.textContent?.trim() === 'Git')
    tab?.click()
    setOpen(false)
  }

  const openWorkspace = async (): Promise<void> => {
    if (cwd === undefined) return
    setWorkspaceError(null)
    const result = await openDesktopPath({ path: cwd })
    if (!result.ok) setWorkspaceError(result.error)
  }

  if (!chatActive) return <div className="dsh-pinned-summary-control" ref={root}><style>{PINNED_SUMMARY_CSS}</style></div>

  const gitStats = diffStats(git)
  const branch = git?.repository === true ? git.status?.branch || 'Detached HEAD' : null
  const subagents = catalog?.entries.filter(entry => entry.kind === 'child') ?? []
  const recentJobs = [...jobs].sort((left, right) => right.startedAt - left.startedAt).slice(0, 3)

  return (
    <div className="dsh-pinned-summary-control" ref={root}>
      <style>{PINNED_SUMMARY_CSS}</style>
      <button
        type="button"
        className="dsh-pinned-summary-trigger"
        aria-label={open ? '关闭任务概览' : '打开任务概览'}
        title="任务概览"
        aria-controls={panelId}
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <ListTree size={15} aria-hidden="true" />
      </button>
      {open ? (
        <aside id={panelId} className="dsh-pinned-summary-panel" aria-label="任务概览">
          <section className="dsh-overview-section dsh-overview-environment">
            <header className="dsh-overview-heading">
              <span>环境信息</span>
              <button type="button" aria-label="刷新环境信息" title="刷新" disabled={gitLoading} onClick={() => { void refreshGit() }}>
                <RefreshCw size={14} className={gitLoading ? 'is-spinning' : undefined} aria-hidden="true" />
              </button>
            </header>

            {cwd === undefined ? (
              <EmptyRow icon={<Laptop size={14} />} label="尚未选择工作区" />
            ) : (
              <>
                <OverviewButton icon={<GitCommitHorizontal size={14} />} label="变更" onClick={openGit}>
                  {git?.repository === true ? (
                    gitStats.files === 0 ? <span className="dsh-overview-clean"><Check size={12} />工作区干净</span> : (
                      <span className="dsh-overview-diff"><b>+{gitStats.additions}</b><i>-{gitStats.deletions}</i></span>
                    )
                  ) : <span>{gitLoading ? '读取中' : '非 Git 仓库'}</span>}
                </OverviewButton>
                <OverviewButton icon={<Laptop size={14} />} label="本地" title={cwd} onClick={() => { void openWorkspace() }}>
                  <span>{basename(cwd)}</span><ChevronRight size={13} />
                </OverviewButton>
                {branch === null ? null : (
                  <OverviewButton icon={<GitBranch size={14} />} label={branch} onClick={openGit}>
                    <ChevronRight size={13} />
                  </OverviewButton>
                )}
                {git?.repository === true ? (
                  <OverviewButton icon={<CircleDot size={14} />} label="提交或推送" onClick={openGit}>
                    <span>{syncLabel(git, gitStats.files)}</span><ChevronRight size={13} />
                  </OverviewButton>
                ) : null}
                {git?.repository === true && git.meta?.remote ? (
                  <OverviewButton icon={<GitBranch size={14} />} label="远程仓库" title={git.meta.remote} onClick={openGit}>
                    <span>{git.meta.remote}</span><ChevronRight size={13} />
                  </OverviewButton>
                ) : null}
              </>
            )}
            {git?.error ? <p className="dsh-overview-error" role="status">{git.error}</p> : null}
            {workspaceError === null ? null : <p className="dsh-overview-error" role="status">{workspaceError}</p>}
          </section>

          <section className="dsh-overview-section">
            <header className="dsh-overview-heading"><span>子智能体</span></header>
            {subagents.length === 0 ? (
              <EmptyRow icon={<Bot size={14} />} label="本会话尚未运行子智能体" />
            ) : subagents.slice(0, 4).map((agent, index) => (
              <div className="dsh-overview-row" key={agent.id}>
                <Bot size={14} aria-hidden="true" />
                <span title={agent.label ?? String(agent.id)}>{agent.label ?? `子智能体 ${String(index + 1)}`}</span>
                <small className={agent.activity === 'running' ? 'is-running' : 'is-complete'}>
                  {agent.activity === 'running' ? '运行中' : '已完成'}
                </small>
              </div>
            ))}
          </section>

          <section className="dsh-overview-section">
            <header className="dsh-overview-heading"><span>后台进程</span></header>
            {recentJobs.length === 0 ? (
              <EmptyRow icon={<TerminalSquare size={14} />} label="暂无后台进程" />
            ) : recentJobs.map(job => (
              <div className="dsh-overview-row" key={job.id}>
                <TerminalSquare size={14} aria-hidden="true" />
                <span title={job.label}>{shorten(job.label, 34)}</span>
                <small className={job.status === 'running' ? 'is-running' : job.status === 'failed' ? 'is-failed' : 'is-complete'}>
                  {jobStatusLabel(job.status)}
                </small>
              </div>
            ))}
          </section>

          <section className="dsh-overview-section">
            <header className="dsh-overview-heading"><span>浏览器</span></header>
            <div className="dsh-overview-row">
              <Monitor size={14} aria-hidden="true" />
              <span title={document.title}>{shorten(document.title.replace(/\s+[—-]\s+DeepSeek Harness$/, ''), 24)}</span>
              <small>{window.location.host}</small>
            </div>
          </section>

          <section className="dsh-overview-section">
            <header className="dsh-overview-heading"><span>来源</span><small>{sources.length === 0 ? '' : String(sources.length)}</small></header>
            {sources.length === 0 ? (
              <EmptyRow icon={<FileImage size={14} />} label="本会话尚未添加图片来源" />
            ) : sources.slice(0, 4).map(source => (
              <div className="dsh-overview-row" key={source.id}>
                <FileImage size={14} aria-hidden="true" />
                <span title={source.name}>{shorten(source.name, 30)}</span>
                <small>{source.detail}</small>
              </div>
            ))}
          </section>
        </aside>
      ) : null}
    </div>
  )
}

function OverviewButton({ icon, label, title, children, onClick }: {
  icon: JSX.Element
  label: string
  title?: string
  children?: React.ReactNode
  onClick: () => void
}): JSX.Element {
  return (
    <button type="button" className="dsh-overview-row dsh-overview-action" title={title} onClick={onClick}>
      {icon}<span>{label}</span><small>{children}</small>
    </button>
  )
}

function EmptyRow({ icon, label }: { icon: JSX.Element; label: string }): JSX.Element {
  return <div className="dsh-overview-row is-empty">{icon}<span>{label}</span></div>
}

function collectSources(nodes: readonly ConversationNode[]): SourceItem[] {
  const byId = new Map<string, SourceItem>()
  const add = (block: unknown): void => {
    if (typeof block !== 'object' || block === null) return
    const candidate = block as { type?: unknown; attachment?: unknown }
    if (candidate.type !== 'image' || typeof candidate.attachment !== 'object' || candidate.attachment === null) return
    const attachment = candidate.attachment as Record<string, unknown>
    if (typeof attachment.attachmentId !== 'string') return
    const bytes = typeof attachment.bytes === 'number' ? attachment.bytes : 0
    byId.set(attachment.attachmentId, {
      id: attachment.attachmentId,
      name: typeof attachment.name === 'string' && attachment.name.trim() !== '' ? attachment.name : '图片附件',
      detail: formatBytes(bytes),
    })
  }

  for (const node of nodes) {
    if (node.kind === 'user' || node.kind === 'steering' || node.kind === 'context' || node.kind === 'tool-result') {
      node.content.forEach(add)
    } else if (node.kind === 'assistant') {
      for (const block of node.blocks) {
        if (block.kind === 'image') add({ type: 'image', attachment: block.attachment })
      }
    }
  }
  return [...byId.values()]
}

function diffStats(payload: GitOverviewPayload | null): { files: number; additions: number; deletions: number } {
  const hunks = [...(payload?.hunks?.staged ?? []), ...(payload?.hunks?.worktree ?? [])]
  return {
    files: payload?.status?.changed.length ?? 0,
    additions: hunks.reduce((total, hunk) => total + hunk.additions, 0),
    deletions: hunks.reduce((total, hunk) => total + hunk.deletions, 0),
  }
}

function gitEndpoint(cwd: string): string {
  const query = new URLSearchParams({ cwd })
  return `/api/desktop/git/status?${query.toString()}`
}

function basename(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function syncLabel(payload: GitOverviewPayload, files: number): string {
  const ahead = payload.meta?.ahead ?? 0
  const behind = payload.meta?.behind ?? 0
  if (ahead > 0 || behind > 0) return [ahead > 0 ? `领先 ${String(ahead)}` : '', behind > 0 ? `落后 ${String(behind)}` : ''].filter(Boolean).join(' · ')
  if (files > 0) return `${String(files)} 项待处理`
  return payload.meta?.upstream ? '已同步' : '尚未关联上游'
}

function jobStatusLabel(status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'): string {
  if (status === 'running') return '运行中'
  if (status === 'stopping') return '停止中'
  if (status === 'completed') return '已完成'
  if (status === 'killed') return '已停止'
  return '失败'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function shorten(value: string, length: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= length ? normalized : `${normalized.slice(0, Math.max(1, length - 1)).trimEnd()}…`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const EMPTY_JOBS: readonly [] = []

const PINNED_SUMMARY_CSS = `
.dsh-pinned-summary-control { display: inline-flex; }
.dsh-pinned-summary-trigger { box-sizing: border-box; width: 30px; height: 30px; padding: 0; display: grid; place-items: center; border: 1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2)); border-radius: 6px; color: var(--dsw-alias-label-secondary,#999); background: transparent; cursor: pointer; }
.dsh-pinned-summary-trigger:hover, .dsh-pinned-summary-trigger[aria-expanded="true"] { color: var(--dsw-alias-label-primary,#eee); background: var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dsh-pinned-summary-trigger:focus-visible { outline: 2px solid var(--dsh-desktop-accent,var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.dsh-pinned-summary-panel { box-sizing: border-box; position: fixed; z-index: 50; top: 52px; right: 16px; width: min(304px,calc(100vw - 32px)); max-height: calc(100vh - 68px); padding: 0 14px; overflow-y: auto; border: 1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22)); border-radius: 8px; color: var(--dsw-alias-label-primary,#eee); background: var(--dsw-alias-bg-layer-2,#242426); box-shadow: 0 18px 48px rgba(0,0,0,.38); scrollbar-width: thin; }
.dsh-overview-section { min-width: 0; padding: 14px 0; display: grid; gap: 3px; border-bottom: 1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16)); }
.dsh-overview-section:last-child { border-bottom: 0; }
.dsh-overview-heading { height: 24px; margin-bottom: 3px; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--dsw-alias-label-tertiary,#858585); font-size: 11px; line-height: 16px; }
.dsh-overview-heading > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-overview-heading > small { color: inherit; font: inherit; }
.dsh-overview-heading > button { width: 24px; height: 24px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 5px; color: inherit; background: transparent; cursor: pointer; }
.dsh-overview-heading > button:hover, .dsh-overview-heading > button:focus-visible { color: var(--dsw-alias-label-primary,#eee); background: var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); outline: none; }
.dsh-overview-heading > button:disabled { cursor: wait; opacity: .65; }
.dsh-overview-row { box-sizing: border-box; width: 100%; min-width: 0; min-height: 30px; padding: 4px 2px; display: grid; grid-template-columns: 18px minmax(0,1fr) auto; align-items: center; gap: 7px; color: var(--dsw-alias-label-primary,#eee); font-size: 12px; line-height: 17px; letter-spacing: 0; }
.dsh-overview-row > svg { width: 14px; height: 14px; color: var(--dsw-alias-label-secondary,#aaa); }
.dsh-overview-row > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-overview-row > small { min-width: 0; max-width: 145px; display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; overflow: hidden; color: var(--dsw-alias-label-secondary,#999); font-size: 10px; line-height: 15px; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
.dsh-overview-row > small > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-overview-row > small > svg { flex: none; }
.dsh-overview-action { border: 0; border-radius: 5px; background: transparent; text-align: left; cursor: pointer; font-family: inherit; }
.dsh-overview-action:hover, .dsh-overview-action:focus-visible { background: var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); outline: none; }
.dsh-overview-row.is-empty { grid-template-columns: 18px minmax(0,1fr); color: var(--dsw-alias-label-tertiary,#777); }
.dsh-overview-diff b { color: #43c880; font-weight: 550; }
.dsh-overview-diff i { color: #ef6666; font-style: normal; font-weight: 550; }
.dsh-overview-clean { color: #43c880; }
.dsh-overview-row small.is-running { color: #58a6ff; }
.dsh-overview-row small.is-complete { color: #43c880; }
.dsh-overview-row small.is-failed { color: #ef6666; }
.dsh-overview-error { margin: 3px 2px 0 27px; color: #ef8a86; font-size: 10px; line-height: 15px; overflow-wrap: anywhere; }
.dsh-overview-heading .is-spinning { animation: dsh-overview-spin .8s linear infinite; }
@keyframes dsh-overview-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .dsh-overview-heading .is-spinning { animation: none; } }
@media (max-width: 620px) { .dsh-pinned-summary-panel { top: 52px; right: 12px; left: 12px; width: auto; max-height: calc(100vh - 64px); } }
`
