// Author: Zihan Wang
// <wangzh011031@163.com>
/** Pure helpers for the desktop shell: recents, accelerators, persisted state. */

import { basename, resolve } from 'node:path'
import { isLocalPath, isSessionId, MAX_LOCAL_PATH_LENGTH } from './desktop-ipc.ts'

/** Default global shortcut that reveals the application window. */
export const DEFAULT_SHOW_WINDOW_ACCELERATOR = 'CommandOrControl+Shift+D'

/** Bounded recent-workspace list stored in the desktop state file. */
export const MAX_RECENT_WORKSPACES = 12

const MAX_RECENT_TITLE_LENGTH = 120
const MODIFIER_KEYS = new Set(['CommandOrControl', 'CmdOrCtrl', 'Command', 'Control', 'Ctrl', 'Alt', 'Option', 'Shift', 'Super', 'Meta'])
const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  space: 'Space',
  spacebar: 'Space',
  '+': 'Plus',
  add: 'Plus',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  escape: 'Escape',
  esc: 'Escape',
  return: 'Enter',
  enter: 'Enter',
  tab: 'Tab',
}

/** One recently opened project remembered by the native shell. */
export interface RecentWorkspace {
  path: string
  title?: string
  openedAt: number
}

/** Durable desktop shell snapshot besides the restored session id. */
export interface PersistedDesktopState {
  activeSessionId?: string
  showWindowAccelerator?: string
  recentWorkspaces?: RecentWorkspace[]
}

/** Renderer payload that records a workspace the user just opened. */
export interface RememberWorkspaceRequest {
  path: string
  title?: string
}

/** Snapshot the renderer uses for settings, palette, and menu labels. */
export interface DesktopShellState {
  accelerator: string
  acceleratorLabel: string
  recents: RecentWorkspace[]
}

/** Normalize a filesystem path used as a recent-workspace identity. */
export function normalizeWorkspacePath(value: string): string {
  const resolved = resolve(value.trim())
  return resolved.length > 1 && (resolved.endsWith('/') || resolved.endsWith('\\'))
    ? resolved.slice(0, -1)
    : resolved
}

/** Parse a remembered-workspace request crossing the isolated renderer boundary. */
export function parseRememberWorkspaceRequest(value: unknown): RememberWorkspaceRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (!isLocalPath(candidate.path) || candidate.path.trim().length === 0) return undefined
  const path = normalizeWorkspacePath(candidate.path)
  if (path.length > MAX_LOCAL_PATH_LENGTH) return undefined
  const title = typeof candidate.title === 'string' ? candidate.title.trim() : undefined
  if (title !== undefined && (title.length === 0 || title.length > MAX_RECENT_TITLE_LENGTH || /[\u0000-\u001f\u007f]/.test(title))) {
    return { path }
  }
  return title === undefined ? { path } : { path, title }
}

/** Parse a bounded recents array from untrusted JSON. */
export function parseRecentWorkspaces(value: unknown): RecentWorkspace[] {
  if (!Array.isArray(value)) return []
  const recents: RecentWorkspace[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const candidate = entry as Record<string, unknown>
    const parsed = parseRememberWorkspaceRequest(candidate)
    if (parsed === undefined || seen.has(parsed.path)) continue
    const openedAt = typeof candidate.openedAt === 'number' && Number.isFinite(candidate.openedAt) && candidate.openedAt >= 0
      ? candidate.openedAt
      : 0
    seen.add(parsed.path)
    recents.push(parsed.title === undefined ? { path: parsed.path, openedAt } : { path: parsed.path, title: parsed.title, openedAt })
    if (recents.length >= MAX_RECENT_WORKSPACES) break
  }
  return recents
}

/** Move a workspace to the front of the recents list, keeping the bound. */
export function rememberRecentWorkspace(recents: readonly RecentWorkspace[], request: RememberWorkspaceRequest, openedAt = Date.now()): RecentWorkspace[] {
  const path = normalizeWorkspacePath(request.path)
  const previous = recents.find(entry => entry.path === path)
  const title = request.title?.trim() || previous?.title?.trim()
  const next: RecentWorkspace = title === undefined || title === ''
    ? { path, openedAt }
    : { path, title, openedAt }
  return [next, ...recents.filter(entry => entry.path !== path)].slice(0, MAX_RECENT_WORKSPACES)
}

/** Drop one remembered workspace without changing the remaining order. */
export function removeRecentWorkspace(recents: readonly RecentWorkspace[], path: string): RecentWorkspace[] {
  const normalized = normalizeWorkspacePath(path)
  return recents.filter(entry => entry.path !== normalized)
}

/** Display title for a remembered workspace, falling back to the directory name. */
export function recentWorkspaceLabel(entry: RecentWorkspace): string {
  const title = entry.title?.trim()
  return title !== undefined && title !== '' ? title : basename(entry.path) || entry.path
}

