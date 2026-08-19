// Author: Zihan Wang
// <wangzh011031@163.com>
/** Global Cmd+K surface for commands, sessions, indexed content, and files. */

import Download from 'lucide-react/dist/esm/icons/download.mjs'
import File from 'lucide-react/dist/esm/icons/file.mjs'
import FileText from 'lucide-react/dist/esm/icons/file-text.mjs'
import Folder from 'lucide-react/dist/esm/icons/folder.mjs'
import FolderOpen from 'lucide-react/dist/esm/icons/folder-open.mjs'
import FolderSearch from 'lucide-react/dist/esm/icons/folder-search.mjs'
import GitBranch from 'lucide-react/dist/esm/icons/git-branch.mjs'
import MessageSquare from 'lucide-react/dist/esm/icons/message-square.mjs'
import Pin from 'lucide-react/dist/esm/icons/pin.mjs'
import Plus from 'lucide-react/dist/esm/icons/plus.mjs'
import ScanEye from 'lucide-react/dist/esm/icons/scan-eye.mjs'
import Search from 'lucide-react/dist/esm/icons/search.mjs'
import Settings from 'lucide-react/dist/esm/icons/settings.mjs'
import Terminal from 'lucide-react/dist/esm/icons/terminal.mjs'
import WalletCards from 'lucide-react/dist/esm/icons/wallet-cards.mjs'
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.mjs'
import Code2 from 'lucide-react/dist/esm/icons/code-2.mjs'
import Hammer from 'lucide-react/dist/esm/icons/hammer.mjs'
import Store from 'lucide-react/dist/esm/icons/store.mjs'
import type { ClientContext, SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { exportCurrentSession } from '../export/session-export.ts'
import { openDesktopPath } from '../desktop/file-openers.ts'
import { EMPTY_SHELL_STATE } from '../desktop/shell-api.ts'
import type { DesktopShellState } from '../desktop/shell-api.ts'
import { openDesktopWorkspace, pickDesktopWorkspace } from '../desktop/workspaces.ts'
import { isPinned, subscribePins, togglePin } from '../pins/store.ts'
import { SCHEDULE_OPEN_EVENT } from '../schedule/events.ts'
import { addTerminal } from '../terminal/store.ts'

export const PALETTE_OPEN_EVENT = 'dsh-desktop:palette-open'

interface DesktopFileSearchResult {
  path: string
  relativePath: string
  name: string
}

interface DesktopContentSearchResult {
  path: string
  relativePath: string
  line: number
  column: number
  preview: string
}

type PaletteItem = {
  id: string
  group: '命令' | '工程' | '会话' | '内容' | '代码' | '文件'
  kind: 'command' | 'workspace' | 'session' | 'content' | 'code' | 'file'
  label: string
  detail?: string
  keywords?: string
  action: () => void | Promise<void>
}

interface CommandPaletteProps {
  ctx: ClientContext
  useSessions: SnapshotSelectorHook<SessionListState>
}

interface StaticCommand {
  id: string
  label: string
  detail: string
  keywords: string
  action: () => void | Promise<void>
}

export function CommandPalette({ ctx, useSessions }: CommandPaletteProps): JSX.Element | null {
  const sessions = useSessions(value => value)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim())
  const [contentHits, setContentHits] = useState<Array<{ sessionId: SessionId; snippet: string }>>([])
  const [codeHits, setCodeHits] = useState<DesktopContentSearchResult[]>([])
  const [fileHits, setFileHits] = useState<DesktopFileSearchResult[]>([])
  const [shell, setShell] = useState<DesktopShellState>(EMPTY_SHELL_STATE)
  const [pinRev, setPinRev] = useState(0)
  const [searching, setSearching] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setContentHits([])
    setCodeHits([])
    setFileHits([])
  }, [])

  useEffect(() => {
    const show = (): void => { setOpen(true) }
    const keyboard = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        setOpen(value => !value)
      }
    }
    window.addEventListener(PALETTE_OPEN_EVENT, show)
    window.addEventListener('keydown', keyboard)
    return () => {
      window.removeEventListener(PALETTE_OPEN_EVENT, show)
      window.removeEventListener('keydown', keyboard)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const api = window.dshDesktop
    if (api === undefined) return
    void api.getShellState().then(setShell).catch(() => {})
    return api.onShellState(setShell)
  }, [open])

  useEffect(() => subscribePins(() => { setPinRev(value => value + 1) }), [])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => { input.current?.focus() })
  }, [open])

  const current = sessions.current === undefined ? undefined : sessions.byId[sessions.current]
  const currentSessionPinned = sessions.current !== undefined && isPinned('session', sessions.current)
  const currentWorkspace = current?.cwd === undefined
    ? undefined
    : ctx.workspaces.list.getSnapshot().items.find(item => item.path === current.cwd)
  const currentWorkspacePinned = currentWorkspace !== undefined && isPinned('workspace', currentWorkspace.workspaceId)
  useEffect(() => {
    if (!open || deferredQuery.length < 2) {
      setContentHits([])
      setCodeHits([])
      setFileHits([])
      setSearching(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearching(true)
      const sessionSearch = ctx.sessions.search(deferredQuery, controller.signal).then(result => {
        if (!result.ok) throw new Error(result.error.message)
        return result.value.items
      })
      const fileSearch = current?.cwd === undefined
        ? Promise.resolve([])
        : fetch(`/api/desktop/files/search?${new URLSearchParams({ cwd: current.cwd, q: deferredQuery }).toString()}`, { signal: controller.signal })
            .then(async response => {
              const value = await response.json() as { items?: DesktopFileSearchResult[] }
              return response.ok ? value.items ?? [] : []
            })
      const codeSearch = current?.cwd === undefined
        ? Promise.resolve([])
        : fetch(`/api/desktop/workspace/search-content?${new URLSearchParams({ cwd: current.cwd, q: deferredQuery }).toString()}`, { signal: controller.signal })
            .then(async response => {
              const value = await response.json() as { items?: DesktopContentSearchResult[] }
              return response.ok ? value.items ?? [] : []
            })
      void Promise.allSettled([sessionSearch, fileSearch, codeSearch]).then(([contentResult, filesResult, codeResult]) => {
        if (controller.signal.aborted) return
        setContentHits(contentResult.status === 'fulfilled' ? contentResult.value : [])
        setFileHits(filesResult.status === 'fulfilled' ? filesResult.value : [])
        setCodeHits(codeResult.status === 'fulfilled' ? codeResult.value : [])
        if (filesResult.status === 'rejected') console.warn('command palette file search failed', filesResult.reason)
        if (codeResult.status === 'rejected') console.warn('command palette content search failed', codeResult.reason)
      }).finally(() => {
        if (!controller.signal.aborted) setSearching(false)
      })
    }, 160)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [ctx, current?.cwd, deferredQuery, open])

  const staticCommands = useMemo<StaticCommand[]>(() => [
    {
      id: 'new-session', label: '新建会话', detail: '在当前工作区开始', keywords: 'new session 新会话',
      action: () => { ctx.workspaces.startSession() },
    },
    {
      id: 'open-workspace', label: '打开工作区…', detail: '选择一个本地目录', keywords: 'open workspace folder project 打开 工作区 工程',
      action: () => pickDesktopWorkspace(ctx),
    },
    {
      id: 'pin-session',
      label: currentSessionPinned ? '取消置顶当前会话' : '置顶当前会话',
      detail: '固定到侧栏置顶区',
      keywords: 'pin session 置顶 会话',
      action: () => {
        if (sessions.current !== undefined) togglePin('session', sessions.current)
      },
    },
    {
      id: 'pin-workspace',
      label: currentWorkspacePinned ? '取消置顶当前项目' : '置顶当前项目',
      detail: '固定整个工作区到侧栏置顶区',
      keywords: 'pin workspace project 置顶 项目 工作区',
      action: () => {
        const cwd = current?.cwd
        const workspace = cwd === undefined
          ? undefined
          : ctx.workspaces.list.getSnapshot().items.find(item => item.path === cwd)
        if (workspace !== undefined) togglePin('workspace', workspace.workspaceId)
      },
    },
    {
      id: 'terminal', label: '打开终端', detail: '应用内终端，可同时开多个，可放在下侧或右侧', keywords: 'terminal shell pty 终端 控制台 新建',
      action: () => { addTerminal() },
    },
    {
      id: 'session-command', label: '会话命令', detail: '打开 / 命令列表', keywords: 'slash command 命令',
      action: openSessionCommandPicker,
    },
    {
      id: 'settings', label: '打开设置', detail: '模型、插件与外观', keywords: 'settings preferences 设置 偏好',
      action: openSettings,
    },
    {
      id: 'vision', label: '打开识图设置', detail: '给纯文本模型外挂读图，填写 Gemini 或兼容接口的 key', keywords: 'vision ocr image 识图 读图 OCR 图片 gemini key',
      action: openVisionSettings,
    },
    {
      id: 'plugin-market', label: '打开插件市场', detail: '浏览精选插件并安装', keywords: 'plugin market store 插件 市场 扩展',
      action: openPluginMarket,
    },
    {
      id: 'plugin-installed', label: '打开插件管理', detail: '启用、停用或卸载已安装插件', keywords: 'plugin manage uninstall disable 插件 管理 卸载 停用',
      action: openPluginInstalled,
    },
    {
      id: 'usage', label: '查看 Usage', detail: '请求、Tokens、成本与预算', keywords: 'usage cost token budget 用量 成本 预算',
      action: openUsage,
    },
    {
      id: 'git', label: '打开 Git', detail: '版本历史与具体变更', keywords: 'git history changes 版本 历史',
      action: openGit,
    },
    {
      id: 'project', label: '打开项目工作台', detail: '项目记忆、测试与构建', keywords: 'project memory test build 项目 记忆 测试 构建',
      action: openProject,
    },
    {
      id: 'schedules', label: '打开定时任务', detail: '查看、创建或删除当前会话计划', keywords: 'schedule reminder timer 定时 任务 提醒',
      action: () => { window.dispatchEvent(new Event(SCHEDULE_OPEN_EVENT)) },
    },
    {
      id: 'export-markdown', label: '导出为 Markdown', detail: '完整当前会话', keywords: 'export download markdown 导出',
      action: () => exportCurrentSession(ctx, 'markdown'),
    },
    {
      id: 'export-text', label: '导出为纯文本', detail: '完整当前会话', keywords: 'export download text txt 导出 文本',
      action: () => exportCurrentSession(ctx, 'text'),
    },
  ], [ctx, current, currentSessionPinned, currentWorkspacePinned, pinRev, sessions.current])

  const items = useMemo<PaletteItem[]>(() => {
    const needle = deferredQuery.toLocaleLowerCase()
    const commands = staticCommands
      .filter(command => needle === '' || `${command.label} ${command.detail} ${command.keywords}`.toLocaleLowerCase().includes(needle))
      .map(command => ({ ...command, group: '命令' as const, kind: 'command' as const }))
    const workspaces = shell.recents
      .filter(entry => needle === '' || `${entry.title ?? ''} ${entry.path}`.toLocaleLowerCase().includes(needle))
      .slice(0, 8)
      .map(entry => ({
        id: `workspace:${entry.path}`,
        group: '工程' as const,
        kind: 'workspace' as const,
        label: entry.title?.trim() || entry.path.split(/[\\/]/).at(-1) || entry.path,
        detail: entry.path,
        action: () => openDesktopWorkspace(ctx, entry.path),
      }))
    const titleMatches = sessions.ids
      .map(id => sessions.byId[id])
      .filter((summary): summary is NonNullable<typeof summary> => summary !== undefined && !summary.blank)
      .filter(summary => needle === '' || `${summary.displayTitle} ${summary.cwd ?? ''}`.toLocaleLowerCase().includes(needle))
      .slice(0, needle === '' ? 6 : 12)
      .map(summary => ({
        id: `session:${summary.id}`,
        group: '会话' as const,
        kind: 'session' as const,
        label: summary.displayTitle,
        ...(summary.cwd === undefined ? {} : { detail: summary.cwd }),
        action: () => { ctx.sessions.open(summary.id) },
      }))
    const titleIds = new Set(titleMatches.map(item => item.id.slice('session:'.length)))
    const content = contentHits
      .filter(hit => !titleIds.has(hit.sessionId))
      .slice(0, 10)
      .map(hit => ({
        id: `content:${hit.sessionId}`,
        group: '内容' as const,
        kind: 'content' as const,
        label: sessions.byId[hit.sessionId]?.displayTitle ?? hit.sessionId,
        detail: hit.snippet,
        action: () => { ctx.sessions.open(hit.sessionId) },
      }))
    const files = fileHits.slice(0, 14).map(file => ({
      id: `file:${file.path}`,
      group: '文件' as const,
      kind: 'file' as const,
      label: file.name,
      detail: file.relativePath,
      action: async () => {
        const result = await openDesktopPath({ path: file.path })
        if (result.ok === false) throw new Error(result.error)
      },
    }))
    const code = codeHits.slice(0, 14).map(hit => ({
      id: `code:${hit.path}:${String(hit.line)}:${String(hit.column)}`,
      group: '代码' as const,
      kind: 'code' as const,
      label: `${hit.relativePath}:${String(hit.line)}`,
      detail: hit.preview.trim(),
      action: async () => {
        const result = await openDesktopPath({ path: `${hit.path}:${String(hit.line)}:${String(hit.column)}` })
        if (result.ok === false) throw new Error(result.error)
      },
    }))
    return [...commands, ...workspaces, ...titleMatches, ...content, ...code, ...files]
  }, [codeHits, contentHits, ctx, deferredQuery, fileHits, sessions.byId, sessions.ids, shell.recents, staticCommands])

  useEffect(() => { setActiveIndex(0) }, [deferredQuery])
  useEffect(() => { setActiveIndex(index => Math.min(index, Math.max(0, items.length - 1))) }, [items.length])

  const execute = async (item: PaletteItem | undefined): Promise<void> => {
    if (item === undefined) return
    close()
    try {
      await item.action()
    } catch (error) {
      window.dshDesktop?.notify({ title: '命令执行失败', body: error instanceof Error ? error.message : String(error) })
    }
  }

  if (!open) return null
  const grouped = groupItems(items)
  return (
    <div className="dsh-command-palette-backdrop" onPointerDown={event => { if (event.currentTarget === event.target) close() }}>
      <style>{PALETTE_CSS}</style>
      <section className="dsh-command-palette" role="dialog" aria-modal="true" aria-label="全局命令面板">
        <div className="dsh-command-palette-search">
          <Search size={18} />
          <input
            ref={input}
            value={query}
            placeholder="搜索命令、会话、代码或文件"
            aria-label="搜索命令、会话、代码或文件"
            aria-controls="dsh-command-palette-results"
            aria-activedescendant={items[activeIndex]?.id}
            onChange={event => {
              setQuery(event.currentTarget.value)
              setContentHits([])
              setCodeHits([])
              setFileHits([])
            }}
            onKeyDown={event => {
              if (event.key === 'Escape') { event.preventDefault(); close() }
              if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex(index => items.length === 0 ? 0 : (index + 1) % items.length) }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(index => items.length === 0 ? 0 : (index - 1 + items.length) % items.length) }
              if (event.key === 'Enter') { event.preventDefault(); void execute(items[activeIndex]) }
            }}
          />
          {searching ? <span className="dsh-command-palette-spinner" aria-label="搜索中" /> : <kbd>Esc</kbd>}
        </div>
        <div className="dsh-command-palette-results" id="dsh-command-palette-results" role="listbox">
          {items.length === 0 && !searching ? (
            <div className="dsh-command-palette-empty"><FolderSearch size={22} /><span>没有匹配结果</span></div>
          ) : grouped.map(group => (
            <section key={group.name}>
              <h3>{group.name}</h3>
              {group.items.map(item => {
                const index = items.indexOf(item)
                return (
                  <button
                    id={item.id}
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={activeIndex === index}
                    onPointerMove={() => setActiveIndex(index)}
                    onClick={() => { void execute(item) }}
                  >
                    <span className="dsh-command-palette-icon">{iconFor(item)}</span>
                    <span className="dsh-command-palette-copy"><strong>{item.label}</strong>{item.detail === undefined ? null : <small>{item.detail}</small>}</span>
                    {activeIndex === index ? <kbd>↵</kbd> : null}
                  </button>
                )
              })}
            </section>
          ))}
        </div>
        <footer><span>↑↓ 导航</span><span>↵ 打开</span><span>Esc 关闭</span>{current?.cwd === undefined ? null : <b>{current.cwd}</b>}</footer>
      </section>
    </div>
  )
}

