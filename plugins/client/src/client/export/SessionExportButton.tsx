/** Compact session-export menu for the conversation header. */

import Download from 'lucide-react/dist/esm/icons/download.mjs'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.mjs'
import FileArchive from 'lucide-react/dist/esm/icons/file-archive.mjs'
import FileText from 'lucide-react/dist/esm/icons/file-text.mjs'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { useEffect, useId, useRef, useState } from 'react'
import { exportSession, type SessionExportFormat } from './session-export.ts'
import { downloadSessionLog } from './session-log-bridge.ts'

interface SessionExportButtonProps {
  ctx: ClientContext
  sessionId: SessionId
  useSession: <T>(selector: (snapshot: { running: boolean }) => T) => T
}

type SessionExportChoice = SessionExportFormat | 'session-log'

export function SessionExportButton({ ctx, sessionId, useSession }: SessionExportButtonProps): JSX.Element {
  const running = useSession(snapshot => snapshot.running)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<SessionExportChoice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const triggerId = useId()

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => { document.removeEventListener('pointerdown', close) }
  }, [open])

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open])

  const run = async (format: SessionExportChoice): Promise<void> => {
    setOpen(false)
    setError(null)
    setBusy(format)
    try {
      if (format === 'session-log') await downloadSessionLog(ctx, sessionId)
      else await exportSession(ctx, sessionId, format)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('session export failed', error)
      setError(message)
      window.dshDesktop?.notify({ title: '会话导出失败', body: message })
    } finally {
      setBusy(null)
    }
  }

  const moveMenuFocus = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || items.length === 0) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div className="dsh-session-export" ref={root}>
      <style>{EXPORT_CSS}</style>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        aria-label="会话导出"
        title={running ? '任务运行中，导出已完成的内容' : '导出会话'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={busy !== null}
        onClick={() => setOpen(value => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {busy === null ? <Download size={15} /> : <span className="dsh-session-export-spinner" />}
        <span>会话导出</span>
        <ChevronDown className="dsh-session-export-chevron" size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={menu}
          id={menuId}
          className="dsh-session-export-menu"
          role="menu"
          aria-labelledby={triggerId}
          onKeyDown={moveMenuFocus}
        >
          <button type="button" role="menuitem" onClick={() => { void run('markdown') }}>
            <FileText size={15} /><span><strong>Markdown</strong><small>保留结构与工具记录</small></span>
          </button>
          <button type="button" role="menuitem" onClick={() => { void run('text') }}>
            <FileText size={15} /><span><strong>纯文本</strong><small>适合阅读与归档</small></span>
          </button>
          <button type="button" role="menuitem" onClick={() => { void run('session-log') }}>
            <FileArchive size={15} /><span><strong>Session 日志</strong><small>包含子会话与附件的 ZIP</small></span>
          </button>
        </div>
      ) : null}
      {error === null ? null : <span className="dsh-session-export-error" role="alert" onClick={() => setError(null)}>{error}</span>}
    </div>
  )
}

const EXPORT_CSS = `
.dsh-session-export { position: relative; display: inline-flex; }
.dsh-session-export > button { min-width: 104px; height: 32px; padding: 0 10px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); border-radius: 6px; color: var(--dsw-alias-label-secondary, #999); background: transparent; cursor: pointer; font: inherit; font-size: 12px; line-height: 18px; white-space: nowrap; }
.dsh-session-export > button:hover:not(:disabled), .dsh-session-export > button[aria-expanded="true"] { color: var(--dsw-alias-label-primary, #eee); background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.dsh-session-export > button:focus-visible { outline: 2px solid var(--dsh-desktop-accent, #4f8cff); outline-offset: 2px; }
.dsh-session-export > button:disabled { opacity: .55; cursor: wait; }
.dsh-session-export-chevron { transition: transform .16s ease; }
.dsh-session-export > button[aria-expanded="true"] .dsh-session-export-chevron { transform: rotate(180deg); }
.dsh-session-export-menu { position: absolute; z-index: 40; top: 38px; right: 0; width: 224px; padding: 5px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); border-radius: 7px; background: var(--dsw-alias-bg-layer-2, #242426); box-shadow: 0 14px 36px rgba(0,0,0,.32); }
.dsh-session-export-menu button { width: 100%; min-height: 48px; padding: 7px 9px; display: flex; align-items: center; gap: 9px; border: 0; border-radius: 5px; color: var(--dsw-alias-label-primary, #eee); background: transparent; text-align: left; cursor: pointer; }
.dsh-session-export-menu button:hover, .dsh-session-export-menu button:focus-visible { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); outline: none; }
.dsh-session-export-menu button > svg { flex: none; color: var(--dsh-desktop-accent, #4f8cff); }
.dsh-session-export-menu span { min-width: 0; display: grid; gap: 1px; }
.dsh-session-export-menu strong { font-size: 12px; line-height: 17px; font-weight: 550; letter-spacing: 0; }
.dsh-session-export-menu small { color: var(--dsw-alias-label-secondary, #999); font-size: 10px; line-height: 14px; letter-spacing: 0; }
.dsh-session-export-error { position: absolute; z-index: 41; top: 36px; right: 0; width: min(280px,calc(100vw - 32px)); padding: 8px 10px; border: 1px solid rgba(239,68,68,.35); border-radius: 6px; color: #f58b87; background: var(--dsw-alias-bg-layer-2,#242426); box-shadow: 0 12px 30px rgba(0,0,0,.3); font-size: 10px; line-height: 15px; cursor: pointer; }
.dsh-session-export-spinner { width: 13px; height: 13px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: dsh-session-export-spin .7s linear infinite; }
@keyframes dsh-session-export-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .dsh-session-export-spinner { animation: none; } .dsh-session-export-chevron { transition: none; } }
`
