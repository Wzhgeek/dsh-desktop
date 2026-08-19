// Author: Zihan Wang
// <wangzh011031@163.com>
/** Shared in-app terminal placement, tabs, and open state. */

export type TerminalPlacement = 'bottom' | 'right'

export interface TerminalTab {
  id: string
  title: string
}

export interface TerminalState {
  open: boolean
  placement: TerminalPlacement
  size: number
  tabs: readonly TerminalTab[]
  activeId: string | undefined
}

const PLACEMENT_KEY = 'dsh-desktop.terminal.placement'
const SIZE_KEY = 'dsh-desktop.terminal.size'
export const DEFAULT_BOTTOM = 280
export const DEFAULT_RIGHT = 420
export const MIN_BOTTOM = 160
export const MAX_BOTTOM = 640
export const MIN_RIGHT = 280
export const MAX_RIGHT = 720
export const MAX_TERMINAL_TABS = 8

const listeners = new Set<() => void>()
let ticket = 0

let state: TerminalState = {
  open: false,
  placement: readPlacement(),
  size: readSize(readPlacement()),
  tabs: [],
  activeId: undefined,
}

function notify(): void {
  for (const listener of listeners) listener()
}

function persist(): void {
  try {
    localStorage.setItem(PLACEMENT_KEY, state.placement)
    localStorage.setItem(SIZE_KEY, String(state.size))
  } catch {
    // Placement still applies for this session.
  }
}

export function getTerminalState(): TerminalState {
  return state
}

export function subscribeTerminal(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Next unused 「终端 N」 label, filling gaps after a close. */
export function nextTerminalTitle(titles: readonly string[]): string {
  const used = new Set(titles)
  for (let index = 1; index <= titles.length + 1; index += 1) {
    const title = `终端 ${String(index)}`
    if (!used.has(title)) return title
  }
  return `终端 ${String(titles.length + 1)}`
}

export function withAddedTab(current: TerminalState, tab: TerminalTab): TerminalState {
  if (current.tabs.length >= MAX_TERMINAL_TABS) return current
  if (current.tabs.some(entry => entry.id === tab.id)) return current
  return { ...current, open: true, tabs: [...current.tabs, tab], activeId: tab.id }
}

export function withoutTab(current: TerminalState, id: string): TerminalState {
  const tabs = current.tabs.filter(tab => tab.id !== id)
  if (tabs.length === current.tabs.length) return current
  if (tabs.length === 0) {
    return { ...current, open: false, tabs: [], activeId: undefined }
  }
  const activeId = current.activeId === id ? tabs[tabs.length - 1]?.id : current.activeId
  return { ...current, tabs, activeId }
}

export function withActiveTab(current: TerminalState, id: string): TerminalState {
  if (!current.tabs.some(tab => tab.id === id) || current.activeId === id) return current
  return { ...current, activeId: id }
}

function newTab(): TerminalTab {
  ticket += 1
  return { id: `term-${String(ticket)}`, title: nextTerminalTitle(state.tabs.map(tab => tab.title)) }
}

/** Open a new tab. Caps at MAX_TERMINAL_TABS. */
export function addTerminal(): void {
  const next = withAddedTab(state, newTab())
  if (next === state) return
  state = next
  notify()
}

export function closeTerminal(id: string): void {
  const next = withoutTab(state, id)
  if (next === state) return
  state = next
  notify()
}

export function selectTerminal(id: string): void {
  const next = withActiveTab(state, id)
  if (next === state) return
  state = next
  notify()
}

export function setTerminalOpen(open: boolean): void {
  if (open) {
    if (state.tabs.length === 0) {
      addTerminal()
      return
    }
    if (state.open) return
    state = { ...state, open: true }
    notify()
    return
  }
  if (!state.open && state.tabs.length === 0) return
  state = { ...state, open: false, tabs: [], activeId: undefined }
  notify()
}

export function toggleTerminal(): void {
  setTerminalOpen(!state.open)
}

export function setTerminalPlacement(placement: TerminalPlacement): void {
  const size = readSize(placement)
  state = { ...state, placement, size }
  persist()
  notify()
}

export function setTerminalSize(size: number): void {
  const next = clampSize(state.placement, size)
  if (next === state.size) return
  state = { ...state, size: next }
  persist()
  notify()
}

export function readPlacement(): TerminalPlacement {
  try {
    return localStorage.getItem(PLACEMENT_KEY) === 'right' ? 'right' : 'bottom'
  } catch {
    return 'bottom'
  }
}

export function readSize(placement: TerminalPlacement): number {
  try {
    const raw = Number(localStorage.getItem(SIZE_KEY))
    if (Number.isFinite(raw)) return clampSize(placement, raw)
  } catch {
    // First launch uses the default size.
  }
  return placement === 'bottom' ? DEFAULT_BOTTOM : DEFAULT_RIGHT
}

export function clampSize(placement: TerminalPlacement, value: number): number {
  if (placement === 'bottom') return Math.min(MAX_BOTTOM, Math.max(MIN_BOTTOM, Math.round(value)))
  return Math.min(MAX_RIGHT, Math.max(MIN_RIGHT, Math.round(value)))
}
