/** Renderer-side projection of the context-isolated desktop updater bridge. */

export type DesktopUpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface DesktopUpdateState {
  phase: DesktopUpdatePhase
  currentVersion: string
  availableVersion?: string
  progressPercent?: number
  message?: string
  checkedAt?: number
}

export type DesktopUpdateActionResult = { ok: true } | { ok: false; error: string }

export interface DesktopUpdateApi {
  getUpdateState(): Promise<DesktopUpdateState>
  checkForUpdates(): Promise<DesktopUpdateActionResult>
  downloadUpdate(): Promise<DesktopUpdateActionResult>
  installUpdate(): void
  openReleasePage(): Promise<DesktopUpdateActionResult>
  onUpdateState(listener: (state: DesktopUpdateState) => void): () => void
}

export const BROWSER_UPDATE_STATE: DesktopUpdateState = {
  phase: 'unsupported',
  currentVersion: '开发预览',
  message: '请在安装后的 Dsh Desktop 中检查更新。',
}
