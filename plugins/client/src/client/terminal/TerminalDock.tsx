// Author: Zihan Wang
// <wangzh011031@163.com>
/** Dockable PTY terminal: bottom or right of the desktop window. */

import Plus from 'lucide-react/dist/esm/icons/plus.mjs'
import X from 'lucide-react/dist/esm/icons/x.mjs'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { ClientContext, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { TERMINAL_TOGGLE_EVENT } from './events.ts'
import { dockBottomInsets } from './layout.ts'
import { TerminalPane } from './TerminalPane.tsx'
import {
  addTerminal,
  clampSize,
  closeTerminal,
  getTerminalState,
  MAX_TERMINAL_TABS,
  selectTerminal,
  setTerminalOpen,
  setTerminalSize,
  subscribeTerminal,
  toggleTerminal,
  type TerminalPlacement,
} from './store.ts'

const COMMAND_EVENT = 'dsh-desktop:command'

export interface TerminalDockProps {
  ctx: ClientContext
  useSessions: SnapshotSelectorHook<SessionListState>
}

export function TerminalDock({ ctx, useSessions }: TerminalDockProps): JSX.Element | null {
  const sessions = useSessions(value => value)
  const [{ open, placement, size, tabs, activeId }, setUi] = useState(getTerminalState)
  const dockRef = useRef<HTMLElement>(null)
  const cwd = currentCwd(sessions, ctx)

  useEffect(() => subscribeTerminal(() => { setUi(getTerminalState()) }), [])

  useEffect(() => {
    const onToggle = (): void => { toggleTerminal() }
    const onCommand = (event: Event): void => {
      if (!(event instanceof CustomEvent) || event.detail?.command !== 'toggle-terminal') return
      event.preventDefault()
      toggleTerminal()
    }
    window.addEventListener(TERMINAL_TOGGLE_EVENT, onToggle)
    window.addEventListener(COMMAND_EVENT, onCommand)
    return () => {
      window.removeEventListener(TERMINAL_TOGGLE_EVENT, onToggle)
      window.removeEventListener(COMMAND_EVENT, onCommand)
    }
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const dock = dockRef.current
    const frame = layoutFrame(dock)
    if (dock === null || frame === null) return
    const apply = (): void => { applyDockLayout(frame, dock, placement, size) }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(frame)
    const { sidebar, center } = frameColumns(frame)
    if (sidebar !== null) observer.observe(sidebar)
    if (center !== null) observer.observe(center)
    return () => {
      observer.disconnect()
      clearDockLayout(frame, dock)
    }
  }, [open, placement, size])

  if (!open || tabs.length === 0) return null

  const style = placement === 'bottom'
    ? { height: `${String(size)}px` }
    : { width: `${String(size)}px` }
  const canAdd = tabs.length < MAX_TERMINAL_TABS

  return (
    <aside ref={dockRef} className={`dsh-terminal-dock dsh-terminal-${placement}`} style={style} aria-label="终端">
      <header>
        <div className="dsh-terminal-tabs" role="tablist" aria-label="终端标签">
          {tabs.map(tab => {
            const active = tab.id === activeId
            return (
              <div key={tab.id} className="dsh-terminal-tab" data-active={active ? 'true' : undefined}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={tab.title}
                  onClick={() => { selectTerminal(tab.id) }}
                >
                  {tab.title}
                </button>
                <button
                  type="button"
                  title="关闭此终端"
                  aria-label={`关闭${tab.title}`}
                  onClick={() => { closeTerminal(tab.id) }}
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
          <button
            type="button"
            className="dsh-terminal-add"
            title={canAdd ? '新建终端' : '最多 8 个终端'}
            disabled={!canAdd}
            onClick={() => { addTerminal() }}
          >
            <Plus size={14} />
          </button>
        </div>
        <button type="button" title="关闭全部终端" onClick={() => { setTerminalOpen(false) }}>
          <X size={14} />
        </button>
      </header>
      <div
        className="dsh-terminal-handle"
        onPointerDown={(event) => { beginResize(event, placement, size) }}
      />
      <div className="dsh-terminal-panes">
        {tabs.map(tab => (
          <TerminalPane key={tab.id} tabId={tab.id} cwd={cwd} hidden={tab.id !== activeId} />
        ))}
      </div>
      <style>{TERMINAL_CSS}</style>
    </aside>
  )
}

function layoutFrame(dock: HTMLElement | null): HTMLElement | null {
  const overlay = dock?.closest('[data-shell-overlay]') ?? document.querySelector('[data-shell-overlay]')
  const frame = overlay instanceof HTMLElement ? overlay.parentElement : null
  return frame instanceof HTMLElement ? frame : null
}

function frameColumns(frame: HTMLElement): {
  sidebar: HTMLElement | null
  center: HTMLElement | null
  details: HTMLElement | null
} {
  const overlay = frame.querySelector('[data-shell-overlay]')
  const kids = [...frame.children].filter((child): child is HTMLElement => {
    if (!(child instanceof HTMLElement) || child === overlay) return false
    if (child.dataset.side === 'sidebar' || child.dataset.side === 'details') return false
    return true
  })
  return {
    sidebar: kids[0] ?? null,
    center: kids[1] ?? kids[0] ?? null,
    details: kids[2] ?? null,
  }
}

function applyDockLayout(
  frame: HTMLElement,
  dock: HTMLElement,
  placement: TerminalPlacement,
  size: number,
): void {
  const { center, details } = frameColumns(frame)
  clearDockLayout(frame, dock)
  const conversation = center
  if (conversation === null) return
  if (placement === 'bottom') {
    const insets = dockBottomInsets(frame.getBoundingClientRect(), conversation.getBoundingClientRect())
    dock.style.left = `${String(insets.left)}px`
    dock.style.right = `${String(insets.right)}px`
    conversation.style.boxSizing = 'border-box'
    conversation.style.paddingBottom = `${String(size)}px`
    return
  }
  const rightColumn = details !== null && details.getBoundingClientRect().width > 1 ? details : conversation
  rightColumn.style.boxSizing = 'border-box'
  rightColumn.style.paddingRight = `${String(size)}px`
}

function clearDockLayout(frame: HTMLElement, dock: HTMLElement): void {
  frame.style.boxSizing = ''
  frame.style.paddingBottom = ''
  frame.style.paddingRight = ''
  dock.style.left = ''
  dock.style.right = ''
  const { center, details } = frameColumns(frame)
  for (const column of [center, details]) {
    if (column === null) continue
    column.style.boxSizing = ''
    column.style.paddingBottom = ''
    column.style.paddingRight = ''
  }
}

function currentCwd(sessions: SessionListState, ctx: ClientContext): string | undefined {
  if (sessions.phase !== 'ready' || sessions.current === undefined) return undefined
  const directory = sessions.byId[sessions.current]?.cwd
  if (typeof directory === 'string' && directory.length > 0) return directory
  const workspace = ctx.workspaces.list.getSnapshot().items[0]?.path
  return typeof workspace === 'string' && workspace.length > 0 ? workspace : undefined
}

function beginResize(
  event: ReactPointerEvent<HTMLDivElement>,
  placement: TerminalPlacement,
  startSize: number,
): void {
  event.preventDefault()
  const origin = placement === 'bottom' ? event.clientY : event.clientX
  const onMove = (move: PointerEvent): void => {
    const delta = placement === 'bottom' ? origin - move.clientY : origin - move.clientX
    setTerminalSize(clampSize(placement, startSize + delta))
  }
  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

const TERMINAL_CSS = `
.dsh-terminal-dock { box-sizing:border-box; position:absolute; z-index:40; display:flex; flex-direction:column; color:var(--dsw-alias-label-primary,#eee); background:#171719; border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22)); pointer-events:auto; }
.dsh-terminal-bottom { right:0; bottom:0; border-left:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22)); border-right:0; border-bottom:0; }
.dsh-terminal-right { top:0; right:0; bottom:0; border-top:0; border-right:0; border-bottom:0; }
.dsh-terminal-dock > header { height:36px; padding:0 6px 0 8px; display:flex; align-items:center; gap:8px; border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16)); }
.dsh-terminal-tabs { min-width:0; flex:1; display:flex; align-items:center; gap:2px; overflow-x:auto; }
.dsh-terminal-tab { flex:none; height:26px; display:flex; align-items:stretch; border:1px solid transparent; border-radius:5px; }
.dsh-terminal-tab[data-active] { border-color:var(--dsw-alias-border-l1,rgba(127,127,127,.2)); background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dsh-terminal-tab > button:first-child { max-width:140px; padding:0 8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; border:0; background:transparent; color:inherit; font:12px/18px inherit; cursor:pointer; }
.dsh-terminal-tab > button:last-child { width:22px; padding:0; display:grid; place-items:center; border:0; border-radius:4px; color:var(--dsw-alias-label-tertiary,#888); background:transparent; cursor:pointer; }
.dsh-terminal-tab > button:last-child:hover { color:var(--dsw-alias-label-primary,#eee); background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dsh-terminal-add, .dsh-terminal-dock > header > button:last-child { flex:none; width:26px; height:26px; padding:0; display:grid; place-items:center; border:0; border-radius:5px; color:var(--dsw-alias-label-tertiary,#888); background:transparent; cursor:pointer; }
.dsh-terminal-add:hover, .dsh-terminal-dock > header > button:last-child:hover { color:var(--dsw-alias-label-primary,#eee); background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dsh-terminal-add:disabled { opacity:.4; cursor:default; }
.dsh-terminal-handle { position:absolute; z-index:1; background:transparent; }
.dsh-terminal-bottom > .dsh-terminal-handle { top:0; left:0; right:0; height:6px; cursor:ns-resize; }
.dsh-terminal-right > .dsh-terminal-handle { top:0; bottom:0; left:0; width:6px; cursor:ew-resize; }
.dsh-terminal-panes { flex:1; min-height:0; min-width:0; position:relative; display:flex; flex-direction:column; }
.dsh-terminal-pane { flex:1; min-height:0; min-width:0; display:flex; flex-direction:column; }
.dsh-terminal-pane[hidden] { display:none; }
.dsh-terminal-host { flex:1; min-height:0; min-width:0; padding:6px 8px 8px; }
.dsh-terminal-host[hidden] { display:none; }
.dsh-terminal-notice { margin:0; padding:12px; color:#f58b87; font-size:12px; }
.dsh-terminal-host .xterm { height:100%; width:100%; cursor:text; position:relative; }
.dsh-terminal-host .xterm-viewport { overflow-y:auto !important; }
.dsh-terminal-host .xterm-screen { position:relative; }
.dsh-terminal-host .xterm-helper-textarea { position:absolute; opacity:0; left:-9999em; }
`