function groupItems(items: PaletteItem[]): Array<{ name: PaletteItem['group']; items: PaletteItem[] }> {
  const order: PaletteItem['group'][] = ['命令', '工程', '会话', '内容', '代码', '文件']
  return order.flatMap(name => {
    const grouped = items.filter(item => item.group === name)
    return grouped.length === 0 ? [] : [{ name, items: grouped }]
  })
}

function iconFor(item: PaletteItem): JSX.Element {
  if (item.kind === 'session') return <MessageSquare size={16} />
  if (item.kind === 'workspace') return <Folder size={16} />
  if (item.kind === 'content') return <FileText size={16} />
  if (item.kind === 'code') return <Code2 size={16} />
  if (item.kind === 'file') return <File size={16} />
  if (item.id === 'new-session') return <Plus size={16} />
  if (item.id === 'open-workspace') return <FolderOpen size={16} />
  if (item.id.startsWith('pin-')) return <Pin size={16} />
  if (item.id === 'settings') return <Settings size={16} />
  if (item.id === 'plugin-market' || item.id === 'plugin-installed') return <Store size={16} />
  if (item.id === 'vision') return <ScanEye size={16} />
  if (item.id === 'usage') return <WalletCards size={16} />
  if (item.id === 'git') return <GitBranch size={16} />
  if (item.id === 'project') return <Hammer size={16} />
  if (item.id === 'schedules') return <CalendarClock size={16} />
  if (item.id.startsWith('export')) return <Download size={16} />
  return <Terminal size={16} />
}

