// Author: Zihan Wang
// <wangzh011031@163.com>
/** Project workspace view: auto-loaded memory and detected validation commands. */

import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.mjs'
import Brain from 'lucide-react/dist/esm/icons/brain.mjs'
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check-big.mjs'
import Clock3 from 'lucide-react/dist/esm/icons/clock-3.mjs'
import FileText from 'lucide-react/dist/esm/icons/file-text.mjs'
import Hammer from 'lucide-react/dist/esm/icons/hammer.mjs'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle.mjs'
import Play from 'lucide-react/dist/esm/icons/play.mjs'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
import Save from 'lucide-react/dist/esm/icons/save.mjs'
import Square from 'lucide-react/dist/esm/icons/square.mjs'
import WandSparkles from 'lucide-react/dist/esm/icons/wand-sparkles.mjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fetchJson } from './http.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.view': { kind: 'list'; scope: 'session'; owner: ProjectViewOwnerProps }
  }
}

export interface ProjectViewOwnerProps {
  inspect?: { callId: string } | null
  onInspectDone?: () => void
}

export type ProjectViewProps = PropsRuntime<'conversation.view'>

interface ProjectCommand {
  id: string
  label: string
  kind: 'test' | 'build' | 'check'
  display: string
}

interface ProjectRun {
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

interface MemoryPayload {
  ok: boolean
  error?: string
  root?: string
  path?: string
  file?: string
  content?: string
  exists?: boolean
  sources?: string[]
  detected?: string
  commands?: ProjectCommand[]
}

interface RunsPayload {
  ok: boolean
  error?: string
  root?: string
  commands?: ProjectCommand[]
  run?: ProjectRun | null
}

function endpoint(path: string, cwd: string): string {
  return `${path}?${new URLSearchParams({ cwd }).toString()}`
}

function formatDuration(value: number | undefined): string {
  if (value === undefined) return 'running'
  if (value < 1_000) return `${String(value)} ms`
  if (value < 60_000) return `${(value / 1_000).toFixed(1)} s`
  return `${Math.floor(value / 60_000)}m ${Math.round(value % 60_000 / 1_000)}s`
}

function statusIcon(status: ProjectRun['status']): JSX.Element {
  if (status === 'running') return <LoaderCircle size={15} className="dsh-project-spin" aria-hidden="true" />
  if (status === 'passed') return <CheckCircle2 size={15} aria-hidden="true" />
  return <AlertTriangle size={15} aria-hidden="true" />
}

export function ProjectPanel(props: ProjectViewProps): JSX.Element {
  const cwd = props.useSessions(sessions => sessions.byId[props.sessionId]?.cwd)
  const [root, setRoot] = useState('')
  const [memoryPath, setMemoryPath] = useState('AGENTS.local.md')
  const [memory, setMemory] = useState('')
  const [savedMemory, setSavedMemory] = useState('')
  const [detected, setDetected] = useState('')
  const [sources, setSources] = useState<string[]>([])
  const [commands, setCommands] = useState<ProjectCommand[]>([])
  const [run, setRun] = useState<ProjectRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async (quiet = false) => {
    if (cwd === undefined) {
      setError('This session has no workspace.')
      setLoading(false)
      return
    }
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const [memoryResponse, runsResponse] = await Promise.all([
        fetchJson<MemoryPayload>(endpoint('/api/desktop/project/memory', cwd)),
        fetchJson<RunsPayload>(endpoint('/api/desktop/project/runs', cwd)),
      ])
      if (!memoryResponse.ok) throw new Error(memoryResponse.error ?? 'Unable to load project memory.')
      if (!runsResponse.ok) throw new Error(runsResponse.error ?? 'Unable to load project commands.')
      const content = memoryResponse.content ?? ''
      setRoot(memoryResponse.root ?? runsResponse.root ?? cwd)
      setMemoryPath(memoryResponse.path ?? 'AGENTS.local.md')
      setMemory(current => current === savedMemory ? content : current)
      setSavedMemory(content)
      setDetected(memoryResponse.detected ?? '')
      setSources(memoryResponse.sources ?? [])
      setCommands(runsResponse.commands ?? memoryResponse.commands ?? [])
      setRun(runsResponse.run ?? null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [cwd, savedMemory])

  useEffect(() => { void refresh() }, [cwd])

  useEffect(() => {
    if (run?.status !== 'running') return
    const timer = window.setInterval(() => { void refresh(true) }, 700)
    return () => window.clearInterval(timer)
  }, [refresh, run?.status])

  const saveMemory = useCallback(async () => {
    if (cwd === undefined || saving) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetchJson<{ ok: boolean; error?: string }>(endpoint('/api/desktop/project/memory', cwd), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: memory }),
      })
      if (!response.ok) throw new Error(response.error ?? 'Unable to save project memory.')
      setSavedMemory(memory)
      setSources(current => current.includes('AGENTS.local.md') ? current : [...current, 'AGENTS.local.md'])
      setNotice('Project memory saved and active.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }, [cwd, memory, saving])

  const runCommand = useCallback(async (commandId: string) => {
    if (cwd === undefined || actionId !== null) return
    setActionId(commandId)
    setError(null)
    setNotice(null)
    try {
      const response = await fetchJson<{ ok: boolean; error?: string; run?: ProjectRun }>(endpoint('/api/desktop/project/runs', cwd), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'run', commandId }),
      })
      if (!response.ok || response.run === undefined) throw new Error(response.error ?? 'Unable to run project command.')
      setRun(response.run)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setActionId(null)
    }
  }, [actionId, cwd])

  const cancelRun = useCallback(async () => {
    if (cwd === undefined || run?.status !== 'running') return
    try {
      const response = await fetchJson<{ ok: boolean; error?: string }>(endpoint('/api/desktop/project/runs', cwd), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }),
      })
      if (!response.ok) throw new Error(response.error ?? 'Unable to stop project command.')
      await refresh(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [cwd, refresh, run?.status])

  const dirty = memory !== savedMemory
  const runStats = useMemo(() => {
    if (run === null) return []
    return [
      run.summary.passed === undefined ? null : `${String(run.summary.passed)} passed`,
      run.summary.failed === undefined ? null : `${String(run.summary.failed)} failed`,
      formatDuration(run.durationMs),
    ].filter((value): value is string => value !== null)
  }, [run])

  return (
    <div className="dsh-project-root">
      <style>{PROJECT_CSS}</style>
      <header className="dsh-project-toolbar">
        <span className="dsh-project-icon"><Hammer size={17} aria-hidden="true" /></span>
        <span className="dsh-project-title"><strong>{root.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Project'}</strong><small title={root}>{root || cwd}</small></span>
        <button type="button" title="Refresh project" aria-label="Refresh project" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw size={15} className={loading ? 'dsh-project-spin' : undefined} aria-hidden="true" />
        </button>
      </header>

      {error !== null ? <div className="dsh-project-banner is-error" role="alert"><AlertTriangle size={14} /><span>{error}</span></div> : null}
      {notice !== null ? <div className="dsh-project-banner is-success" role="status"><CheckCircle2 size={14} /><span>{notice}</span></div> : null}

      <div className="dsh-project-grid">
        <section className="dsh-project-pane" aria-labelledby="dsh-project-memory-title">
          <div className="dsh-project-pane-heading">
            <span><Brain size={15} aria-hidden="true" /><h2 id="dsh-project-memory-title">Project memory</h2></span>
            <code>auto-loaded</code>
          </div>
          <div className="dsh-project-memory-body">
            <div className="dsh-project-source-row">
              <FileText size={13} aria-hidden="true" />
              <span title={memoryPath}>AGENTS.local.md</span>
              {sources.map(source => <code key={source}>{source}</code>)}
            </div>
            <textarea
              value={memory}
              aria-label="Project memory"
              spellCheck={false}
              placeholder="# Project memory"
              onChange={event => { setMemory(event.currentTarget.value); setNotice(null) }}
            />
            <div className="dsh-project-memory-actions">
              <button type="button" disabled={detected === '' || saving} title="Use detected project conventions" onClick={() => { setMemory(detected); setNotice(null) }}>
                <WandSparkles size={14} aria-hidden="true" />Detect
              </button>
              <button className="is-primary" type="button" disabled={!dirty || saving} onClick={() => void saveMemory()}>
                {saving ? <LoaderCircle size={14} className="dsh-project-spin" /> : <Save size={14} />}
                {saving ? 'Saving' : 'Save memory'}
              </button>
            </div>
          </div>
        </section>

        <section className="dsh-project-pane" aria-labelledby="dsh-project-runs-title">
          <div className="dsh-project-pane-heading">
            <span><Play size={15} aria-hidden="true" /><h2 id="dsh-project-runs-title">Test & build</h2></span>
            <code>{commands.length} commands</code>
          </div>
          <div className="dsh-project-run-body">
            <div className="dsh-project-command-list">
              {commands.map(command => (
                <div className="dsh-project-command" key={command.id}>
                  <span className={`is-${command.kind}`}>{command.kind}</span>
                  <strong>{command.label}</strong>
                  <code title={command.display}>{command.display}</code>
                  <button type="button" aria-label={`Run ${command.label}`} title={`Run ${command.display}`} disabled={run?.status === 'running' || actionId !== null} onClick={() => void runCommand(command.id)}>
                    {actionId === command.id ? <LoaderCircle size={14} className="dsh-project-spin" /> : <Play size={14} />}
                  </button>
                </div>
              ))}
              {!loading && commands.length === 0 ? <div className="dsh-project-empty">No test or build command detected.</div> : null}
            </div>

            <div className="dsh-project-output-heading">
              <span>{run === null ? 'Latest result' : <>{statusIcon(run.status)}<strong>{run.label}</strong><code className={`is-${run.status}`}>{run.status}</code></>}</span>
              {run !== null ? <span className="dsh-project-run-meta"><Clock3 size={12} />{runStats.join(' · ')}</span> : null}
              {run?.status === 'running' ? <button type="button" title="Stop command" aria-label="Stop command" onClick={() => void cancelRun()}><Square size={13} /></button> : null}
            </div>
            <pre className="dsh-project-output">{run?.output || 'No run output.'}</pre>
          </div>
        </section>
      </div>
    </div>
  )
}

