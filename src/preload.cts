// Author: Zihan Wang
// <wangzh011031@163.com>
/** Sandboxed renderer bridge. Keep this file self-contained: sandbox preloads
 * can require Electron, but cannot load arbitrary local CommonJS modules. */

import { contextBridge, ipcRenderer, webUtils } from 'electron'

const COMMAND_CHANNEL = 'dsh-desktop:command'
const NOTIFICATION_CHANNEL = 'dsh-desktop:notification'
const ACTIVE_SESSION_CHANNEL = 'dsh-desktop:active-session'
const THEME_CHANNEL = 'dsh-desktop:theme'
const OPEN_PATH_CHANNEL = 'dsh-desktop:open-path'
const UPDATE_STATE_CHANNEL = 'dsh-desktop:update-state'
const UPDATE_GET_STATE_CHANNEL = 'dsh-desktop:update-get-state'
const UPDATE_CHECK_CHANNEL = 'dsh-desktop:update-check'
const UPDATE_DOWNLOAD_CHANNEL = 'dsh-desktop:update-download'
const UPDATE_INSTALL_CHANNEL = 'dsh-desktop:update-install'
const UPDATE_OPEN_RELEASES_CHANNEL = 'dsh-desktop:update-open-releases'
const SHELL_GET_STATE_CHANNEL = 'dsh-desktop:shell-get-state'
const SHELL_SET_ACCELERATOR_CHANNEL = 'dsh-desktop:shell-set-accelerator'
const SHELL_REMEMBER_WORKSPACE_CHANNEL = 'dsh-desktop:shell-remember-workspace'
const SHELL_CLEAR_RECENTS_CHANNEL = 'dsh-desktop:shell-clear-recents'
const SHELL_STATE_CHANNEL = 'dsh-desktop:shell-state'
const PTY_CREATE_CHANNEL = 'dsh-desktop:pty-create'
const PTY_WRITE_CHANNEL = 'dsh-desktop:pty-write'
const PTY_RESIZE_CHANNEL = 'dsh-desktop:pty-resize'
const PTY_KILL_CHANNEL = 'dsh-desktop:pty-kill'
const PTY_DATA_CHANNEL = 'dsh-desktop:pty-data'
const PTY_EXIT_CHANNEL = 'dsh-desktop:pty-exit'

type CommandPayload =
  | { command: 'command-palette' | 'new-session' | 'settings' | 'open-workspace-picker' | 'toggle-terminal' }
  | { command: 'restore-session'; sessionId: string }
  | { command: 'open-workspace'; path: string }

interface NotificationPayload {
  title: string
  body: string
  silent?: boolean
  sessionId?: string
}

interface ThemePayload { dark: boolean }

interface OpenPathRequest { path: string; cwd?: string; opener?: 'system' | 'vscode' | 'cursor' | 'finder' | 'terminal' }
type OpenPathResult = { ok: true } | { ok: false; error: string }
type UpdatePhase = 'unsupported' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  availableVersion?: string
  progressPercent?: number
  message?: string
  checkedAt?: number
}
type UpdateActionResult = { ok: true } | { ok: false; error: string }
interface RecentWorkspace { path: string; title?: string; openedAt: number }
interface ShellState {
  accelerator: string
  acceleratorLabel: string
  recents: RecentWorkspace[]
}

function isBasicCommand(value: unknown): value is 'command-palette' | 'new-session' | 'settings' | 'open-workspace-picker' | 'toggle-terminal' {
  return value === 'command-palette' || value === 'new-session' || value === 'settings' || value === 'open-workspace-picker' || value === 'toggle-terminal'
}

function parseCommand(value: unknown): CommandPayload | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (isBasicCommand(candidate.command)) return { command: candidate.command }
  if (candidate.command === 'restore-session' && typeof candidate.sessionId === 'string') {
    return { command: candidate.command, sessionId: candidate.sessionId }
  }
  if (candidate.command === 'open-workspace' && typeof candidate.path === 'string' && candidate.path.length > 0) {
    return { command: candidate.command, path: candidate.path }
  }
  return undefined
}

function parseTheme(value: unknown): ThemePayload | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const dark = (value as Record<string, unknown>).dark
  return typeof dark === 'boolean' ? { dark } : undefined
}

