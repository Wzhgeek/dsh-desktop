/** Non-destructive session rollback through completed-turn forks. */

import Check from 'lucide-react/dist/esm/icons/check.mjs'
import GitFork from 'lucide-react/dist/esm/icons/git-fork.mjs'
import History from 'lucide-react/dist/esm/icons/history.mjs'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.mjs'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { deriveTurnRailItems } from '../turn-rail/turns.ts'
import { CHECKPOINT_OPEN_EVENT } from './events.ts'

interface CheckpointPanelProps extends PropsRuntime<'conversation.session.header.utilities'> {
  ctx: ClientContext
}

interface CheckpointItem {
  turn: number
  seq: number
  summary: string
}

export function CheckpointPanel({ ctx, sessionId, useSession }: CheckpointPanelProps): JSX.Element {
  const legacyNodes = useSession(snapshot => snapshot.nodes)
  const order = useSession(snapshot => snapshot.chat.order)
  const nodeStore = useSession(snapshot => snapshot.chat.nodes)
  const turnEnds = useSession(snapshot => snapshot.turnEnds)
  const running = useSession(snapshot => snapshot.running)
  const [open, setOpen] = useState(false)
  const [busySeq, setBusySeq] = useState<number | null>(null)
  const [created, setCreated] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const checkpoints = useMemo<CheckpointItem[]>(() => {
    const items = deriveTurnRailItems(legacyNodes, order, nodeStore)
    return items.flatMap(item => {
      const seq = turnEnds.get(item.number)
      return seq === undefined ? [] : [{ turn: item.number, seq, summary: item.summary }]
    }).reverse()
  }, [legacyNodes, nodeStore, order, turnEnds])

  useEffect(() => {
    const show = (): void => { setOpen(true) }
    window.addEventListener(CHECKPOINT_OPEN_EVENT, show)
    return () => { window.removeEventListener(CHECKPOINT_OPEN_EVENT, show) }
  }, [])

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

  const restore = async (item: CheckpointItem): Promise<void> => {
    setBusySeq(item.seq)
    setError(null)
    setCreated(null)
    try {
      const child = await ctx.sessions.fork({ sessionId, atSeq: item.seq, increaseTitle: true })
      setCreated(item.seq)
      setOpen(false)
      ctx.sessions.open(child)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusySeq(null)
    }
  }

  return (
    <div className="dsh-checkpoint" ref={root}>
      <style>{CHECKPOINT_CSS}</style>
      <button className="dsh-checkpoint-trigger" type="button" title="会话检查点" aria-label="会话检查点" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
        <History size={15} />
      </button>
      {open ? (
        <aside className="dsh-checkpoint-panel" id={panelId} aria-label="会话检查点">
          <header><div><History size={16} /><strong>会话检查点</strong></div><small>{checkpoints.length}</small></header>
          <div className="dsh-checkpoint-list">
            {checkpoints.length === 0 ? (
              <div className="dsh-checkpoint-empty"><GitFork size={18} /><span>暂无可恢复轮次</span></div>
            ) : checkpoints.map(item => (
              <button key={item.seq} type="button" disabled={busySeq !== null || running} onClick={() => { void restore(item) }}>
                <span className="dsh-checkpoint-number">{item.turn}</span>
                <span className="dsh-checkpoint-copy"><strong>{item.summary}</strong><small>第 {item.turn} 轮 · seq {item.seq}</small></span>
                {created === item.seq ? <Check size={14} /> : <RotateCcw size={14} />}
              </button>
            ))}
          </div>
          {running ? <p role="status">当前轮次完成后可恢复检查点。</p> : error === null ? null : <p role="alert">{error}</p>}
        </aside>
      ) : null}
    </div>
  )
}

const CHECKPOINT_CSS = `
.dsh-checkpoint { position:relative; display:inline-flex; }
.dsh-checkpoint-trigger { box-sizing:border-box; width:30px; height:30px; padding:0; display:grid; place-items:center; border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2)); border-radius:6px; color:var(--dsw-alias-label-secondary,#999); background:transparent; cursor:pointer; }
.dsh-checkpoint-trigger:hover, .dsh-checkpoint-trigger[aria-expanded="true"] { color:var(--dsw-alias-label-primary,#eee); background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dsh-checkpoint-panel { box-sizing:border-box; position:fixed; z-index:55; top:52px; right:16px; width:min(340px,calc(100vw - 32px)); max-height:calc(100vh - 68px); overflow-y:auto; border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22)); border-radius:8px; color:var(--dsw-alias-label-primary,#eee); background:var(--dsw-alias-bg-layer-2,#242426); box-shadow:0 18px 48px rgba(0,0,0,.38); }
.dsh-checkpoint-panel > header { height:44px; padding:0 12px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16)); }
.dsh-checkpoint-panel > header > div { display:flex; align-items:center; gap:7px; }
.dsh-checkpoint-panel > header strong { font-size:13px; line-height:18px; font-weight:600; letter-spacing:0; }
.dsh-checkpoint-panel > header small { color:var(--dsw-alias-label-tertiary,#888); font-size:10px; }
.dsh-checkpoint-list { padding:5px; }
.dsh-checkpoint-list > button { box-sizing:border-box; width:100%; min-height:52px; padding:6px 7px; display:grid; grid-template-columns:24px minmax(0,1fr) 24px; align-items:center; gap:8px; border:0; border-radius:6px; color:inherit; background:transparent; text-align:left; cursor:pointer; }
.dsh-checkpoint-list > button:hover:not(:disabled), .dsh-checkpoint-list > button:focus-visible { outline:0; background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1)); }
.dsh-checkpoint-list > button:disabled { opacity:.48; cursor:default; }
.dsh-checkpoint-number { width:24px; height:24px; display:grid; place-items:center; border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22)); border-radius:5px; color:var(--dsh-desktop-accent,#4f8cff); font-size:10px; }
.dsh-checkpoint-copy { min-width:0; display:grid; gap:2px; }
.dsh-checkpoint-copy strong, .dsh-checkpoint-copy small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; letter-spacing:0; }
.dsh-checkpoint-copy strong { font-size:12px; line-height:17px; font-weight:550; }
.dsh-checkpoint-copy small { color:var(--dsw-alias-label-tertiary,#888); font-size:9px; line-height:13px; }
.dsh-checkpoint-list > button > svg { justify-self:center; color:var(--dsw-alias-label-secondary,#999); }
.dsh-checkpoint-empty { height:96px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:7px; color:var(--dsw-alias-label-tertiary,#888); font-size:11px; }
.dsh-checkpoint-panel > p { margin:0; padding:8px 12px 11px; color:var(--dsw-alias-label-secondary,#999); font-size:10px; line-height:15px; }
`