function openSettings(): void {
  document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click()
}

function openUsage(): void {
  openSettings()
  window.setTimeout(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(entry => entry.textContent?.trim() === 'Usage')
    button?.click()
  }, 0)
}

function openVisionSettings(): void {
  openSettings()
  window.setTimeout(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(entry => entry.textContent?.trim() === '识图')
    button?.click()
  }, 0)
}

function openPluginMarket(): void {
  openSettings()
  window.setTimeout(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(entry => entry.textContent?.trim() === '插件市场')
    button?.click()
  }, 0)
}

function openPluginInstalled(): void {
  openSettings()
  window.setTimeout(() => {
    const section = [...document.querySelectorAll<HTMLButtonElement>('button')].find(entry => entry.textContent?.trim() === '插件')
    section?.click()
    window.setTimeout(() => {
      const tab = [...document.querySelectorAll<HTMLButtonElement>('button')].find(entry => entry.textContent?.trim() === '已安装')
      tab?.click()
    }, 0)
  }, 0)
}

function openGit(): void {
  const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"],button')].find(entry => entry.textContent?.trim() === 'Git')
  tab?.click()
}

function openProject(): void {
  const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"],button')].find(entry => entry.textContent?.trim() === '项目')
  tab?.click()
}

function openSessionCommandPicker(): void {
  const trigger = [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')]
    .find(candidate => !candidate.disabled && candidate.closest('[data-composer-card]') !== null)
  if (trigger !== undefined) trigger.click()
  else document.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)')?.focus({ preventScroll: true })
}

