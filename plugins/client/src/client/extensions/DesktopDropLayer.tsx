// Author: Zihan Wang
// <wangzh011031@163.com>
/** Drop folders to open a workspace, or PDFs/files onto the current session. */

import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { openDesktopWorkspace } from '../desktop/workspaces.ts'

export interface DesktopDropLayerProps {
  ctx: ClientContext
  useSessions: SnapshotSelectorHook<SessionListState>
  useWorkspaces: SnapshotSelectorHook<WorkspaceListState>
}

interface DropItem {
  path: string
  kind: 'directory' | 'pdf' | 'image' | 'file'
}

export function DesktopDropLayer({ ctx, useSessions, useWorkspaces }: DesktopDropLayerProps): JSX.Element | null {
  const sessions = useSessions(value => value)
  const workspaces = useWorkspaces(value => value)
  const [active, setActive] = useState<'workspace' | 'attach' | null>(null)

  useEffect(() => {
    let depth = 0
    const cwd = currentCwd(sessions, workspaces)

    const onDragEnter = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      depth += 1
      event.preventDefault()
    }
    const onDragOver = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setActive(null)
    }
    const onDrop = (event: DragEvent): void => {
      depth = 0
      setActive(null)
      const files = [...(event.dataTransfer?.files ?? [])]
      if (files.length === 0 || onlyImages(files)) return
      event.preventDefault()
      event.stopPropagation()
      void handleDrop(ctx, cwd, files).catch(error => {
        window.dshDesktop?.notify({
          title: '无法处理拖入的文件',
          body: error instanceof Error ? error.message : String(error),
        })
      })
    }
    window.addEventListener('dragenter', onDragEnter, true)
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener('dragenter', onDragEnter, true)
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('dragleave', onDragLeave, true)
      window.removeEventListener('drop', onDrop, true)
    }
  }, [ctx, sessions, workspaces])

  useEffect(() => {
    const onDragOverHint = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      const files = [...(event.dataTransfer?.files ?? [])]
      if (files.length === 0 || onlyImages(files)) {
        setActive(null)
        return
      }
      const looksLikeFolder = files.some(file => file.type === '' && !/\.[a-z0-9]+$/i.test(file.name))
      setActive(looksLikeFolder ? 'workspace' : 'attach')
    }
    window.addEventListener('dragover', onDragOverHint, true)
    return () => { window.removeEventListener('dragover', onDragOverHint, true) }
  }, [])

  if (active === null) return null
  return (
    <div className="dsh-drop" aria-hidden="true">
      <style>{CSS}</style>
      <div>
        <strong>{active === 'workspace' ? '放开以打开工作区' : '放开以附到当前会话'}</strong>
        <span>{active === 'workspace' ? '文件夹会作为项目打开' : 'PDF 和其他文件会写入输入框，模型可以直接读'}</span>
      </div>
    </div>
  )
}

async function handleDrop(ctx: ClientContext, cwd: string | undefined, files: File[]): Promise<void> {
  const paths = files.map(file => window.dshDesktop?.pathForFile(file)).filter((path): path is string => typeof path === 'string' && path.trim() !== '')
  if (paths.length === 0) throw new Error('读不到本地路径。请从访达拖文件进来。')
  const response = await fetch('/api/desktop/drop/classify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paths }),
  })
  const value = await response.json() as { ok?: boolean; items?: DropItem[]; error?: string }
  if (!response.ok || value.ok === false) throw new Error(value.error ?? '无法识别拖入的文件')
  const items = value.items ?? []
  const directory = items.find(item => item.kind === 'directory')
  if (directory !== undefined) {
    await openDesktopWorkspace(ctx, directory.path)
    return
  }
  const attachable = items.filter(item => item.kind === 'pdf' || item.kind === 'file')
  if (attachable.length === 0) return
  if (cwd === undefined) throw new Error('先打开一个工作区，再把文件拖进来。')
  const mentions: string[] = []
  for (const item of attachable) {
    const imported = await importIntoWorkspace(item.path, cwd)
    mentions.push(`@${imported}`)
  }
  if (!insertComposerText(`${mentions.join(' ')} `)) {
    window.dshDesktop?.notify({ title: '已放入工作区', body: mentions.join(' ') })
  }
}

async function importIntoWorkspace(path: string, cwd: string): Promise<string> {
  const response = await fetch('/api/desktop/drop/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, cwd }),
  })
  const value = await response.json() as { ok?: boolean; relativePath?: string; error?: string }
  if (!response.ok || value.ok === false || value.relativePath === undefined) {
    throw new Error(value.error ?? '无法把文件附到当前会话')
  }
  return value.relativePath
}

function insertComposerText(text: string): boolean {
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea[data-phase], textarea:not(:disabled)')
  if (textarea === null) return false
  const start = textarea.selectionStart ?? textarea.value.length
  const end = textarea.selectionEnd ?? start
  const before = textarea.value.slice(0, start)
  const after = textarea.value.slice(end)
  const prefix = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
  const next = `${before}${prefix}${text}${after}`
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, next)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  const caret = before.length + prefix.length + text.length
  textarea.setSelectionRange(caret, caret)
  textarea.focus()
  return true
}

function currentCwd(sessions: SessionListState, workspaces: WorkspaceListState): string | undefined {
  const current = sessions.current === undefined ? undefined : sessions.byId[sessions.current]
  if (current?.cwd !== undefined && current.cwd.trim() !== '') return current.cwd
  return workspaces.items[0]?.path
}

function onlyImages(files: File[]): boolean {
  return files.length > 0 && files.every(file => file.type.startsWith('image/'))
}

function hasFiles(event: DragEvent): boolean {
  return [...(event.dataTransfer?.types ?? [])].includes('Files')
}

const CSS = `
.dsh-drop { position: fixed; inset: 0; z-index: 1400; display: grid; place-items: center; pointer-events: none; background: color-mix(in srgb, var(--dsw-alias-bg-primary, #111) 55%, transparent); }
.dsh-drop div { min-width: 280px; padding: 22px 28px; border: 1px dashed var(--dsh-desktop-accent, #4f8cff); border-radius: 16px; background: var(--dsw-alias-bg-primary, #1a1a1a); text-align: center; display: grid; gap: 6px; }
.dsh-drop strong { font-size: 16px; }
.dsh-drop span { color: var(--dsw-alias-label-secondary, #999); font-size: 13px; }
`
