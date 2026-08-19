// Author: Zihan Wang
// <wangzh011031@163.com>
/** Composer switch: wrap the current text model with ModLens instead of picking a twin. */

import ScanEye from 'lucide-react/dist/esm/icons/scan-eye.mjs'
import { useEffect, useLayoutEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { hasModlensTwin, unwrapModlensSelection } from '../model/unwrap.ts'
import { rawDirectoryState, syncModlensRoute } from './directory.ts'
import { looksNativeVision } from './native.ts'
import { isModlensEnabled, setModlensEnabled, subscribeModlens } from './store.ts'

export type ModLensToggleProps = PropsRuntime<'conversation.input.left'> & {
  ctx: ClientContext
}

export function ModLensToggle({ ctx, sessionId, input }: ModLensToggleProps): JSX.Element | null {
  const [enabled, setEnabled] = useState(isModlensEnabled)
  const directory = ctx.modelDirectories?.directoryFor(sessionId)
  const [raw, setRaw] = useState(() => directory === undefined ? undefined : rawDirectoryState(directory))

  useEffect(() => subscribeModlens(() => { setEnabled(isModlensEnabled()) }), [])
  useEffect(() => {
    if (directory === undefined) return
    const pull = (): void => { setRaw(rawDirectoryState(directory)) }
    pull()
    void directory.load().then(pull).catch(() => {})
    return directory.store.subscribe(pull)
  }, [directory])

  const current = raw?.current == null ? undefined : unwrapModlensSelection(raw.current)
  const twin = current !== undefined && raw !== undefined
    && hasModlensTwin(raw.groups, current.provider, current.model)
  const native = current !== undefined && looksNativeVision(current.model)

  useEffect(() => {
    if (directory === undefined || !enabled) return
    void syncModlensRoute(directory).catch(() => {})
  }, [directory, enabled, current?.provider, current?.model, twin])

  useLayoutEffect(() => {
    if (directory === undefined || input.imageIds.length === 0 || enabled || native || !twin) return
    setModlensEnabled(true)
    void syncModlensRoute(directory).catch(() => {})
  }, [directory, enabled, input.imageIds.length, native, twin])

  if (directory === undefined || current === undefined || native || !twin) return null

  const apply = (next: boolean): void => {
    setModlensEnabled(next)
    void syncModlensRoute(directory).catch(() => {})
  }

  return (
    <button
      type="button"
      className="dsh-modlens-toggle"
      aria-pressed={enabled}
      title={enabled ? '识图已开：图片先经 ModLens，再发给当前模型' : '打开识图：DeepSeek 等纯文本模型也能读图，不用换模型'}
      onClick={() => { apply(!enabled) }}
    >
      <style>{TOGGLE_CSS}</style>
      <ScanEye size={14} aria-hidden="true" />
      识图
    </button>
  )
}

const TOGGLE_CSS = `
.dsh-modlens-toggle { height:28px; padding:0 8px; display:inline-flex; align-items:center; gap:4px; border:0; border-radius:24px; color:var(--dsw-alias-label-secondary,#999); background:transparent; font:13px/20px inherit; cursor:pointer; }
.dsh-modlens-toggle:hover { color:var(--dsw-alias-label-primary,#eee); background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dsh-modlens-toggle[aria-pressed="true"] { color:var(--dsw-alias-label-primary,#eee); background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
`
