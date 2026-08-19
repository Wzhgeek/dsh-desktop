// Author: Zihan Wang
// <wangzh011031@163.com>
/** Codex-style pinned rows at the top of the workspace sidebar. */

import Folder from 'lucide-react/dist/esm/icons/folder.mjs'
import FolderOpen from 'lucide-react/dist/esm/icons/folder-open.mjs'
import MessageSquare from 'lucide-react/dist/esm/icons/message-square.mjs'
import Pin from 'lucide-react/dist/esm/icons/pin.mjs'
import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { ClientContext, SessionId, SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { bindingsForGroup, relativeLabel } from './match.ts'
import { isPinned, listPins, subscribePins, togglePin } from './store.ts'
import type { PinRecord } from './store.ts'

export interface PinnedSidebarProps {
  ctx: ClientContext
  useSessions: SnapshotSelectorHook<SessionListState>
  useWorkspaces: SnapshotSelectorHook<WorkspaceListState>
}

const LIST_AREA = '.qDHVXG_listArea'
const GROUP = '.qDHVXG_groupSection'
const PROJECT_ROW = '.YDXeBa_projectRow'
const SESSION_ROW = '.YDXeBa_sessionRow'
const TITLE = '.YDXeBa_title'
const ROW_ACTIONS = '.YDXeBa_rowActions'
const HOST_ATTR = 'data-dsh-pins-host'
const PIN_BUTTON_ATTR = 'data-dsh-pin-button'

export function PinnedSidebar({ ctx, useSessions, useWorkspaces }: PinnedSidebarProps): JSX.Element | null {
  const sessions = useSessions(value => value)
  const workspaces = useWorkspaces(value => value)
  const [pins, setPins] = useState(listPins)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [now, setNow] = useState(Date.now)

  useEffect(() => subscribePins(() => { setPins(listPins()) }), [])
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()) }, 30_000)
    return () => { window.clearInterval(timer) }
  }, [])
  useEffect(() => attachSidebarHost(setHost), [])
  useEffect(() => syncRowPinButtons(sessions, workspaces), [pins, sessions, workspaces])

  if (host === null || pins.length === 0) return null

  return createPortal(
    <div className="dsh-pins">
      <style>{PINS_CSS}</style>
      <section aria-label="置顶">
        <h3>置顶</h3>
        {pins.map(pin => pin.type === 'session'
          ? <SessionRow
            key={`session:${pin.id}`}
            ctx={ctx}
            pin={pin}
            sessions={sessions}
            now={now}
          />
          : <WorkspaceBlock
            key={`workspace:${pin.id}`}
            ctx={ctx}
            pin={pin}
            sessions={sessions}
            workspaces={workspaces}
            expanded={expanded[pin.id] !== false}
            now={now}
            onToggle={() => { setExpanded(current => ({ ...current, [pin.id]: current[pin.id] === false })) }}
          />)}
      </section>
    </div>,
    host,
  )
}

function asSessionId(id: string): SessionId {
  return id as SessionId
}

function sessionTitle(summary: { displayTitle: string; blank: boolean }): string {
  return summary.blank ? '新会话' : summary.displayTitle
}

function SessionRow(props: {
  ctx: ClientContext
  pin: PinRecord
  sessions: SessionListState
  now: number
}): JSX.Element | null {
  const id = asSessionId(props.pin.id)
  const summary = props.sessions.byId[id]
  if (summary === undefined) return null
  const selected = props.sessions.current === id
  const pinned = isPinned('session', props.pin.id)
  return (
    <button
      type="button"
      className={selected ? 'is-selected' : undefined}
      aria-selected={selected}
      onClick={() => { props.ctx.sessions.open(id) }}
    >
      <span className="dsh-pins-icon"><MessageSquare size={14} /></span>
      <span className="dsh-pins-copy">
        <strong>{sessionTitle(summary)}</strong>
      </span>
      <small>{relativeLabel(summary.updatedAt, props.now)}</small>
      <PinButton type="session" id={props.pin.id} pinned={pinned} title={pinned ? '取消置顶' : '置顶会话'} />
    </button>
  )
}

