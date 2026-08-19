// Author: Zihan Wang
// <wangzh011031@163.com>
/** Durable sidebar pins for sessions and workspaces. */

export const PIN_STORAGE_KEY = 'dsh-desktop:pins:v1'
export const MAX_PINS = 24

export type PinType = 'session' | 'workspace'

export interface PinRecord {
  type: PinType
  id: string
  pinnedAt: number
}

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function storage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    return (globalThis as { localStorage?: Pick<Storage, 'getItem' | 'setItem'> }).localStorage
  } catch {
    return undefined
  }
}

function readStorage(): unknown {
  try {
    const raw = storage()?.getItem(PIN_STORAGE_KEY)
    return raw === null || raw === undefined ? [] : JSON.parse(raw) as unknown
  } catch {
    return []
  }
}

function writeStorage(pins: readonly PinRecord[]): void {
  try {
    storage()?.setItem(PIN_STORAGE_KEY, `${JSON.stringify(pins)}\n`)
  } catch {
    // Quota or private-mode failures should not break the sidebar.
  }
}

/** Parse a bounded pin list from untrusted JSON. */
export function parsePins(value: unknown): PinRecord[] {
  if (!Array.isArray(value)) return []
  const pins: PinRecord[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const candidate = entry as Record<string, unknown>
    if (candidate.type !== 'session' && candidate.type !== 'workspace') continue
    if (typeof candidate.id !== 'string' || candidate.id.trim() === '' || candidate.id.length > 256) continue
    if (/[\u0000-\u001f\u007f]/.test(candidate.id)) continue
    const key = `${candidate.type}:${candidate.id}`
    if (seen.has(key)) continue
    const pinnedAt = typeof candidate.pinnedAt === 'number' && Number.isFinite(candidate.pinnedAt) && candidate.pinnedAt >= 0
      ? candidate.pinnedAt
      : 0
    seen.add(key)
    pins.push({ type: candidate.type, id: candidate.id, pinnedAt })
    if (pins.length >= MAX_PINS) break
  }
  return pins
}

/** Current pin list, newest-first. */
export function listPins(): PinRecord[] {
  return parsePins(readStorage())
}

/** Whether this session or workspace is pinned. */
export function isPinned(type: PinType, id: string): boolean {
  return listPins().some(pin => pin.type === type && pin.id === id)
}

/** Pin an item, moving it to the front when it is already present. */
export function pinItem(type: PinType, id: string, pinnedAt = Date.now()): PinRecord[] {
  const next = [{ type, id, pinnedAt }, ...listPins().filter(pin => !(pin.type === type && pin.id === id))].slice(0, MAX_PINS)
  writeStorage(next)
  notify()
  return next
}

/** Remove one pin without reordering the rest. */
export function unpinItem(type: PinType, id: string): PinRecord[] {
  const next = listPins().filter(pin => !(pin.type === type && pin.id === id))
  writeStorage(next)
  notify()
  return next
}

/** Pin if absent, unpin if present. */
export function togglePin(type: PinType, id: string): PinRecord[] {
  return isPinned(type, id) ? unpinItem(type, id) : pinItem(type, id)
}

/** Subscribe to pin-list changes in this renderer. */
export function subscribePins(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