function parseUpdateState(value: unknown): UpdateState | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  const phase = candidate.phase
  if (!isUpdatePhase(phase) || typeof candidate.currentVersion !== 'string' || candidate.currentVersion.length === 0) return undefined
  if (candidate.availableVersion !== undefined && typeof candidate.availableVersion !== 'string') return undefined
  if (candidate.progressPercent !== undefined
    && (typeof candidate.progressPercent !== 'number' || candidate.progressPercent < 0 || candidate.progressPercent > 100)) return undefined
  if (candidate.message !== undefined && typeof candidate.message !== 'string') return undefined
  if (candidate.checkedAt !== undefined && typeof candidate.checkedAt !== 'number') return undefined
  return {
    phase,
    currentVersion: candidate.currentVersion,
    ...(candidate.availableVersion === undefined ? {} : { availableVersion: candidate.availableVersion }),
    ...(candidate.progressPercent === undefined ? {} : { progressPercent: candidate.progressPercent }),
    ...(candidate.message === undefined ? {} : { message: candidate.message }),
    ...(candidate.checkedAt === undefined ? {} : { checkedAt: candidate.checkedAt }),
  }
}

function isUpdatePhase(value: unknown): value is UpdatePhase {
  return value === 'unsupported' || value === 'idle' || value === 'checking' || value === 'available'
    || value === 'not-available' || value === 'downloading' || value === 'downloaded' || value === 'error'
}

function parsePtyId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && /^[A-Za-z0-9_-]+$/.test(value)
    ? value
    : undefined
}

function parsePtyData(value: unknown): { id: string; data: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  const id = parsePtyId(candidate.id)
  if (id === undefined || typeof candidate.data !== 'string') return undefined
  return { id, data: candidate.data }
}

function parsePtyExit(value: unknown): { id: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const id = parsePtyId((value as Record<string, unknown>).id)
  return id === undefined ? undefined : { id }
}

function parseShellState(value: unknown): ShellState | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.accelerator !== 'string' || candidate.accelerator.length === 0) return undefined
  if (typeof candidate.acceleratorLabel !== 'string') return undefined
  if (!Array.isArray(candidate.recents)) return undefined
  const recents: RecentWorkspace[] = []
  for (const entry of candidate.recents) {
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as Record<string, unknown>
    if (typeof item.path !== 'string' || item.path.length === 0) continue
    if (item.title !== undefined && typeof item.title !== 'string') continue
    if (typeof item.openedAt !== 'number') continue
    recents.push(item.title === undefined
      ? { path: item.path, openedAt: item.openedAt }
      : { path: item.path, title: item.title, openedAt: item.openedAt })
  }
  return { accelerator: candidate.accelerator, acceleratorLabel: candidate.acceleratorLabel, recents }
}

/** Compatibility path used only when the client plugin has not claimed the event. */
function runCommandFallback(command: CommandPayload['command']): void {
  if (command === 'restore-session' || command === 'open-workspace' || command === 'open-workspace-picker' || command === 'toggle-terminal') return
  if (command === 'command-palette') {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')]
      .find((entry) => !entry.disabled && sharesComposerAncestor(entry))
    if (button !== undefined) button.click()
    else document.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)')?.focus()
    return
  }
  if (command === 'new-session') {
    document.querySelector<HTMLButtonElement>('button[aria-label="New session"],button[aria-label="新建会话"]')?.click()
    return
  }
  document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click()
}

function sharesComposerAncestor(element: HTMLElement): boolean {
  let ancestor = element.parentElement
  for (let depth = 0; ancestor !== null && depth < 8; depth += 1) {
    if (ancestor.querySelector('textarea') !== null) return true
    ancestor = ancestor.parentElement
  }
  return false
}

function dispatchCommand(payload: CommandPayload): void {
  const event = new CustomEvent<CommandPayload>(COMMAND_CHANNEL, { detail: payload, cancelable: true })
  window.dispatchEvent(event)
  if (!event.defaultPrevented) queueMicrotask(() => { runCommandFallback(payload.command) })
}

function dispatchTheme(payload: ThemePayload): void {
  window.dispatchEvent(new CustomEvent<ThemePayload>(THEME_CHANNEL, { detail: payload }))
}

ipcRenderer.on(COMMAND_CHANNEL, (_event, value: unknown) => {
  const payload = parseCommand(value)
  if (payload !== undefined) dispatchCommand(payload)
})

