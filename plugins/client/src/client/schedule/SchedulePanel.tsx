/** Session-local durable reminder panel. */

import BellRing from 'lucide-react/dist/esm/icons/bell-ring.mjs'
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.mjs'
import Clock3 from 'lucide-react/dist/esm/icons/clock-3.mjs'
import Plus from 'lucide-react/dist/esm/icons/plus.mjs'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.mjs'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SCHEDULE_OPEN_EVENT } from './events.ts'

type ScheduleKind = 'after' | 'at' | 'every'

interface ScheduleItem {
  id: string
  kind: ScheduleKind
  prompt: string
  scheduledAt: string
  afterSeconds?: number
  everySeconds?: number
  state: 'scheduled' | 'overdue'
}

interface ScheduleResponse {
  ok: boolean
  items?: ScheduleItem[]
  error?: string
}

export type SchedulePanelProps = PropsRuntime<'conversation.session.header.utilities'>

export function SchedulePanel({ sessionId }: SchedulePanelProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ScheduleItem[]>([])
  const [kind, setKind] = useState<ScheduleKind>('after')
  const [prompt, setPrompt] = useState('')
  const [minutes, setMinutes] = useState(30)
  const [at, setAt] = useState(defaultLocalDateTime)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const promptInput = useRef<HTMLInputElement>(null)
  const panelId = useId()

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const params = new URLSearchParams({ sessionId })
      const response = await fetch(`/api/desktop/schedules?${params.toString()}`, signal === undefined ? undefined : { signal })
      const payload = await response.json() as ScheduleResponse
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? `Schedule request failed (${String(response.status)})`)
      setItems(payload.items ?? [])
    } catch (error) {
      if (signal?.aborted !== true) setError(errorText(error))
    } finally {
      if (signal?.aborted !== true) setBusy(false)
    }
  }, [sessionId])

  useEffect(() => {
    const show = (): void => { setOpen(true) }
    window.addEventListener(SCHEDULE_OPEN_EVENT, show)
    return () => { window.removeEventListener(SCHEDULE_OPEN_EVENT, show) }
  }, [])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void refresh(controller.signal)
    const timer = window.setInterval(() => { void refresh(controller.signal) }, 30_000)
    window.requestAnimationFrame(() => { promptInput.current?.focus() })
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const ordered = useMemo(() => [...items].sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt)), [items])

  const create = async (): Promise<void> => {
    const text = prompt.trim()
    if (text === '') return
    let value: number | string
    if (kind === 'at') {
      const instant = new Date(at)
      if (Number.isNaN(instant.getTime())) { setError('请选择有效时间。'); return }
      value = instant.toISOString()
    } else {
      value = Math.round(minutes * 60)
    }
    setBusy(true)
    setError(null)
    try {
      const payload = await mutate({ action: 'create', sessionId, prompt: text, kind, value })
      setItems(payload.items ?? [])
      setPrompt('')
    } catch (error) {
      setError(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const payload = await mutate({ action: 'delete', sessionId, id })
      setItems(payload.items ?? [])
    } catch (error) {
      setError(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dsh-schedule" ref={root}>
      <style>{SCHEDULE_CSS}</style>
      <button className="dsh-schedule-trigger" type="button" title="定时任务" aria-label="定时任务" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
        <CalendarClock size={15} />
        {items.length > 0 ? <span>{items.length}</span> : null}
      </button>
      {open ? (
        <aside className="dsh-schedule-panel" id={panelId} aria-label="定时任务">
          <header><div><CalendarClock size={16} /><strong>定时任务</strong></div><button type="button" title="刷新" aria-label="刷新定时任务" disabled={busy} onClick={() => { void refresh() }}><RefreshCw size={14} /></button></header>
          <form onSubmit={event => { event.preventDefault(); void create() }}>
            <input ref={promptInput} value={prompt} maxLength={500} placeholder="任务内容" aria-label="任务内容" onChange={event => setPrompt(event.currentTarget.value)} />
            <div className="dsh-schedule-modes" role="group" aria-label="执行时间">
              <button type="button" aria-pressed={kind === 'after'} onClick={() => setKind('after')}>稍后</button>
              <button type="button" aria-pressed={kind === 'at'} onClick={() => setKind('at')}>指定时间</button>
              <button type="button" aria-pressed={kind === 'every'} onClick={() => { setKind('every'); setMinutes(value => Math.max(5, value)) }}>重复</button>
            </div>
            <div className="dsh-schedule-time">
              {kind === 'at' ? <input type="datetime-local" value={at} aria-label="执行时间" onChange={event => setAt(event.currentTarget.value)} /> : (
                <><input type="number" min={kind === 'every' ? 5 : 1} max={525600} value={minutes} aria-label="分钟数" onChange={event => setMinutes(Math.max(kind === 'every' ? 5 : 1, Number(event.currentTarget.value) || 0))} /><span>分钟</span></>
              )}
              <button className="dsh-schedule-create" type="submit" title="添加定时任务" aria-label="添加定时任务" disabled={busy || prompt.trim() === ''}><Plus size={15} /></button>
            </div>
          </form>
          <div className="dsh-schedule-list">
            {ordered.length === 0 ? <div className="dsh-schedule-empty"><BellRing size={18} /><span>暂无定时任务</span></div> : ordered.map(item => (
              <article key={item.id}>
                <Clock3 size={14} />
                <div><strong>{item.prompt}</strong><small><span className={item.state === 'overdue' ? 'is-overdue' : undefined}>{item.state === 'overdue' ? '已逾期' : scheduleKindLabel(item)}</span> · {formatScheduleDate(item.scheduledAt)}</small></div>
                <button type="button" title="删除" aria-label={`删除 ${item.prompt}`} disabled={busy} onClick={() => { void remove(item.id) }}><Trash2 size={14} /></button>
              </article>
            ))}
          </div>
          {error === null ? null : <p role="alert">{error}</p>}
        </aside>
      ) : null}
    </div>
  )
}

async function mutate(body: Record<string, unknown>): Promise<ScheduleResponse> {
  const response = await fetch('/api/desktop/schedules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const payload = await response.json() as ScheduleResponse
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? `Schedule request failed (${String(response.status)})`)
  return payload
}

function defaultLocalDateTime(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  date.setSeconds(0, 0)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function scheduleKindLabel(item: ScheduleItem): string {
  if (item.kind === 'every') return `每 ${formatDuration(item.everySeconds ?? 0)}`
  return '执行一次'
}

function formatDuration(seconds: number): string {
  if (seconds % 3600 === 0) return `${String(seconds / 3600)} 小时`
  return `${String(Math.round(seconds / 60))} 分钟`
}

function formatScheduleDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }

const SCHEDULE_CSS = `
.dsh-schedule { position:relative; display:inline-flex; }
.dsh-schedule-trigger { box-sizing:border-box; min-width:30px; height:30px; padding:0 7px; display:inline-flex; align-items:center; justify-content:center; gap:4px; border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2)); border-radius:6px; color:var(--dsw-alias-label-secondary,#999); background:transparent; cursor:pointer; }
.dsh-schedule-trigger:hover, .dsh-schedule-trigger[aria-expanded="true"] { color:var(--dsw-alias-label-primary,#eee); background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dsh-schedule-trigger > span { min-width:14px; height:14px; padding:0 3px; border-radius:7px; color:#fff; background:var(--dsh-desktop-accent,#4f8cff); font-size:9px; line-height:14px; }
.dsh-schedule-panel { box-sizing:border-box; position:fixed; z-index:55; top:52px; right:16px; width:min(340px,calc(100vw - 32px)); max-height:calc(100vh - 68px); overflow-y:auto; border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22)); border-radius:8px; color:var(--dsw-alias-label-primary,#eee); background:var(--dsw-alias-bg-layer-2,#242426); box-shadow:0 18px 48px rgba(0,0,0,.38); }
.dsh-schedule-panel > header { height:44px; padding:0 12px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16)); }
.dsh-schedule-panel > header > div { display:flex; align-items:center; gap:7px; }
.dsh-schedule-panel > header strong { font-size:13px; line-height:18px; font-weight:600; letter-spacing:0; }
.dsh-schedule-panel > header button, .dsh-schedule-list article > button { width:27px; height:27px; padding:0; display:grid; place-items:center; border:0; border-radius:5px; color:var(--dsw-alias-label-tertiary,#888); background:transparent; cursor:pointer; }
.dsh-schedule-panel > header button:hover, .dsh-schedule-list article > button:hover { color:var(--dsw-alias-label-primary,#eee); background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dsh-schedule-panel form { padding:12px; display:grid; gap:8px; border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16)); }
.dsh-schedule-panel input { box-sizing:border-box; min-width:0; height:32px; padding:0 9px; border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28)); border-radius:6px; outline:none; color:var(--dsw-alias-label-primary,#eee); background:var(--dsw-alias-bg-base,#171719); font:12px/18px inherit; }
.dsh-schedule-panel input:focus { border-color:var(--dsh-desktop-accent,#4f8cff); }
.dsh-schedule-modes { display:grid; grid-template-columns:repeat(3,1fr); gap:3px; padding:3px; border-radius:6px; background:var(--dsw-alias-bg-base,#171719); }
.dsh-schedule-modes button { height:27px; border:0; border-radius:4px; color:var(--dsw-alias-label-secondary,#999); background:transparent; cursor:pointer; font:11px/16px inherit; }
.dsh-schedule-modes button[aria-pressed="true"] { color:var(--dsw-alias-label-primary,#eee); background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16)); }
.dsh-schedule-time { display:grid; grid-template-columns:minmax(0,1fr) auto 32px; align-items:center; gap:7px; color:var(--dsw-alias-label-secondary,#999); font-size:11px; }
.dsh-schedule-time input[type="datetime-local"] { grid-column:1/3; }
.dsh-schedule-create { width:32px; height:32px; padding:0; display:grid; place-items:center; border:0; border-radius:6px; color:#fff; background:var(--dsh-desktop-accent,#4f8cff); cursor:pointer; }
.dsh-schedule-create:disabled { opacity:.4; cursor:default; }
.dsh-schedule-list { padding:5px; }
.dsh-schedule-list article { min-height:52px; padding:7px; display:grid; grid-template-columns:18px minmax(0,1fr) 27px; align-items:center; gap:7px; border-radius:6px; }
.dsh-schedule-list article:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08)); }
.dsh-schedule-list article > svg { color:var(--dsh-desktop-accent,#4f8cff); }
.dsh-schedule-list article > div { min-width:0; display:grid; gap:2px; }
.dsh-schedule-list article strong { overflow:hidden; font-size:12px; line-height:17px; font-weight:550; letter-spacing:0; text-overflow:ellipsis; white-space:nowrap; }
.dsh-schedule-list article small { color:var(--dsw-alias-label-tertiary,#888); font-size:10px; line-height:14px; }
.dsh-schedule-list article small .is-overdue { color:#f59e0b; }
.dsh-schedule-empty { height:86px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:7px; color:var(--dsw-alias-label-tertiary,#888); font-size:11px; }
.dsh-schedule-panel > p { margin:0; padding:8px 12px 11px; color:#f58b87; font-size:10px; line-height:15px; }
`