function WorkspaceBlock(props: {
  ctx: ClientContext
  pin: PinRecord
  sessions: SessionListState
  workspaces: WorkspaceListState
  expanded: boolean
  now: number
  onToggle: () => void
}): JSX.Element | null {
  const workspace = props.workspaces.items.find(item => item.workspaceId === props.pin.id)
  if (workspace === undefined) return null
  const archived = new Set(props.workspaces.archivedSessionIds)
  const children = workspace.sessionIds
    .map(id => props.sessions.byId[id])
    .filter((summary): summary is NonNullable<typeof summary> => summary !== undefined && !summary.blank && !archived.has(summary.id))
  return (
    <div className="dsh-pins-workspace">
      <button type="button" className="dsh-pins-project" onClick={props.onToggle}>
        <span className="dsh-pins-icon">{props.expanded ? <FolderOpen size={14} /> : <Folder size={14} />}</span>
        <span className="dsh-pins-copy"><strong>{workspace.title}</strong></span>
        <PinButton type="workspace" id={props.pin.id} pinned title="取消置顶" />
      </button>
      {props.expanded ? children.map(summary => (
        <button
          key={summary.id}
          type="button"
          className={props.sessions.current === summary.id ? 'is-selected is-nested' : 'is-nested'}
          onClick={() => { props.ctx.sessions.open(summary.id) }}
        >
          <span className="dsh-pins-icon"><MessageSquare size={14} /></span>
          <span className="dsh-pins-copy"><strong>{summary.displayTitle}</strong></span>
          <small>{relativeLabel(summary.updatedAt, props.now)}</small>
          <PinButton type="session" id={summary.id} pinned={isPinned('session', summary.id)} title={isPinned('session', summary.id) ? '取消置顶' : '置顶会话'} />
        </button>
      )) : null}
    </div>
  )
}

function PinButton(props: { type: 'session' | 'workspace'; id: string; pinned: boolean; title: string }): JSX.Element {
  return (
    <span
      className={props.pinned ? 'dsh-pins-toggle is-pinned' : 'dsh-pins-toggle'}
      title={props.title}
      role="button"
      onMouseDown={event => { event.stopPropagation() }}
      onClick={event => {
        event.preventDefault()
        event.stopPropagation()
        togglePin(props.type, props.id)
      }}
    >
      <Pin size={13} />
    </span>
  )
}

function attachSidebarHost(setHost: Dispatch<SetStateAction<HTMLElement | null>>): () => void {
  const ensure = (): void => {
    const list = document.querySelector<HTMLElement>(LIST_AREA) ?? findListAreaByLabel()
    if (list === null) {
      setHost(current => current === null ? current : null)
      return
    }
    let node = list.querySelector<HTMLElement>(`[${HOST_ATTR}]`)
    if (node === null) {
      node = document.createElement('div')
      node.setAttribute(HOST_ATTR, 'true')
      list.prepend(node)
    }
    setHost(current => current === node ? current : node)
  }
  ensure()
  const observer = new MutationObserver(ensure)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    document.querySelector(`[${HOST_ATTR}]`)?.remove()
  }
}

function findListAreaByLabel(): HTMLElement | null {
  const labels = document.querySelectorAll('div, span, h2, h3')
  for (const label of labels) {
    const text = label.textContent?.trim()
    if (text !== '工作区' && text !== 'Workspaces') continue
    const root = label.parentElement?.parentElement
    const children = root === null || root === undefined ? [] : [...root.children]
    const match = children.find(child => child.querySelector('[role="treeitem"]') !== null) as HTMLElement | undefined
    if (match !== undefined) return match
  }
  const tree = document.querySelector<HTMLElement>('[role="tree"]')
  if (tree !== null) return tree
  const firstItem = document.querySelector('[role="treeitem"]')
  return firstItem?.parentElement ?? null
}

