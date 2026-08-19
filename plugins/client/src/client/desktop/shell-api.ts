// Author: Zihan Wang
// <wangzh011031@163.com>
/** Renderer-side projection of the native shell recents and show-window shortcut. */

export interface DesktopRecentWorkspace {
  path: string
  title?: string
  openedAt: number
}

export interface DesktopShellState {
  accelerator: string
  acceleratorLabel: string
  recents: DesktopRecentWorkspace[]
}

export type DesktopShellActionResult = { ok: true } | { ok: false; error: string }

export const EMPTY_SHELL_STATE: DesktopShellState = {
  accelerator: 'CommandOrControl+Shift+D',
  acceleratorLabel: typeof navigator === 'object' && /Mac/i.test(navigator.platform) ? '⌘⇧D' : 'Ctrl+Shift+D',
  recents: [],
}

export interface DesktopShellApi {
  getShellState(): Promise<DesktopShellState>
  setShowWindowAccelerator(accelerator: string): Promise<DesktopShellActionResult>
  rememberWorkspace(request: { path: string; title?: string }): void
  clearRecentWorkspaces(): void
  pathForFile?(file: File): string
  onShellState(listener: (state: DesktopShellState) => void): () => void
}