/** Accept a stored Electron accelerator or fall back to the default. */
export function normalizeShowWindowAccelerator(value: unknown): string {
  return typeof value === 'string' && isShowWindowAccelerator(value) ? canonicalizeAccelerator(value) : DEFAULT_SHOW_WINDOW_ACCELERATOR
}

/** Whether an Electron accelerator is a safe global show-window shortcut. */
export function isShowWindowAccelerator(value: string): boolean {
  const parts = value.split('+').map(part => part.trim()).filter(part => part !== '')
  if (parts.length < 2) return false
  const key = parts.at(-1)
  if (key === undefined || MODIFIER_KEYS.has(key)) return false
  if (!/^(CommandOrControl|CmdOrCtrl|Command|Control|Ctrl)$/.test(parts[0] ?? '')) return false
  const modifiers = parts.slice(0, -1)
  if (modifiers.some(part => !MODIFIER_KEYS.has(part))) return false
  return isAcceleratorKey(key)
}

/** Canonical CommandOrControl+Alt?+Shift?+Key spelling used by Electron. */
export function canonicalizeAccelerator(value: string): string {
  const parts = value.split('+').map(part => part.trim()).filter(part => part !== '')
  const key = parts.at(-1)
  if (key === undefined) return DEFAULT_SHOW_WINDOW_ACCELERATOR
  const modifiers = new Set(parts.slice(0, -1).map(part => {
    if (part === 'CmdOrCtrl' || part === 'Command' || part === 'Control' || part === 'Ctrl') return 'CommandOrControl'
    if (part === 'Option') return 'Alt'
    return part
  }))
  const ordered: string[] = ['CommandOrControl']
  if (modifiers.has('Alt')) ordered.push('Alt')
  if (modifiers.has('Shift')) ordered.push('Shift')
  if (modifiers.has('Super') || modifiers.has('Meta')) ordered.push('Super')
  ordered.push(key.length === 1 ? key.toUpperCase() : key)
  return ordered.join('+')
}

/** Human-readable shortcut for menus and settings. */
export function formatAcceleratorLabel(accelerator: string, platform: NodeJS.Platform = process.platform): string {
  const symbols = platform === 'darwin'
    ? { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Super: '⌘', Meta: '⌘' }
    : { CommandOrControl: 'Ctrl', Command: 'Ctrl', Control: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Option: 'Alt', Shift: 'Shift', Super: 'Super', Meta: 'Meta' }
  return canonicalizeAccelerator(accelerator).split('+').map(part => {
    if (part in symbols) return symbols[part as keyof typeof symbols]
    if (part === 'Plus') return '+'
    return part
  }).join(platform === 'darwin' ? '' : '+')
}

/** Build an Electron accelerator from a settings-page keydown. */
export function acceleratorFromKeyboardEvent(event: {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}): string | undefined {
  if (!event.metaKey && !event.ctrlKey) return undefined
  const key = acceleratorKeyFromEvent(event)
  if (key === undefined) return undefined
  const parts = ['CommandOrControl']
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(key)
  const accelerator = parts.join('+')
  return isShowWindowAccelerator(accelerator) ? canonicalizeAccelerator(accelerator) : undefined
}

/** Read persisted desktop shell fields without throwing on a missing file. */
export function parsePersistedDesktopState(value: unknown): PersistedDesktopState {
  if (typeof value !== 'object' || value === null) return {}
  const candidate = value as Record<string, unknown>
  const activeSessionId = isSessionId(candidate.activeSessionId) ? candidate.activeSessionId : undefined
  const showWindowAccelerator = typeof candidate.showWindowAccelerator === 'string' && isShowWindowAccelerator(candidate.showWindowAccelerator)
    ? canonicalizeAccelerator(candidate.showWindowAccelerator)
    : undefined
  const recentWorkspaces = parseRecentWorkspaces(candidate.recentWorkspaces)
  return {
    ...(activeSessionId === undefined ? {} : { activeSessionId }),
    ...(showWindowAccelerator === undefined ? {} : { showWindowAccelerator }),
    ...(recentWorkspaces.length === 0 ? {} : { recentWorkspaces }),
  }
}

function isAcceleratorKey(value: string): boolean {
  return /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Enter|Escape|Up|Down|Left|Right|Plus|Minus)$/.test(value)
}

function acceleratorKeyFromEvent(event: { key: string; code: string }): string | undefined {
  const named = KEY_ALIASES[event.key] ?? KEY_ALIASES[event.key.toLocaleLowerCase()]
  if (named !== undefined) return named
  if (event.key.length === 1 && /[a-z]/i.test(event.key)) return event.key.toUpperCase()
  if (event.key.length === 1 && /[0-9]/.test(event.key)) return event.key
  const digit = /^Digit([0-9])$/.exec(event.code)?.[1]
  if (digit !== undefined) return digit
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1]
  if (letter !== undefined) return letter
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.key)) return event.key
  return undefined
}
