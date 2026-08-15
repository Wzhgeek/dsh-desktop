/** Shared, deliberately small IPC contract for the Electron desktop shell. */

export const DESKTOP_COMMAND_CHANNEL = 'dsh-desktop:command'
export const DESKTOP_NOTIFICATION_CHANNEL = 'dsh-desktop:notification'
export const DESKTOP_ACTIVE_SESSION_CHANNEL = 'dsh-desktop:active-session'
export const DESKTOP_THEME_CHANNEL = 'dsh-desktop:theme'
export const DESKTOP_OPEN_PATH_CHANNEL = 'dsh-desktop:open-path'

/** Explicit local application choices exposed by the renderer. */
export type DesktopFileOpener = 'system' | 'vscode' | 'cursor' | 'finder' | 'terminal'

/** Commands the native application menu can ask the web application to run. */
export type DesktopCommandPayload =
  | { command: 'command-palette' | 'new-session' | 'settings' }
  | { command: 'restore-session'; sessionId: string }

/** Native notification request accepted from the trusted renderer. */
export interface DesktopNotificationPayload {
  title: string
  body: string
  silent?: boolean
  sessionId?: string
}

/** System appearance snapshot sent whenever Electron observes an OS change. */
export interface DesktopThemePayload {
  dark: boolean
}

/** Renderer request to reveal one local file or directory in its OS app. */
export interface DesktopOpenPathRequest {
  path: string
  cwd?: string
  opener?: DesktopFileOpener
}

/** Result returned by the main-process file opener. */
export type DesktopOpenPathResult = { ok: true } | { ok: false; error: string }

export const MAX_SESSION_ID_LENGTH = 256
export const MAX_NOTIFICATION_TITLE_LENGTH = 120
export const MAX_NOTIFICATION_BODY_LENGTH = 1_000
export const MAX_LOCAL_PATH_LENGTH = 4_096

/** Reject non-string, empty, oversized, or control-character session ids. */
export function isSessionId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_SESSION_ID_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value)
}

/** Parse an untrusted renderer notification into the bounded wire shape. */
export function parseNotification(value: unknown): DesktopNotificationPayload | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.title !== 'string' || candidate.title.trim() === ''
    || candidate.title.length > MAX_NOTIFICATION_TITLE_LENGTH) return undefined
  if (typeof candidate.body !== 'string' || candidate.body.length > MAX_NOTIFICATION_BODY_LENGTH) return undefined
  if (candidate.silent !== undefined && typeof candidate.silent !== 'boolean') return undefined
  if (candidate.sessionId !== undefined && !isSessionId(candidate.sessionId)) return undefined
  return {
    title: candidate.title,
    body: candidate.body,
    ...(candidate.silent === undefined ? {} : { silent: candidate.silent }),
    ...(candidate.sessionId === undefined ? {} : { sessionId: candidate.sessionId }),
  }
}

/** Parse a bounded local-path request crossing the isolated renderer boundary. */
export function parseOpenPathRequest(value: unknown): DesktopOpenPathRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (!isLocalPath(candidate.path)) return undefined
  if (candidate.cwd !== undefined && !isLocalPath(candidate.cwd)) return undefined
  if (candidate.opener !== undefined && !isDesktopFileOpener(candidate.opener)) return undefined
  return {
    path: candidate.path,
    ...(candidate.cwd === undefined ? {} : { cwd: candidate.cwd }),
    ...(candidate.opener === undefined ? {} : { opener: candidate.opener }),
  }
}

/** Guard the bounded set of native opener implementations. */
export function isDesktopFileOpener(value: unknown): value is DesktopFileOpener {
  return value === 'system' || value === 'vscode' || value === 'cursor' || value === 'finder' || value === 'terminal'
}

function isLocalPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= MAX_LOCAL_PATH_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value)
}
