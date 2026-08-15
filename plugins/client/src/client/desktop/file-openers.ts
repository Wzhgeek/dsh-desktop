/** Shared file-opener preference and renderer bridge helpers. */

export type DesktopFileOpener = 'system' | 'vscode' | 'cursor' | 'finder' | 'terminal'

export interface DesktopFileOpenerOption {
  value: DesktopFileOpener
  label: string
}

export const DESKTOP_FILE_OPENERS: readonly DesktopFileOpenerOption[] = [
  { value: 'vscode', label: 'VS Code' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'finder', label: 'Finder' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'system', label: '系统默认' },
]

export const FILE_OPENER_CHANGE_EVENT = 'dsh-desktop:file-opener-change'
const FILE_OPENER_STORAGE_KEY = 'dsh-desktop:file-opener:v1'

/** Validate a persisted or externally supplied opener id. */
export function normalizeFileOpener(value: unknown): DesktopFileOpener {
  return DESKTOP_FILE_OPENERS.some(option => option.value === value)
    ? value as DesktopFileOpener
    : 'system'
}

/** Read the preferred opener without making localStorage availability fatal. */
export function getPreferredFileOpener(): DesktopFileOpener {
  try {
    return normalizeFileOpener(window.localStorage.getItem(FILE_OPENER_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

/** Persist the opener and notify every mounted control in this renderer. */
export function setPreferredFileOpener(opener: DesktopFileOpener): void {
  const normalized = normalizeFileOpener(opener)
  try {
    window.localStorage.setItem(FILE_OPENER_STORAGE_KEY, normalized)
  } catch {
    // A locked-down renderer can still use the choice for this interaction.
  }
  window.dispatchEvent(new CustomEvent<DesktopFileOpener>(FILE_OPENER_CHANGE_EVENT, { detail: normalized }))
}

/** Open a path with the explicit or persisted desktop application. */
export async function openDesktopPath(
  request: { path: string; cwd?: string },
  opener = getPreferredFileOpener(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (window.dshDesktop === undefined) return { ok: false, error: '请在桌面应用中打开本地文件。' }
  return window.dshDesktop.openPath({ ...request, opener })
}

/** User-facing label for a validated opener id. */
export function fileOpenerLabel(opener: DesktopFileOpener): string {
  return DESKTOP_FILE_OPENERS.find(option => option.value === opener)?.label ?? '系统默认'
}