function syncRowPinButtons(sessions: SessionListState, workspaces: WorkspaceListState): () => void {
  ensureRowPinStyles()
  let frame = 0
  const paint = (): void => {
    for (const group of document.querySelectorAll(GROUP)) {
      const project = group.querySelector<HTMLElement>(PROJECT_ROW)
      const sessionRows = [...group.querySelectorAll<HTMLElement>(SESSION_ROW)]
      const label = project?.querySelector(TITLE)?.textContent?.trim() ?? ''
      const binding = bindingsForGroup(label, sessionRows.map(row => row.querySelector(TITLE)?.textContent?.trim() ?? ''), sessions, workspaces)
      if (project !== null && binding.workspace !== undefined) {
        mountRowPin(project, binding.workspace.type, binding.workspace.id)
      }
      sessionRows.forEach((row, index) => {
        const target = binding.sessions[index]
        if (target !== undefined) mountRowPin(row, target.type, target.id)
      })
    }
  }
  const schedule = (): void => {
    if (frame !== 0) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      paint()
    })
  }
  paint()
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    if (frame !== 0) window.cancelAnimationFrame(frame)
    observer.disconnect()
    for (const button of document.querySelectorAll(`[${PIN_BUTTON_ATTR}]`)) button.remove()
  }
}

function ensureRowPinStyles(): void {
  if (document.querySelector('style[data-dsh-row-pin]') !== null) return
  const style = document.createElement('style')
  style.dataset.dshRowPin = 'true'
  style.textContent = `
    .dsh-row-pin { width: 20px; height: 20px; padding: 0; border: 0; color: var(--dsw-alias-label-tertiary); background: transparent; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
    .dsh-row-pin.is-pinned { color: var(--dsh-desktop-accent, #4f8cff); }
  `
  document.head.append(style)
}

function mountRowPin(row: HTMLElement, type: 'session' | 'workspace', id: string): void {
  const actions = row.querySelector<HTMLElement>(ROW_ACTIONS) ?? row
  let button = actions.querySelector<HTMLButtonElement>(`[${PIN_BUTTON_ATTR}]`)
  if (button === null) {
    button = document.createElement('button')
    button.type = 'button'
    button.setAttribute(PIN_BUTTON_ATTR, 'true')
    button.className = 'dsh-row-pin'
    button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>'
    button.addEventListener('mousedown', event => { event.stopPropagation() })
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      const pinType = button?.dataset.dshPinType
      const pinId = button?.dataset.dshPinId
      if (pinType === 'session' || pinType === 'workspace') {
        if (pinId !== undefined) togglePin(pinType, pinId)
      }
    })
    actions.prepend(button)
  }
  button.dataset.dshPinType = type
  button.dataset.dshPinId = id
  const pinned = isPinned(type, id)
  button.classList.toggle('is-pinned', pinned)
  button.title = pinned ? '取消置顶' : type === 'workspace' ? '置顶项目' : '置顶会话'
  button.setAttribute('aria-pressed', pinned ? 'true' : 'false')
}

const PINS_CSS = `
.dsh-pins { padding: 4px 0 8px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.14)); }
.dsh-pins section + section { margin-top: 6px; }
.dsh-pins h3 { margin: 0; padding: 6px 10px 4px; color: var(--dsw-alias-label-secondary, #999); font-size: 11px; line-height: 16px; font-weight: 600; }
.dsh-pins button { box-sizing: border-box; width: 100%; min-height: 32px; padding: 0 8px; display: flex; align-items: center; gap: 6px; border: 0; border-radius: 8px; color: var(--dsw-alias-label-primary); background: transparent; text-align: left; cursor: pointer; }
.dsh-pins button.is-nested { padding-left: 22px; }
.dsh-pins button:hover, .dsh-pins button.is-selected { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.dsh-pins-icon { width: 16px; height: 20px; flex: none; display: grid; place-items: center; color: var(--dsw-alias-label-tertiary); }
.dsh-pins-copy { min-width: 0; flex: 1; }
.dsh-pins-copy strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; line-height: 20px; font-weight: 500; }
.dsh-pins small { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 20px; }
.dsh-pins button:hover small { display: none; }
.dsh-pins-toggle { width: 18px; height: 18px; flex: none; display: none; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); }
.dsh-pins button:hover .dsh-pins-toggle, .dsh-pins-toggle.is-pinned { display: inline-flex; }
.dsh-pins-toggle.is-pinned { color: var(--dsh-desktop-accent, #4f8cff); }
.dsh-row-pin { width: 20px; height: 20px; padding: 0; border: 0; color: var(--dsw-alias-label-tertiary); background: transparent; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.dsh-row-pin.is-pinned { color: var(--dsh-desktop-accent, #4f8cff); }
`
