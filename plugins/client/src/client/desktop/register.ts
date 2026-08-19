// Author: Zihan Wang
// <wangzh011031@163.com>
/**
 * Electron renderer bridge. Keeps desktop-only lifecycle state outside the
 * web runtime while routing commands through the runtime's public services.
 * @module @dsh-desktop/client/desktop
 */

import type { ClientContext, SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { FileOpenerSetting } from './FileOpenerSetting.tsx'
import { ShortcutSetting } from './ShortcutSetting.tsx'
import { UpdateSetting } from './UpdateSetting.tsx'
import type { DesktopFileOpener } from './file-openers.ts'
import type { DesktopShellApi } from './shell-api.ts'
import type { DesktopUpdateApi } from './update-api.ts'
import { installFilePathLinks } from './file-paths.ts'
import { PALETTE_OPEN_EVENT } from '../palette/CommandPalette.tsx'
import { openDesktopWorkspace, pickDesktopWorkspace, rememberCurrentWorkspace } from './workspaces.ts'

/** Commands sent by Electron's application menu and startup coordinator. */
export type DesktopCommand =
  | { command: 'command-palette' | 'new-session' | 'settings' | 'open-workspace-picker' | 'toggle-terminal' }
  | { command: 'restore-session'; sessionId: string }
  | { command: 'open-workspace'; path: string }

/** Payload accepted by the main-process Notification bridge. */
export interface DesktopNotification {
  title: string
  body: string
  silent?: boolean
  sessionId?: string
}

/** Minimal API exposed by the context-isolated preload script. */
export interface DesktopApi extends DesktopUpdateApi, DesktopShellApi {
  notify(payload: DesktopNotification): void
  setActiveSession(sessionId: string | undefined): void
  openPath(request: { path: string; cwd?: string; opener?: DesktopFileOpener }): Promise<{ ok: true } | { ok: false; error: string }>
  pathForFile(file: File): string
  createPty(request: { cwd?: string; cols: number; rows: number }): Promise<{ ok: true; id: string } | { ok: false; error: string }>
  writePty(id: string, data: string): void
  resizePty(id: string, cols: number, rows: number): void
  killPty(id: string): void
  onPtyData(listener: (payload: { id: string; data: string }) => void): () => void
  onPtyExit(listener: (payload: { id: string }) => void): () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One self-contained preference row in General settings. */
    'settings.general.item': { kind: 'list'; scope: 'root'; owner: { children?: never } }
  }
}

declare global {
  interface Window {
    dshDesktop?: DesktopApi
  }
}

const COMMAND_EVENT = 'dsh-desktop:command'

/** Read a validated desktop command out of one DOM event. */
function commandFrom(event: Event): DesktopCommand | undefined {
  if (!(event instanceof CustomEvent) || typeof event.detail !== 'object' || event.detail === null) return undefined
  const detail = event.detail as Record<string, unknown>
  const command = detail.command
  if (command === 'command-palette' || command === 'new-session' || command === 'settings' || command === 'open-workspace-picker' || command === 'toggle-terminal') {
    return { command }
  }
  if (command === 'restore-session' && typeof detail.sessionId === 'string' && detail.sessionId.length > 0) {
    return { command, sessionId: detail.sessionId }
  }
  if (command === 'open-workspace' && typeof detail.path === 'string' && detail.path.length > 0) {
    return { command, path: detail.path }
  }
  return undefined
}

/** Open the existing settings shell without coupling to its component state. */
function openSettings(): void {
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"][aria-expanded]')
  trigger?.click()
}

/** Open the desktop-wide command palette overlay. */
function openCommandPalette(): void {
  window.dispatchEvent(new Event(PALETTE_OPEN_EVENT))
}

/** A task completion transition worth surfacing through the OS. */
function completionNotifications(
  previous: SessionListState,
  current: SessionListState,
): DesktopNotification[] {
  const notifications: DesktopNotification[] = []
  for (const id of current.ids) {
    const before = previous.byId[id]
    const after = current.byId[id]
    if (before?.running !== true || after === undefined || after.running || after.blank) continue
    notifications.push({
      title: '任务已完成',
      body: after.displayTitle,
      sessionId: id,
    })
  }
  return notifications
}

interface BudgetCheckResponse {
  notify: boolean
  config: { period: 'daily' | 'monthly'; notifyAtPercent: number }
  status: { spentUsd: number; limitUsd: number }
}

