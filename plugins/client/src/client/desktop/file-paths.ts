/** Local file reference recognition and unobtrusive chat-path activation. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DESKTOP_FILE_OPENERS,
  FILE_OPENER_CHANGE_EVENT,
  fileOpenerLabel,
  getPreferredFileOpener,
  normalizeFileOpener,
  openDesktopPath,
  setPreferredFileOpener,
} from './file-openers.ts'
import type { DesktopFileOpener } from './file-openers.ts'

export interface FileReference {
  raw: string
  path: string
  line?: number
  column?: number
}

const PATH_CLASS = 'dsh-desktop-file-path'
const OPENER_TRIGGER_CLASS = 'dsh-desktop-file-opener-trigger'
const OPENER_MENU_CLASS = 'dsh-desktop-file-opener-menu'

/** Parse absolute, home-relative, or explicit relative file references. */
export function parseFileReference(value: string): FileReference | undefined {
  const raw = value.trim().replace(/^[`'\"]|[`'\"]$/g, '')
  if (raw === '' || raw.length > 4_096 || /[\r\n]/.test(raw) || /^[a-z][a-z\d+.-]*:\/\//i.test(raw)) return undefined
  const hashLocation = raw.match(/^(.*)#L(\d+)(?::(\d+))?$/)
  const colonLocation = hashLocation === null ? raw.match(/^(.*?)(?::(\d+))(?::(\d+))?$/) : null
  const path = (hashLocation?.[1] ?? colonLocation?.[1] ?? raw).replace(/[),.;]+$/, '')
  if (!/^(?:\/|~[\\/]|\.\.?[\\/]|[A-Za-z]:[\\/])/.test(path)) return undefined
  const lineText = hashLocation?.[2] ?? colonLocation?.[2]
  const columnText = hashLocation?.[3] ?? colonLocation?.[3]
  return {
    raw,
    path,
    ...(lineText === undefined ? {} : { line: Number(lineText) }),
    ...(columnText === undefined ? {} : { column: Number(columnText) }),
  }
}

/** Add click and keyboard behavior to inline-code paths as messages arrive. */
export function installFilePathLinks(ctx: ClientContext): () => void {
  const style = document.createElement('style')
  style.dataset.dshDesktopFilePaths = 'true'
  style.textContent = `
    code.${PATH_CLASS}:not(pre code) { color: var(--dsh-desktop-accent, #4f8cff); cursor: pointer; text-decoration: underline; text-decoration-color: color-mix(in srgb, currentColor 35%, transparent); text-underline-offset: 3px; }
    code.${PATH_CLASS}:not(pre code):hover { text-decoration-color: currentColor; }
    code.${PATH_CLASS}:not(pre code):focus-visible { outline: 2px solid var(--dsh-desktop-accent, #4f8cff); outline-offset: 2px; border-radius: 2px; }
    button.${OPENER_TRIGGER_CLASS} { width: 18px; height: 18px; margin: 0 2px; padding: 0; display: inline-grid; place-items: center; vertical-align: -3px; border: 0; border-radius: 4px; color: var(--dsw-alias-label-tertiary); background: transparent; cursor: pointer; font: 13px/18px inherit; }
    button.${OPENER_TRIGGER_CLASS}:hover, button.${OPENER_TRIGGER_CLASS}[aria-expanded="true"] { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
    button.${OPENER_TRIGGER_CLASS}:focus-visible { outline: 2px solid var(--dsh-desktop-accent, #4f8cff); outline-offset: 1px; }
    .${OPENER_MENU_CLASS} { position: fixed; z-index: 1000; box-sizing: border-box; width: 174px; padding: 5px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2, #242426); box-shadow: 0 12px 30px rgba(0,0,0,.32); }
    .${OPENER_MENU_CLASS}[hidden] { display: none; }
    .${OPENER_MENU_CLASS} button { width: 100%; height: 32px; padding: 0 9px; display: grid; grid-template-columns: minmax(0,1fr) 16px; align-items: center; border: 0; border-radius: 5px; color: inherit; background: transparent; text-align: left; cursor: pointer; font: 12px/18px inherit; }
    .${OPENER_MENU_CLASS} button:hover, .${OPENER_MENU_CLASS} button:focus-visible { outline: 0; background: var(--dsw-alias-interactive-bg-hover); }
    .${OPENER_MENU_CLASS} button[aria-checked="true"]::after { content: '✓'; color: var(--dsh-desktop-accent, #4f8cff); text-align: center; }
  `
  document.head.append(style)

  const openerMenu = document.createElement('div')
  openerMenu.className = OPENER_MENU_CLASS
  openerMenu.setAttribute('role', 'menu')
  openerMenu.setAttribute('aria-label', '选择文件打开方式')
  openerMenu.hidden = true
  for (const option of DESKTOP_FILE_OPENERS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.dshDesktopOpener = option.value
    button.setAttribute('role', 'menuitemradio')
    button.textContent = option.label
    openerMenu.append(button)
  }
  document.body.append(openerMenu)
  let activeCode: HTMLElement | undefined

  const updateOpenerControls = (): void => {
    const preferred = getPreferredFileOpener()
    for (const code of document.querySelectorAll<HTMLElement>(`code.${PATH_CLASS}`)) {
      const reference = parseFileReference(code.textContent ?? '')
      if (reference !== undefined) code.title = `用 ${fileOpenerLabel(preferred)} 打开 ${reference.path}`
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>(`button.${OPENER_TRIGGER_CLASS}`)) {
      button.title = `选择打开方式（当前：${fileOpenerLabel(preferred)}）`
    }
    for (const button of openerMenu.querySelectorAll<HTMLButtonElement>('button[data-dsh-desktop-opener]')) {
      button.setAttribute('aria-checked', String(button.dataset.dshDesktopOpener === preferred))
    }
  }

  const closeOpenerMenu = (): void => {
    openerMenu.hidden = true
    activeCode = undefined
    for (const button of document.querySelectorAll<HTMLButtonElement>(`button.${OPENER_TRIGGER_CLASS}[aria-expanded="true"]`)) {
      button.setAttribute('aria-expanded', 'false')
    }
  }

  const showOpenerMenu = (trigger: HTMLButtonElement, code: HTMLElement): void => {
    closeOpenerMenu()
    activeCode = code
    updateOpenerControls()
    trigger.setAttribute('aria-expanded', 'true')
    openerMenu.hidden = false
    const rect = trigger.getBoundingClientRect()
    const menuWidth = 174
    const menuHeight = openerMenu.offsetHeight
    const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.left))
    const below = rect.bottom + 6
    const top = below + menuHeight <= window.innerHeight - 8 ? below : Math.max(8, rect.top - menuHeight - 6)
    openerMenu.style.left = `${String(left)}px`
    openerMenu.style.top = `${String(top)}px`
    requestAnimationFrame(() => {
      openerMenu.querySelector<HTMLButtonElement>('button[aria-checked="true"]')?.focus()
    })
  }

  const markPaths = (root: ParentNode): void => {
    const candidates = root instanceof HTMLElement && root.matches('code') ? [root] : [...root.querySelectorAll<HTMLElement>('code')]
    for (const code of candidates) {
      if (code.closest('pre') !== null || code.dataset.dshDesktopPathChecked === 'true') continue
      code.dataset.dshDesktopPathChecked = 'true'
      const reference = parseFileReference(code.textContent ?? '')
      if (reference === undefined) continue
      code.classList.add(PATH_CLASS)
      code.tabIndex = 0
      code.setAttribute('role', 'link')
      code.title = `用 ${fileOpenerLabel(getPreferredFileOpener())} 打开 ${reference.path}`
      if (!(code.nextElementSibling instanceof HTMLButtonElement && code.nextElementSibling.classList.contains(OPENER_TRIGGER_CLASS))) {
        const trigger = document.createElement('button')
        trigger.type = 'button'
        trigger.className = OPENER_TRIGGER_CLASS
        trigger.textContent = '⌄'
        trigger.setAttribute('aria-label', `选择 ${reference.path} 的打开方式`)
        trigger.setAttribute('aria-haspopup', 'menu')
        trigger.setAttribute('aria-expanded', 'false')
        code.insertAdjacentElement('afterend', trigger)
      }
    }
    updateOpenerControls()
  }
  markPaths(document)
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node instanceof HTMLElement) markPaths(node)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  const pathTarget = (target: EventTarget | null): HTMLElement | undefined => {
    if (!(target instanceof Element)) return undefined
    const code = target.closest<HTMLElement>(`code.${PATH_CLASS}`)
    return code ?? undefined
  }
  const openTarget = async (code: HTMLElement, opener?: DesktopFileOpener): Promise<void> => {
    const reference = parseFileReference(code.textContent ?? '')
    if (reference === undefined) return
    const list = ctx.sessions.list.getSnapshot()
    const cwd = list.current === undefined ? undefined : list.byId[list.current]?.cwd
    const result = await openDesktopPath({ path: reference.raw, ...(cwd === undefined ? {} : { cwd }) }, opener)
    if (result.ok === false) window.dshDesktop?.notify({ title: '无法打开文件', body: result.error })
  }
  const onClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return
    const option = event.target.closest<HTMLButtonElement>('button[data-dsh-desktop-opener]')
    if (option !== null && openerMenu.contains(option)) {
      event.preventDefault()
      const code = activeCode
      const opener = normalizeFileOpener(option.dataset.dshDesktopOpener)
      setPreferredFileOpener(opener)
      closeOpenerMenu()
      if (code !== undefined) void openTarget(code, opener)
      return
    }
    const trigger = event.target.closest<HTMLButtonElement>(`button.${OPENER_TRIGGER_CLASS}`)
    if (trigger !== null) {
      event.preventDefault()
      const code = trigger.previousElementSibling
      if (code instanceof HTMLElement && code.classList.contains(PATH_CLASS)) showOpenerMenu(trigger, code)
      return
    }
    const target = pathTarget(event.target)
    if (target !== undefined) {
      event.preventDefault()
      closeOpenerMenu()
      void openTarget(target)
      return
    }
    if (!openerMenu.hidden) closeOpenerMenu()
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !openerMenu.hidden) {
      event.preventDefault()
      closeOpenerMenu()
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = pathTarget(event.target)
    if (target === undefined) return
    event.preventDefault()
    void openTarget(target)
  }
  document.addEventListener('click', onClick)
  document.addEventListener('keydown', onKeyDown)
  window.addEventListener(FILE_OPENER_CHANGE_EVENT, updateOpenerControls)
  return () => {
    observer.disconnect()
    document.removeEventListener('click', onClick)
    document.removeEventListener('keydown', onKeyDown)
    window.removeEventListener(FILE_OPENER_CHANGE_EVENT, updateOpenerControls)
    for (const trigger of document.querySelectorAll(`button.${OPENER_TRIGGER_CLASS}`)) trigger.remove()
    openerMenu.remove()
    style.remove()
  }
}
