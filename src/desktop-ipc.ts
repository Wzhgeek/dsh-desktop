/** Shared, deliberately small IPC contract for the Electron desktop shell. */

export const DESKTOP_COMMAND_CHANNEL = 'dsh-desktop:command'
export const DESKTOP_NOTIFICATION_CHANNEL = 'dsh-desktop:notification'
export const DESKTOP_ACTIVE_SESSION_CHANNEL = 'dsh-desktop:active-session'
export const DESKTOP_THEME_CHANNEL = 'dsh-desktop:theme'
export const DESKTOP_OPEN_PATH_CHANNEL = 'dsh-desktop:open-path'
export const DESKTOP_UPDATE_STATE_CHANNEL = 'dsh-desktop:update-state'
export const DESKTOP_UPDATE_GET_STATE_CHANNEL = 'dsh-desktop:update-get-state'
export const DESKTOP_UPDATE_CHECK_CHANNEL = 'dsh-desktop:update-check'
export const DESKTOP_UPDATE_DOWNLOAD_CHANNEL = 'dsh-desktop:update-download'
export const DESKTOP_UPDATE_INSTALL_CHANNEL = 'dsh-desktop:update-install'
export const DESKTOP_UPDATE_OPEN_RELEASES_CHANNEL = 'dsh-desktop:update-open-releases'

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

/** Observable lifecycle of the packaged application's release updater. */
export type DesktopUpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/** Bounded updater state sent from the main process to the settings UI. */
export interface DesktopUpdateState {
  phase: DesktopUpdatePhase
  currentVersion: string
  availableVersion?: string
  progressPercent?: number
  message?: string
  checkedAt?: number
}

/** Result returned by update commands that do not terminate the application. */
export type DesktopUpdateActionResult = { ok: true } | { ok: false; error: string }

export const MAX_SESSION_ID_LENGTH = 256
export const MAX_NOTIFICATION_TITLE_LENGTH = 120
export const MAX_NOTIFICATION_BODY_LENGTH = 1_000
export const MAX_LOCAL_PATH_LENGTH = 4_096
export const MAX_UPDATE_VERSION_LENGTH = 80
export const MAX_UPDATE_MESSAGE_LENGTH = 1_000

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

/** Validate update state before it crosses the context-isolated bridge. */
export function parseUpdateState(value: unknown): DesktopUpdateState | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (!isDesktopUpdatePhase(candidate.phase) || !isUpdateVersion(candidate.currentVersion)) return undefined
  if (candidate.availableVersion !== undefined && !isUpdateVersion(candidate.availableVersion)) return undefined
  if (candidate.progressPercent !== undefined
    && (typeof candidate.progressPercent !== 'number' || !Number.isFinite(candidate.progressPercent)
      || candidate.progressPercent < 0 || candidate.progressPercent > 100)) return undefined
  if (candidate.message !== undefined
    && (typeof candidate.message !== 'string' || candidate.message.length > MAX_UPDATE_MESSAGE_LENGTH)) return undefined
  if (candidate.checkedAt !== undefined
    && (typeof candidate.checkedAt !== 'number' || !Number.isFinite(candidate.checkedAt) || candidate.checkedAt < 0)) return undefined
  return {
    phase: candidate.phase,
    currentVersion: candidate.currentVersion,
    ...(candidate.availableVersion === undefined ? {} : { availableVersion: candidate.availableVersion }),
    ...(candidate.progressPercent === undefined ? {} : { progressPercent: candidate.progressPercent }),
    ...(candidate.message === undefined ? {} : { message: candidate.message }),
    ...(candidate.checkedAt === undefined ? {} : { checkedAt: candidate.checkedAt }),
  }
}

function isDesktopUpdatePhase(value: unknown): value is DesktopUpdatePhase {
  return value === 'unsupported' || value === 'idle' || value === 'checking' || value === 'available'
    || value === 'not-available' || value === 'downloading' || value === 'downloaded' || value === 'error'
}

function isUpdateVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_UPDATE_VERSION_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value)
}

function isLocalPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= MAX_LOCAL_PATH_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value)
}
