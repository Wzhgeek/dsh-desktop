/** Sandboxed renderer bridge. Keep this file self-contained: sandbox preloads
 * can require Electron, but cannot load arbitrary local CommonJS modules. */

import { contextBridge, ipcRenderer } from 'electron'

const COMMAND_CHANNEL = 'dsh-desktop:command'
const NOTIFICATION_CHANNEL = 'dsh-desktop:notification'
const ACTIVE_SESSION_CHANNEL = 'dsh-desktop:active-session'
const THEME_CHANNEL = 'dsh-desktop:theme'
const OPEN_PATH_CHANNEL = 'dsh-desktop:open-path'

type CommandPayload =
  | { command: 'command-palette' | 'new-session' | 'settings' }
  | { command: 'restore-session'; sessionId: string }

interface NotificationPayload {
  title: string
  body: string
  silent?: boolean
  sessionId?: string
}

interface ThemePayload { dark: boolean }

interface OpenPathRequest { path: string; cwd?: string; opener?: 'system' | 'vscode' | 'cursor' | 'finder' | 'terminal' }
type OpenPathResult = { ok: true } | { ok: false; error: string }

function isBasicCommand(value: unknown): value is 'command-palette' | 'new-session' | 'settings' {
  return value === 'command-palette' || value === 'new-session' || value === 'settings'
}

function parseCommand(value: unknown): CommandPayload | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (isBasicCommand(candidate.command)) return { command: candidate.command }
  if (candidate.command === 'restore-session' && typeof candidate.sessionId === 'string') {
    return { command: candidate.command, sessionId: candidate.sessionId }
  }
  return undefined
}

function parseTheme(value: unknown): ThemePayload | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const dark = (value as Record<string, unknown>).dark
  return typeof dark === 'boolean' ? { dark } : undefined
}

/** Compatibility path used only when the client plugin has not claimed the event. */
function runCommandFallback(command: CommandPayload['command']): void {
  if (command === 'restore-session') return
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
})
