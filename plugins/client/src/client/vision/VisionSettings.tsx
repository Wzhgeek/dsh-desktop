// Author: Zihan Wang
// <wangzh011031@163.com>
/** Settings section: 识图 switch plus Gemini / OpenAI-compatible engine keys. */

import ScanEye from 'lucide-react/dist/esm/icons/scan-eye.mjs'
import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fetchVisionEngine, saveVisionEngine, type VisionEngineId, type VisionEnginePublic } from './api.ts'
import { syncModlensRoute } from './directory.ts'
import { isModlensEnabled, setModlensEnabled, subscribeModlens } from './store.ts'

export type VisionSettingsProps = PropsRuntime<'settings.section'> & PropsRenderSlots<never> & {
  ctx: ClientContext
}

export function VisionSettings({ ctx }: VisionSettingsProps): JSX.Element {
  const [enabled, setEnabled] = useState(isModlensEnabled)
  const [engine, setEngine] = useState<VisionEnginePublic | undefined>(undefined)
  const [provider, setProvider] = useState<VisionEngineId>('gemini-api')
  const [geminiKey, setGeminiKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('')
  const [openaiModel, setOpenaiModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => subscribeModlens(() => { setEnabled(isModlensEnabled()) }), [])
  useEffect(() => {
    let cancelled = false
    void fetchVisionEngine().then((next) => {
      if (cancelled) return
      applyPublic(next)
    }).catch((error: unknown) => {
      if (!cancelled) setMessage(error instanceof Error ? error.message : String(error))
    })
    return () => { cancelled = true }
  }, [])

  const applyEnabled = (next: boolean): void => {
    setModlensEnabled(next)
    const sessionId = ctx.sessions.list.getSnapshot().current
    if (sessionId === undefined || ctx.modelDirectories === undefined) return
    void syncModlensRoute(ctx.modelDirectories.directoryFor(sessionId)).catch(() => {})
  }

  const applyPublic = (next: VisionEnginePublic): void => {
    setEngine(next)
    setProvider(next.provider)
    setOpenaiBaseUrl(next.openaiBaseUrl)
    setOpenaiModel(next.openaiModel)
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const next = await saveVisionEngine({
        provider,
        ...(provider === 'gemini-api' && geminiKey.trim() !== '' ? { geminiApiKey: geminiKey.trim() } : {}),
        ...(provider === 'openai' && openaiKey.trim() !== '' ? { openaiApiKey: openaiKey.trim() } : {}),
        ...(provider === 'openai' && openaiBaseUrl.trim() !== '' ? { openaiBaseUrl: openaiBaseUrl.trim() } : {}),
        ...(provider === 'openai' && openaiModel.trim() !== '' ? { openaiModel: openaiModel.trim() } : {}),
      })
      applyPublic(next)
      setGeminiKey('')
      setOpenaiKey('')
      setMessage('已保存。新对话会用这份配置读图。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dsh-vision-settings">
      <style>{PAGE_CSS}</style>
      <header>
        <ScanEye size={18} aria-hidden="true" />
        <div>
          <h2>识图</h2>
          <p>给 DeepSeek 这类纯文本模型外挂读图。密钥只写在本机，不会进会话记录。</p>
        </div>
      </header>

      <label className="dsh-vision-switch">
        <input
          type="checkbox"
          checked={enabled}
          onChange={event => { applyEnabled(event.currentTarget.checked) }}
        />
        <span>{enabled ? '已开' : '关闭'}</span>
        <small>打开后，对话里传图会先走识图引擎，再交给当前模型。GPT / Claude / Gemini 本身就能看图，不用开。</small>
      </label>

      <fieldset>
        <legend>引擎</legend>
        <label>
          <input
            type="radio"
            name="dsh-vision-provider"
            checked={provider === 'gemini-api'}
            onChange={() => { setProvider('gemini-api') }}
          />
          Gemini
        </label>
        <label>
          <input
            type="radio"
            name="dsh-vision-provider"
            checked={provider === 'openai'}
            onChange={() => { setProvider('openai') }}
          />
          OpenAI 兼容
        </label>
      </fieldset>

      {provider === 'gemini-api' ? (
        <label className="dsh-vision-field">
          Gemini API Key
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={engine?.geminiConfigured === true ? `已保存 ${engine.geminiHint}，留空则不改` : '粘贴 Google AI Studio 的 API key'}
            value={geminiKey}
            onChange={event => { setGeminiKey(event.currentTarget.value) }}
          />
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">去 Google AI Studio 领取</a>
        </label>
      ) : (
        <>
          <label className="dsh-vision-field">
            接口地址
            <input
              type="url"
              spellCheck={false}
              placeholder="https://api.openai.com/v1"
              value={openaiBaseUrl}
              onChange={event => { setOpenaiBaseUrl(event.currentTarget.value) }}
            />
          </label>
          <label className="dsh-vision-field">
            模型
            <input
              type="text"
              spellCheck={false}
              placeholder="gpt-4o"
              value={openaiModel}
              onChange={event => { setOpenaiModel(event.currentTarget.value) }}
            />
          </label>
          <label className="dsh-vision-field">
            API Key
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={engine?.openaiConfigured === true ? `已保存 ${engine.openaiHint}，留空则不改` : '粘贴兼容接口的 API key'}
              value={openaiKey}
              onChange={event => { setOpenaiKey(event.currentTarget.value) }}
            />
          </label>
        </>
      )}

      <div className="dsh-vision-actions">
        <button type="button" disabled={busy} onClick={() => { void save() }}>
          {busy ? '保存中…' : '保存'}
        </button>
        {message === null ? null : <span role="status">{message}</span>}
      </div>
    </div>
  )
}

const PAGE_CSS = `
.dsh-vision-settings { display:grid; gap:18px; max-width:520px; color:var(--dsw-alias-label-primary,#eee); }
.dsh-vision-settings > header { display:grid; grid-template-columns:22px minmax(0,1fr); gap:10px; align-items:start; }
.dsh-vision-settings > header svg { margin-top:3px; color:var(--dsw-alias-label-tertiary,#888); }
.dsh-vision-settings h2 { margin:0; font-size:16px; line-height:22px; font-weight:600; }
.dsh-vision-settings header p { margin:4px 0 0; font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary,#999); }
.dsh-vision-switch { display:grid; grid-template-columns:auto auto minmax(0,1fr); gap:8px 10px; align-items:center; font-size:13px; }
.dsh-vision-switch small { grid-column:1 / -1; color:var(--dsw-alias-label-secondary,#999); font-size:11px; line-height:16px; }
.dsh-vision-settings fieldset { margin:0; padding:0; border:0; display:flex; gap:16px; }
.dsh-vision-settings legend { margin:0 0 8px; font-size:13px; font-weight:550; }
.dsh-vision-settings fieldset label { display:inline-flex; align-items:center; gap:6px; font-size:13px; cursor:pointer; }
.dsh-vision-field { display:grid; gap:6px; font-size:13px; }
.dsh-vision-field input { height:32px; padding:0 10px; border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2)); border-radius:6px; background:var(--dsw-alias-bg-layer-1,transparent); color:inherit; font:inherit; }
.dsh-vision-field a { font-size:11px; color:var(--dsh-desktop-accent,#4f8cff); }
.dsh-vision-actions { display:flex; align-items:center; gap:10px; }
.dsh-vision-actions button { height:32px; padding:0 12px; border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2)); border-radius:6px; background:transparent; color:inherit; font:inherit; font-size:12px; cursor:pointer; }
.dsh-vision-actions button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dsh-vision-actions button:disabled { opacity:.55; cursor:wait; }
.dsh-vision-actions span { font-size:12px; color:var(--dsw-alias-label-secondary,#999); }
`