/** Atomically claim and surface a budget alert for the current period. */
async function checkUsageBudget(): Promise<void> {
  if (window.dshDesktop === undefined) return
  try {
    const response = await fetch('/api/desktop/usage/budget/check', { method: 'POST' })
    if (!response.ok) return
    const result = await response.json() as BudgetCheckResponse
    if (!result.notify) return
    const period = result.config.period === 'daily' ? '今日' : '本月'
    window.dshDesktop?.notify({
      title: '成本预算提醒',
      body: `${period}预估花费 $${result.status.spentUsd.toFixed(2)}，已达到 $${result.status.limitUsd.toFixed(2)} 预算的 ${String(result.config.notifyAtPercent)}%。`,
    })
  } catch {
    // Budget checks should never interrupt session completion handling.
  }
}

/**
 * Register command, selection-persistence, and completion-notification bridges.
 * Browser-only launches degrade to no-ops because no preload API is present.
 */
export function register(ctx: ClientContext): void {
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-file-opener',
    order: 40,
  }, FileOpenerSetting))
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-shortcut',
    order: 45,
  }, ShortcutSetting))
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-updates',
    order: 50,
  }, UpdateSetting))

  const disposeFilePathLinks = installFilePathLinks(ctx)
  let pendingRestore: SessionId | undefined
  let lastRememberedPath: string | undefined
  let previous = ctx.sessions.list.getSnapshot()
  if (previous.phase === 'ready') window.dshDesktop?.setActiveSession(previous.current)
  void checkUsageBudget()

  const rememberIfNeeded = (): void => {
    const path = rememberCurrentWorkspace(ctx)
    if (path !== undefined) lastRememberedPath = path
  }
  if (previous.phase === 'ready') rememberIfNeeded()

  const restoreIfReady = (snapshot: SessionListState): void => {
    if (pendingRestore === undefined || snapshot.phase !== 'ready') return
    const target = pendingRestore
    pendingRestore = undefined
    if (snapshot.byId[target] !== undefined && snapshot.current !== target) ctx.sessions.open(target)
  }

  const onCommand = (event: Event): void => {
    const detail = commandFrom(event)
    if (detail === undefined) return
    event.preventDefault()
    switch (detail.command) {
      case 'new-session':
        ctx.workspaces.startSession()
        return
      case 'settings':
        openSettings()
        return
      case 'command-palette':
        openCommandPalette()
        return
      case 'open-workspace-picker':
        void pickDesktopWorkspace(ctx).catch(error => {
          window.dshDesktop?.notify({
            title: '无法打开工作区',
            body: error instanceof Error ? error.message : String(error),
          })
        })
        return
      case 'open-workspace':
        void openDesktopWorkspace(ctx, detail.path).catch(error => {
          window.dshDesktop?.notify({
            title: '无法打开工作区',
            body: error instanceof Error ? error.message : String(error),
          })
        })
        return
      case 'restore-session':
        pendingRestore = detail.sessionId as SessionId
        restoreIfReady(ctx.sessions.list.getSnapshot())
        return
      case 'toggle-terminal':
        return
    }
  }

  window.addEventListener(COMMAND_EVENT, onCommand)
  const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(() => {
    if (lastRememberedPath === undefined) rememberIfNeeded()
  })
  const unsubscribe = ctx.sessions.list.subscribe(() => {
    const current = ctx.sessions.list.getSnapshot()
    restoreIfReady(current)
    if (current.phase === 'ready') {
      window.dshDesktop?.setActiveSession(current.current)
      const cwd = current.current === undefined ? undefined : current.byId[current.current]?.cwd
      if (cwd !== undefined) {
        if (cwd !== lastRememberedPath) rememberIfNeeded()
      } else if (lastRememberedPath === undefined) {
        rememberIfNeeded()
      }
      const notifications = completionNotifications(previous, current)
      for (const payload of notifications) window.dshDesktop?.notify(payload)
      if (notifications.length > 0) void checkUsageBudget()
    }
    previous = current
  })

  ctx.effect(() => () => {
    disposeFilePathLinks()
    unsubscribe()
    unsubscribeWorkspaces()
    window.removeEventListener(COMMAND_EVENT, onCommand)
  }, 'desktop-client: Electron lifecycle bridge')
}
