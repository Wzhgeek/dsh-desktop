/** Workspace file completion shown while the composer caret is in an @ token. */

import File from 'lucide-react/dist/esm/icons/file.mjs'
import FolderSearch from 'lucide-react/dist/esm/icons/folder-search.mjs'
import Search from 'lucide-react/dist/esm/icons/search.mjs'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { mentionAt } from './token.ts'

interface DesktopFileSearchResult {
  path: string
  relativePath: string
  name: string
}

export type FileMentionMenuProps = PropsRuntime<'shell.overlay'>

const COMPOSER_TEXTAREA = 'textarea[data-phase]'

interface ComposerState {
  draft: string
  caret: number
  phase: string
  left: number
  top: number
  width: number
}

export function FileMentionMenu({ useSessions, useWorkspaces }: FileMentionMenuProps): JSX.Element | null {
  const sessionCwd = useSessions(snapshot => {
    const current = snapshot.current
    return current === undefined ? undefined : snapshot.byId[current]?.cwd
  })
  const workspaceCwd = useWorkspaces(snapshot => {
    const recent = snapshot.recentWorkspaceId
    return snapshot.items.find(item => item.workspaceId === recent)?.path ?? snapshot.items[0]?.path
  })
  const cwd = sessionCwd ?? workspaceCwd
  const [composer, setComposer] = useState<ComposerState | null>(null)
  const [items, setItems] = useState<DesktopFileSearchResult[]>([])
  const [active, setActive] = useState(0)
  const [searching, setSearching] = useState(false)
  const match = useMemo(() => composer === null ? undefined : mentionAt(composer.draft, composer.caret), [composer])
  const query = useDeferredValue(match?.query ?? '')

  useEffect(() => {
    let frame = 0
    const sync = (event?: Event): void => {
      const target = event?.target instanceof HTMLTextAreaElement && event.target.matches(COMPOSER_TEXTAREA)
        ? event.target
        : document.querySelector<HTMLTextAreaElement>(COMPOSER_TEXTAREA)
      if (target === null) { setComposer(null); return }
      const rect = target.getBoundingClientRect()
      setComposer({
        draft: target.value,
        caret: target.selectionEnd ?? target.value.length,
        phase: target.dataset.phase ?? 'inert',
        left: rect.left,
        top: rect.top,
        width: rect.width,
      })
    }
    const schedule = (): void => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(() => { frame = 0; sync() })
    }
    sync()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('input', sync, true)
    document.addEventListener('click', sync, true)
    document.addEventListener('keyup', sync, true)
    document.addEventListener('select', sync, true)
    window.addEventListener('resize', schedule, { passive: true })
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('input', sync, true)
      document.removeEventListener('click', sync, true)
      document.removeEventListener('keyup', sync, true)
      document.removeEventListener('select', sync, true)
      window.removeEventListener('resize', schedule)
    }
  }, [])

  useEffect(() => {
    if (match === undefined || cwd === undefined || composer?.phase !== 'plain') {
      setItems([])
      setSearching(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearching(true)
      const params = new URLSearchParams({ cwd, q: query, mention: '1' })
      void fetch(`/api/desktop/files/search?${params.toString()}`, { signal: controller.signal })
        .then(async response => {
          const payload = await response.json() as { items?: DesktopFileSearchResult[]; error?: string }
          if (!response.ok) throw new Error(payload.error ?? `File search failed (${String(response.status)})`)
          if (!controller.signal.aborted) setItems(payload.items ?? [])
        })
        .catch(error => {
          if (!controller.signal.aborted) console.warn('file mention search failed', error)
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, query === '' ? 0 : 100)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [composer?.phase, cwd, match === undefined, query])

  useEffect(() => { setActive(0) }, [query])
  useEffect(() => { setActive(index => Math.min(index, Math.max(0, items.length - 1))) }, [items.length])

  const insert = (file: DesktopFileSearchResult): void => {
    const textarea = document.querySelector<HTMLTextAreaElement>(COMPOSER_TEXTAREA)
    if (textarea === null) return
    const caret = textarea.selectionEnd ?? textarea.value.length
    const current = mentionAt(textarea.value, caret)
    if (current === undefined) return
    const reference = `\`./${file.relativePath}\``
    const suffix = textarea.value.slice(current.end).startsWith(' ') ? '' : ' '
    const next = `${textarea.value.slice(0, current.start)}${reference}${suffix}${textarea.value.slice(current.end)}`
    const nextCaret = current.start + reference.length + suffix.length
    setTextareaValue(textarea, next)
    setItems([])
    window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(nextCaret, nextCaret)
      const rect = textarea.getBoundingClientRect()
      setComposer({ draft: next, caret: nextCaret, phase: textarea.dataset.phase ?? 'plain', left: rect.left, top: rect.top, width: rect.width })
    })
  }

  useEffect(() => {
    if (match === undefined) return
    const keyboard = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setItems([])
      } else if (event.key === 'ArrowDown' && items.length > 0) {
        event.preventDefault()
        setActive(index => (index + 1) % items.length)
      } else if (event.key === 'ArrowUp' && items.length > 0) {
        event.preventDefault()
        setActive(index => (index - 1 + items.length) % items.length)
      } else if ((event.key === 'Enter' || event.key === 'Tab') && items[active] !== undefined) {
        event.preventDefault()
        insert(items[active]!)
      }
    }
    document.addEventListener('keydown', keyboard, true)
    return () => { document.removeEventListener('keydown', keyboard, true) }
  }, [active, items, match === undefined])

  if (match === undefined || cwd === undefined || composer?.phase !== 'plain') return null
  return (
    <div className="dsh-file-mention" style={{ left: composer.left, bottom: Math.max(8, window.innerHeight - composer.top + 8), width: composer.width }}>
      <style>{FILE_MENTION_CSS}</style>
      <div className="dsh-file-mention-head"><Search size={14} /><span>@{match.query || '文件'}</span>{searching ? <i /> : null}</div>
      <div className="dsh-file-mention-list" role="listbox" aria-label="引用工作区文件">
        {items.length === 0 && !searching ? (
          <div className="dsh-file-mention-empty"><FolderSearch size={16} /><span>没有匹配文件</span></div>
        ) : items.slice(0, 10).map((file, index) => (
          <button
            key={file.path}
            type="button"
            role="option"
            aria-selected={index === active}
            onPointerMove={() => setActive(index)}
            onMouseDown={event => { event.preventDefault() }}
            onClick={() => insert(file)}
          >
            <File size={14} /><span><strong>{file.name}</strong><small>{file.relativePath}</small></span>
          </button>
        ))}
      </div>
      <div className="dsh-file-mention-foot"><kbd>↑↓</kbd><span>选择</span><kbd>Enter</kbd><span>引用</span><kbd>Esc</kbd><span>关闭</span></div>
    </div>
  )
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

