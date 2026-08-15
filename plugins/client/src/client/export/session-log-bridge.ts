/** Bridge to the upstream Session-log exporter without duplicating its ZIP flow. */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

const UPSTREAM_BUTTON_SELECTOR = 'button[class*="sessionLogButton"]'

/** Strictly identify the upstream Header action, not an unrelated log button. */
function isUpstreamButton(value: Element): value is HTMLButtonElement {
  if (!(value instanceof HTMLButtonElement) || !value.matches(UPSTREAM_BUTTON_SELECTOR)) return false
  return Array.from(value.children).some(child => (
    child instanceof HTMLSpanElement && child.textContent?.trim() === 'Session log'
  ))
}

/** Find the still-mounted upstream action whose component also owns its result dialog. */
function findUpstreamButton(root: ParentNode = document): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll(UPSTREAM_BUTTON_SELECTOR)).find(isUpstreamButton) as HTMLButtonElement | undefined
}

/**
 * Start the canonical upstream Session-log download through its mounted action.
 * The upstream component already owns the injected download controller and ZIP
 * result flow; reading an optional service from a Cordis context would throw
 * when that service was not declared in this plugin's inject list.
 */
export async function downloadSessionLog(_ctx: ClientContext, _sessionId: SessionId): Promise<void> {
  const button = findUpstreamButton()
  if (button === undefined) throw new Error('Session 日志导出服务不可用。')
  if (button.disabled) throw new Error('Session 日志正在导出。')
  button.click()
}

interface HiddenButtonState {
  hidden: string | null
  ariaHidden: string | null
  tabIndex: string | null
  display: string
  displayPriority: string
}

/**
 * Hide only the upstream capsule while leaving its mounted dialog alive.
 * Returns a disposer that restores every exact DOM attribute it changed.
 */
export function installUpstreamSessionLogButtonHider(): () => void {
  const changed = new Map<HTMLButtonElement, HiddenButtonState>()
  const hide = (button: HTMLButtonElement): void => {
    if (changed.has(button)) return
    changed.set(button, {
      hidden: button.getAttribute('hidden'),
      ariaHidden: button.getAttribute('aria-hidden'),
      tabIndex: button.getAttribute('tabindex'),
      display: button.style.getPropertyValue('display'),
      displayPriority: button.style.getPropertyPriority('display'),
    })
    button.setAttribute('hidden', '')
    button.setAttribute('aria-hidden', 'true')
    button.setAttribute('tabindex', '-1')
    button.style.setProperty('display', 'none', 'important')
  }
  const scan = (root: ParentNode): void => {
    if (root instanceof Element && isUpstreamButton(root)) hide(root)
    for (const button of root.querySelectorAll(UPSTREAM_BUTTON_SELECTOR)) {
      if (isUpstreamButton(button)) hide(button)
    }
  }

  scan(document)
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) scan(node)
      }
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })

  return () => {
    observer.disconnect()
    for (const [button, state] of changed) {
      if (state.hidden === null) button.removeAttribute('hidden')
      else button.setAttribute('hidden', state.hidden)
      if (state.ariaHidden === null) button.removeAttribute('aria-hidden')
      else button.setAttribute('aria-hidden', state.ariaHidden)
      if (state.tabIndex === null) button.removeAttribute('tabindex')
      else button.setAttribute('tabindex', state.tabIndex)
      if (state.display === '') button.style.removeProperty('display')
      else button.style.setProperty('display', state.display, state.displayPriority)
    }
    changed.clear()
  }
}