const PROJECT_CSS = `
[data-conversation-scroll]:has(.dsh-project-root) { overflow-y: hidden !important; }
.dsh-project-root { --project-border: var(--dsw-alias-border-l1,rgba(127,127,127,.2)); --project-surface: var(--dsw-alias-bg-layer-1,#171719); --project-raised: var(--dsw-alias-bg-layer-2,#222224); --project-text: var(--dsw-alias-label-primary,#f3f3f4); --project-muted: var(--dsw-alias-label-secondary,#999); --project-accent: var(--dsh-desktop-accent,#4f8cff); container-type: inline-size; height: calc(100vh - 76px); max-height: calc(100vh - 76px); min-height: 0; display: flex; flex-direction: column; overflow: hidden; color: var(--project-text); background: var(--dsw-alias-bg-base,#141416); }
.dsh-project-toolbar { min-height: 62px; padding: 10px 16px; display: grid; grid-template-columns: 32px minmax(0,1fr) 32px; align-items: center; gap: 10px; border-bottom: 1px solid var(--project-border); }
.dsh-project-icon { width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid color-mix(in srgb,var(--project-accent) 32%,var(--project-border)); border-radius: 6px; color: var(--project-accent); background: color-mix(in srgb,var(--project-accent) 12%,transparent); }
.dsh-project-title { min-width: 0; display: grid; gap: 1px; }
.dsh-project-title strong { font-size: 14px; }
.dsh-project-title small { overflow: hidden; color: var(--project-muted); text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.dsh-project-toolbar > button, .dsh-project-command button, .dsh-project-output-heading button { width: 32px; height: 32px; display: grid; place-items: center; padding: 0; border: 1px solid var(--project-border); border-radius: 5px; color: var(--project-muted); background: transparent; cursor: pointer; }
.dsh-project-toolbar > button:hover:not(:disabled), .dsh-project-command button:hover:not(:disabled), .dsh-project-output-heading button:hover { color: var(--project-text); background: var(--project-raised); }
.dsh-project-banner { min-height: 38px; padding: 7px 16px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--project-border); font-size: 11px; }
.dsh-project-banner.is-error { color: #f48a85; background: rgba(239,68,68,.08); }
.dsh-project-banner.is-success { color: #63c58a; background: rgba(34,197,94,.08); }
.dsh-project-grid { min-height: 0; flex: 1; display: grid; grid-template-columns: minmax(260px,.82fr) minmax(340px,1.18fr); padding-bottom: 126px; box-sizing: border-box; }
.dsh-project-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid var(--project-border); }
.dsh-project-pane:last-child { border-right: 0; }
.dsh-project-pane-heading { min-height: 44px; padding: 0 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--project-border); }
.dsh-project-pane-heading > span { display: flex; align-items: center; gap: 7px; }
.dsh-project-pane-heading svg { color: var(--project-accent); }
.dsh-project-pane-heading h2 { margin: 0; font-size: 13px; line-height: 20px; }
.dsh-project-pane-heading code { color: var(--project-muted); font: 9px/14px var(--dsh-desktop-code-font,monospace); }
.dsh-project-memory-body, .dsh-project-run-body { min-height: 0; flex: 1; display: flex; flex-direction: column; overflow: auto; overscroll-behavior: contain; }
.dsh-project-memory-body { padding: 12px 14px; gap: 10px; }
.dsh-project-source-row { min-width: 0; display: flex; align-items: center; gap: 6px; color: var(--project-muted); font-size: 10px; overflow-x: auto; }
.dsh-project-source-row > span { color: var(--project-text); white-space: nowrap; }
.dsh-project-source-row code { padding: 1px 5px; border: 1px solid var(--project-border); border-radius: 4px; white-space: nowrap; font: 9px/14px var(--dsh-desktop-code-font,monospace); }
.dsh-project-memory-body textarea { width: 100%; min-height: 250px; flex: 1; box-sizing: border-box; resize: none; padding: 12px; border: 1px solid var(--project-border); border-radius: 5px; outline: 0; color: var(--project-text); background: color-mix(in srgb,var(--project-raised) 70%,transparent); font: 11px/18px var(--dsh-desktop-code-font,monospace); }
.dsh-project-memory-body textarea:focus { border-color: color-mix(in srgb,var(--project-accent) 65%,var(--project-border)); }
.dsh-project-memory-actions { display: flex; justify-content: flex-end; gap: 7px; }
.dsh-project-memory-actions button { min-height: 32px; padding: 6px 10px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--project-border); border-radius: 5px; color: var(--project-text); background: transparent; font: 500 11px/18px inherit; cursor: pointer; }
.dsh-project-memory-actions button.is-primary { color: #fff; border-color: transparent; background: var(--project-accent); }
.dsh-project-memory-actions button:disabled, .dsh-project-command button:disabled { cursor: default; opacity: .45; }
.dsh-project-command-list { flex: 0 0 auto; border-bottom: 1px solid var(--project-border); }
.dsh-project-command { min-height: 46px; padding: 7px 14px; display: grid; grid-template-columns: 48px minmax(80px,.5fr) minmax(120px,1fr) 32px; align-items: center; gap: 9px; border-bottom: 1px solid color-mix(in srgb,var(--project-border) 62%,transparent); }
.dsh-project-command:last-child { border-bottom: 0; }
.dsh-project-command > span { padding: 2px 5px; border-radius: 3px; color: #74b7fa; background: rgba(59,130,246,.12); text-align: center; font: 700 8px/14px inherit; text-transform: uppercase; }
.dsh-project-command > span.is-build { color: #d7a95a; background: rgba(234,179,8,.1); }
.dsh-project-command > span.is-check { color: #b794f6; background: rgba(139,92,246,.1); }
.dsh-project-command strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.dsh-project-command > code { overflow: hidden; color: var(--project-muted); text-overflow: ellipsis; white-space: nowrap; font: 10px/16px var(--dsh-desktop-code-font,monospace); }
.dsh-project-empty { min-height: 100px; display: grid; place-items: center; color: var(--project-muted); font-size: 11px; }
.dsh-project-output-heading { min-height: 42px; padding: 5px 12px; display: flex; align-items: center; gap: 9px; border-bottom: 1px solid var(--project-border); }
.dsh-project-output-heading > span { display: inline-flex; align-items: center; gap: 7px; color: var(--project-muted); font-size: 10px; }
.dsh-project-output-heading > span:first-child { color: var(--project-text); }
.dsh-project-output-heading strong { font-size: 11px; }
.dsh-project-output-heading code { padding: 1px 5px; border-radius: 3px; font: 8px/14px inherit; text-transform: uppercase; }
.dsh-project-output-heading code.is-passed { color: #63c58a; background: rgba(34,197,94,.1); }
.dsh-project-output-heading code.is-failed, .dsh-project-output-heading code.is-cancelled { color: #f07c78; background: rgba(239,68,68,.09); }
.dsh-project-output-heading code.is-running { color: #74b7fa; background: rgba(59,130,246,.1); }
.dsh-project-output-heading .dsh-project-run-meta { margin-left: auto; }
.dsh-project-output { min-height: 180px; flex: 1; margin: 0; padding: 12px 14px 24px; overflow: auto; color: #c9c9cd; background: rgba(0,0,0,.14); white-space: pre-wrap; overflow-wrap: anywhere; font: 10px/16px var(--dsh-desktop-code-font,monospace); }
.dsh-project-spin { animation: dsh-project-spin .8s linear infinite; }
@keyframes dsh-project-spin { to { transform: rotate(360deg); } }
@media (max-width: 760px) { .dsh-project-grid { display: block; overflow: auto; } .dsh-project-pane { min-height: 380px; border-right: 0; border-bottom: 1px solid var(--project-border); } .dsh-project-command { grid-template-columns: 44px minmax(0,1fr) 32px; } .dsh-project-command > code { display: none; } }
@container (max-width: 620px) { .dsh-project-grid { display: block; overflow: auto; } .dsh-project-pane { min-height: 380px; border-right: 0; border-bottom: 1px solid var(--project-border); } .dsh-project-command { grid-template-columns: 44px minmax(0,1fr) 32px; } .dsh-project-command > code { display: none; } }
@media (prefers-reduced-motion: reduce) { .dsh-project-spin { animation: none; } }
`