const FILE_MENTION_CSS = `
.dsh-file-mention { box-sizing:border-box; position:fixed; z-index:900; max-width:720px; overflow:hidden; border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22)); border-radius:7px; color:var(--dsw-alias-label-primary,#eee); background:var(--dsw-alias-bg-layer-2,#242426); box-shadow:0 12px 32px rgba(0,0,0,.3); }
.dsh-file-mention-head { height:31px; padding:0 10px; display:flex; align-items:center; gap:7px; border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14)); color:var(--dsw-alias-label-secondary,#999); font-size:11px; line-height:16px; }
.dsh-file-mention-head > span { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-file-mention-head > i { width:12px; height:12px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:dsh-file-mention-spin .7s linear infinite; }
.dsh-file-mention-list { max-height:286px; padding:4px; overflow-y:auto; }
.dsh-file-mention-list button { box-sizing:border-box; width:100%; min-height:42px; padding:5px 8px; display:grid; grid-template-columns:18px minmax(0,1fr); align-items:center; gap:7px; border:0; border-radius:5px; color:inherit; background:transparent; text-align:left; cursor:pointer; }
.dsh-file-mention-list button[aria-selected="true"], .dsh-file-mention-list button:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dsh-file-mention-list button > svg { color:var(--dsh-desktop-accent,var(--dsw-alias-state-business-primary)); }
.dsh-file-mention-list button > span { min-width:0; display:grid; }
.dsh-file-mention-list strong, .dsh-file-mention-list small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; letter-spacing:0; }
.dsh-file-mention-list strong { font-size:12px; line-height:17px; font-weight:550; }
.dsh-file-mention-list small { color:var(--dsw-alias-label-tertiary,#888); font-size:10px; line-height:14px; }
.dsh-file-mention-empty { height:68px; display:flex; align-items:center; justify-content:center; gap:7px; color:var(--dsw-alias-label-tertiary,#888); font-size:11px; }
.dsh-file-mention-foot { height:27px; padding:0 10px; display:flex; align-items:center; justify-content:flex-end; gap:5px; border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14)); color:var(--dsw-alias-label-tertiary,#888); font-size:9px; }
.dsh-file-mention-foot kbd { padding:1px 4px; border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22)); border-radius:3px; color:var(--dsw-alias-label-secondary,#aaa); background:transparent; font:9px/13px inherit; }
@keyframes dsh-file-mention-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion:reduce) { .dsh-file-mention-head > i { animation:none; } }
`
