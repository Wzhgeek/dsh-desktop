// Author: Zihan Wang
// <wangzh011031@163.com>
/**
 * General settings row: show and change the deployment default model.
 * Writes through `/api/desktop/model-preference` → official agentDefaultModel.
 */

import Bot from 'lucide-react/dist/esm/icons/bot.mjs'
import { useEffect, useMemo, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import {
  fetchModelPreference,
  saveModelPreference,
  sameRoute,
  unwrapModlensSelection,
  type ModelPreference,
} from './api.ts'
import { isModlensWrapperProvider } from './unwrap.ts'

export type DefaultModelSettingProps = PropsRuntime<'settings.general.item'> & PropsRenderSlots<never> & {
  ctx: ClientContext
}

interface CatalogOption {
  value: string
  label: string
  selection: ModelPreference
}

export function DefaultModelSetting({ ctx }: DefaultModelSettingProps): JSX.Element {
  const [preference, setPreference] = useState<ModelPreference | null>(null)
  const [options, setOptions] = useState<CatalogOption[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const sessionId = ctx.sessions.list.getSnapshot().current

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await fetchModelPreference()
        if (!cancelled) setPreference(next)
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (sessionId === undefined || ctx.modelDirectories === undefined) return
    const directory = ctx.modelDirectories.directoryFor(sessionId)
    let cancelled = false

    const syncOptions = (): void => {
      const state = directory.store.getSnapshot()
      const next: CatalogOption[] = []
      for (const group of state.groups) {
        if (isModlensWrapperProvider(group.id)) continue
        for (const model of group.models) {
          if (/\(modlens vision\)/i.test(model.name)) continue
          const selection: ModelPreference = { provider: group.id, model: model.id }
          const modelLabel = model.name === model.id ? model.name : `${model.name}（${model.id}）`
          next.push({
            value: `${group.id}::${model.id}`,
            label: `${group.name} · ${modelLabel}`,
            selection,
          })
        }
      }
      if (!cancelled) setOptions(next)
    }

    syncOptions()
    void directory.load().then(syncOptions).catch(() => {})
    const unsubscribe = directory.store.subscribe(syncOptions)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [ctx, sessionId])

  const selectValue = useMemo(() => {
    if (preference == null) return ''
    const route = unwrapModlensSelection(preference)
    const hit = options.find(entry => sameRoute(entry.selection, route))
    return hit?.value ?? `${route.provider}::${route.model}`
  }, [options, preference])

  const apply = async (selection: ModelPreference): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const saved = await saveModelPreference(selection)
      setPreference(saved)
      const current = ctx.sessions.list.getSnapshot().current
      if (current !== undefined && ctx.modelDirectories !== undefined) {
        const summary = ctx.sessions.list.getSnapshot().byId[current]
        if (summary?.blank === true) {
          await ctx.modelDirectories.directoryFor(current).select(saved as ModelSelection)
        }
      }
      setMessage('已保存。新会话和空白会话会用这个真实供应商。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const useCurrentSession = async (): Promise<void> => {
    const current = ctx.sessions.list.getSnapshot().current
    if (current === undefined || ctx.modelDirectories === undefined) {
      setMessage('没有当前会话，无法读取模型。')
      return
    }
    const directory = ctx.modelDirectories.directoryFor(current)
    try {
      await directory.load()
    } catch {
      // keep last store snapshot
    }
    const selection = directory.store.getSnapshot().current
    if (selection == null) {
      setMessage('当前会话还没有模型选择。')
      return
    }
    await apply(unwrapModlensSelection(selection))
  }

  return (
    <div className="dsh-default-model-setting">
      <style>{DEFAULT_MODEL_SETTING_CSS}</style>
      <span className="dsh-default-model-setting-icon"><Bot size={15} aria-hidden="true" /></span>
      <div className="dsh-default-model-setting-copy">
        <label htmlFor="dsh-default-model-select">默认模型</label>
        <span>新会话用这个供应商和模型。未装其它供应商时即 DeepSeek 官方。</span>
      </div>
      <div className="dsh-default-model-setting-controls">
        <select
          id="dsh-default-model-select"
          disabled={busy || options.length === 0}
          value={selectValue}
          onChange={event => {
            const option = options.find(entry => entry.value === event.currentTarget.value)
            if (option !== undefined) void apply(option.selection)
          }}
        >
          {preference != null && !options.some(entry => entry.value === selectValue) ? (
            <option value={selectValue}>{preference.provider} / {preference.model}</option>
          ) : null}
          {options.length === 0 ? <option value="">加载模型目录…</option> : null}
          {options.map(entry => (
            <option key={entry.value} value={entry.value}>{entry.label}</option>
          ))}
        </select>
        <button type="button" disabled={busy} onClick={() => { void useCurrentSession() }}>
          用当前会话
        </button>
      </div>
      {message !== null ? <p className="dsh-default-model-setting-msg" role="status">{message}</p> : null}
    </div>
  )
}

const DEFAULT_MODEL_SETTING_CSS = `
.dsh-default-model-setting { display: grid; grid-template-columns: 22px minmax(0,1fr); align-items: start; gap: 8px 10px; color: var(--dsw-alias-label-primary); }
.dsh-default-model-setting-icon { width: 22px; height: 22px; margin-top: 6px; display: grid; place-items: center; color: var(--dsw-alias-label-tertiary); }
.dsh-default-model-setting-copy { display: grid; gap: 2px; min-width: 0; }
.dsh-default-model-setting-copy label { font-size: 13px; line-height: 20px; }
.dsh-default-model-setting-copy span { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary, #999); }
.dsh-default-model-setting-controls { grid-column: 2; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; }
.dsh-default-model-setting-controls select, .dsh-default-model-setting-controls button { box-sizing: border-box; height: 32px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; outline: none; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); font: 12px/18px inherit; }
.dsh-default-model-setting-controls select { min-width: 0; width: 100%; padding: 0 9px; }
.dsh-default-model-setting-controls button { padding: 0 10px; cursor: pointer; white-space: nowrap; }
.dsh-default-model-setting-controls button:disabled, .dsh-default-model-setting-controls select:disabled { opacity: .55; cursor: default; }
.dsh-default-model-setting-msg { grid-column: 2; margin: 0; font-size: 11px; color: var(--dsw-alias-label-secondary, #999); }
@media (max-width: 560px) { .dsh-default-model-setting-controls { grid-template-columns: 1fr; } }
`
