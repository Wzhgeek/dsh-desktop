// Author: Zihan Wang
// <wangzh011031@163.com>
/** Session-independent ModLens switch. On means wrap the current text model. */

export const MODLENS_ENABLED_KEY = 'dsh-desktop.modlens.enabled'

const listeners = new Set<() => void>()

function storage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    return (globalThis as { localStorage?: Pick<Storage, 'getItem' | 'setItem'> }).localStorage
  } catch {
    return undefined
  }
}

function notify(): void {
  for (const listener of listeners) listener()
}

/** Whether the desktop should route text-only models through ModLens. */
export function isModlensEnabled(): boolean {
  try {
    return storage()?.getItem(MODLENS_ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

/** Persist the switch and notify composer / directory masks. */
export function setModlensEnabled(value: boolean): void {
  try {
    storage()?.setItem(MODLENS_ENABLED_KEY, value ? '1' : '0')
  } catch {
    // Private-mode storage should not break the composer.
  }
  notify()
}

/** Subscribe to switch changes. */
export function subscribeModlens(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