const PALETTE_CSS = `
.dsh-command-palette-backdrop { position: fixed; z-index: 1000; inset: 0; padding: min(13vh,120px) 18px 18px; display: flex; justify-content: center; align-items: flex-start; background: rgba(0,0,0,.48); backdrop-filter: blur(3px); pointer-events: auto; }
.dsh-command-palette { width: min(700px,100%); max-height: min(660px,76vh); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.24)); border-radius: 8px; color: var(--dsw-alias-label-primary, #f2f2f3); background: var(--dsw-alias-bg-layer-2, #222224); box-shadow: 0 24px 80px rgba(0,0,0,.48); }
.dsh-command-palette-search { min-height: 54px; padding: 0 14px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); }
.dsh-command-palette-search > svg { flex: none; color: var(--dsw-alias-label-secondary, #999); }
.dsh-command-palette-search input { min-width: 0; height: 52px; flex: 1; border: 0; outline: 0; color: inherit; background: transparent; font: 400 15px/22px inherit; letter-spacing: 0; }
.dsh-command-palette-search input::placeholder { color: var(--dsw-alias-label-caption, #777); }
.dsh-command-palette kbd { flex: none; padding: 1px 5px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.24)); border-radius: 4px; color: var(--dsw-alias-label-secondary, #999); background: color-mix(in srgb,var(--dsw-alias-bg-layer-1,#171719) 80%,transparent); font: 9px/15px inherit; }
.dsh-command-palette-results { min-height: 120px; overflow: auto; overscroll-behavior: contain; padding: 6px; }
.dsh-command-palette-results section + section { margin-top: 5px; padding-top: 5px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.14)); }
.dsh-command-palette-results h3 { margin: 0; padding: 5px 9px 4px; color: var(--dsw-alias-label-secondary, #999); font-size: 9px; line-height: 14px; font-weight: 600; letter-spacing: 0; text-transform: uppercase; }
.dsh-command-palette-results button { box-sizing: border-box; width: 100%; min-height: 46px; padding: 6px 9px; display: flex; align-items: center; gap: 10px; border: 0; border-radius: 5px; color: inherit; background: transparent; text-align: left; cursor: pointer; }
.dsh-command-palette-results button[aria-selected="true"] { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.dsh-command-palette-icon { width: 28px; height: 28px; flex: none; display: grid; place-items: center; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18)); border-radius: 5px; color: var(--dsh-desktop-accent, #4f8cff); background: var(--dsw-alias-bg-layer-1, #171719); }
.dsh-command-palette-copy { min-width: 0; flex: 1; display: grid; gap: 1px; }
.dsh-command-palette-copy strong, .dsh-command-palette-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: 0; }
.dsh-command-palette-copy strong { font-size: 12px; line-height: 18px; font-weight: 550; }
.dsh-command-palette-copy small { color: var(--dsw-alias-label-secondary, #999); font-size: 10px; line-height: 14px; }
.dsh-command-palette-empty { min-height: 170px; display: grid; place-items: center; align-content: center; gap: 8px; color: var(--dsw-alias-label-secondary, #999); font-size: 11px; }
.dsh-command-palette footer { min-height: 32px; padding: 0 12px; display: flex; align-items: center; gap: 12px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18)); color: var(--dsw-alias-label-secondary, #999); font-size: 9px; }
.dsh-command-palette footer b { min-width: 0; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; }
.dsh-command-palette-spinner { width: 14px; height: 14px; flex: none; border: 2px solid var(--dsw-alias-label-secondary, #999); border-right-color: transparent; border-radius: 50%; animation: dsh-command-palette-spin .7s linear infinite; }
@keyframes dsh-command-palette-spin { to { transform: rotate(360deg); } }
@media (max-width: 600px) { .dsh-command-palette-backdrop { padding: 10px; } .dsh-command-palette { max-height: calc(100vh - 20px); } .dsh-command-palette footer b { display: none; } }
@media (prefers-reduced-motion: reduce) { .dsh-command-palette-spinner { animation: none; } }
`