ipcRenderer.on(THEME_CHANNEL, (_event, value: unknown) => {
  const payload = parseTheme(value)
  if (payload !== undefined) dispatchTheme(payload)
})

contextBridge.exposeInMainWorld('dshDesktop', {
  notify(payload: NotificationPayload): void {
    ipcRenderer.send(NOTIFICATION_CHANNEL, payload)
  },
  setActiveSession(sessionId?: string): void {
    ipcRenderer.send(ACTIVE_SESSION_CHANNEL, sessionId)
  },
  openPath(request: OpenPathRequest): Promise<OpenPathResult> {
    return ipcRenderer.invoke(OPEN_PATH_CHANNEL, request) as Promise<OpenPathResult>
  },
  getUpdateState(): Promise<UpdateState> {
    return ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL) as Promise<UpdateState>
  },
  checkForUpdates(): Promise<UpdateActionResult> {
    return ipcRenderer.invoke(UPDATE_CHECK_CHANNEL) as Promise<UpdateActionResult>
  },
  downloadUpdate(): Promise<UpdateActionResult> {
    return ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL) as Promise<UpdateActionResult>
  },
  installUpdate(): void {
    ipcRenderer.send(UPDATE_INSTALL_CHANNEL)
  },
  openReleasePage(): Promise<UpdateActionResult> {
    return ipcRenderer.invoke(UPDATE_OPEN_RELEASES_CHANNEL) as Promise<UpdateActionResult>
  },
  getShellState(): Promise<ShellState> {
    return ipcRenderer.invoke(SHELL_GET_STATE_CHANNEL) as Promise<ShellState>
  },
  setShowWindowAccelerator(accelerator: string): Promise<UpdateActionResult> {
    return ipcRenderer.invoke(SHELL_SET_ACCELERATOR_CHANNEL, accelerator) as Promise<UpdateActionResult>
  },
  rememberWorkspace(request: { path: string; title?: string }): void {
    ipcRenderer.send(SHELL_REMEMBER_WORKSPACE_CHANNEL, request)
  },
  clearRecentWorkspaces(): void {
    ipcRenderer.send(SHELL_CLEAR_RECENTS_CHANNEL)
  },
  pathForFile(file: File): string {
    try {
      const path = webUtils.getPathForFile(file)
      return typeof path === 'string' ? path : ''
    } catch {
      const fallback = (file as File & { path?: string }).path
      return typeof fallback === 'string' ? fallback : ''
    }
  },
  onShellState(listener: (state: ShellState) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const state = parseShellState(value)
      if (state !== undefined) listener(state)
    }
    ipcRenderer.on(SHELL_STATE_CHANNEL, wrapped)
    return () => { ipcRenderer.removeListener(SHELL_STATE_CHANNEL, wrapped) }
  },
  onUpdateState(listener: (state: UpdateState) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const state = parseUpdateState(value)
      if (state !== undefined) listener(state)
    }
    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrapped)
    return () => { ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrapped) }
  },
  createPty(request: { cwd?: string; cols: number; rows: number }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    return ipcRenderer.invoke(PTY_CREATE_CHANNEL, request) as Promise<{ ok: true; id: string } | { ok: false; error: string }>
  },
  writePty(id: string, data: string): void {
    ipcRenderer.send(PTY_WRITE_CHANNEL, { id, data })
  },
  resizePty(id: string, cols: number, rows: number): void {
    ipcRenderer.send(PTY_RESIZE_CHANNEL, { id, cols, rows })
  },
  killPty(id: string): void {
    ipcRenderer.send(PTY_KILL_CHANNEL, { id })
  },
  onPtyData(listener: (payload: { id: string; data: string }) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const payload = parsePtyData(value)
      if (payload !== undefined) listener(payload)
    }
    ipcRenderer.on(PTY_DATA_CHANNEL, wrapped)
    return () => { ipcRenderer.removeListener(PTY_DATA_CHANNEL, wrapped) }
  },
  onPtyExit(listener: (payload: { id: string }) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const payload = parsePtyExit(value)
      if (payload !== undefined) listener(payload)
    }
    ipcRenderer.on(PTY_EXIT_CHANNEL, wrapped)
    return () => { ipcRenderer.removeListener(PTY_EXIT_CHANNEL, wrapped) }
  },
})
