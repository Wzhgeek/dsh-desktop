// Author: Zihan Wang
// <wangzh011031@163.com>
/** Convert a settings-page keydown into an Electron accelerator. */

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  Spacebar: 'Space',
  '+': 'Plus',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Escape',
  Enter: 'Enter',
  Tab: 'Tab',
}

const MODIFIER_ONLY = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS'])

/** Build CommandOrControl+Alt?+Shift?+Key from a captured keyboard event. */
export function acceleratorFromKeyboardEvent(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): string | undefined {
  if (!event.metaKey && !event.ctrlKey) return undefined
  if (MODIFIER_ONLY.has(event.key)) return undefined
  const key = acceleratorKey(event)
  if (key === undefined) return undefined
  const parts = ['CommandOrControl']
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

function acceleratorKey(event: Pick<KeyboardEvent, 'key' | 'code'>): string | undefined {
  const named = KEY_ALIASES[event.key]
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
