// Author: Zihan Wang
// <wangzh011031@163.com>
/** Client helpers for the desktop default-model preference endpoint. */

import {
  hasModlensTwin,
  isModlensWrapperProvider,
  sameRoute,
  unwrapModlensSelection,
  wrapModlensProvider,
  wrapModlensSelection,
} from './unwrap.ts'

export interface ModelPreference {
  provider: string
  model: string
  reasoningEffort?: string
}

export function selectionKey(selection: ModelPreference): string {
  return `${selection.provider}\0${selection.model}\0${selection.reasoningEffort ?? ''}`
}

export function sameSelection(a: ModelPreference | null | undefined, b: ModelPreference | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null
  return selectionKey(a) === selectionKey(b)
}

export {
  hasModlensTwin,
  isModlensWrapperProvider,
  sameRoute,
  unwrapModlensSelection,
  wrapModlensProvider,
  wrapModlensSelection,
}

export async function fetchModelPreference(): Promise<ModelPreference | null> {
  const response = await fetch('/api/desktop/model-preference')
  const value = await response.json() as {
    ok?: boolean
    selection?: ModelPreference
    error?: string
  }
  if (!response.ok || value.ok === false) {
    throw new Error(value.error ?? '无法读取默认模型')
  }
  const selection = value.selection
  if (selection == null) return null
  if (typeof selection.provider !== 'string' || typeof selection.model !== 'string') return null
  const raw: ModelPreference = selection.reasoningEffort === undefined
    ? { provider: selection.provider, model: selection.model }
    : {
      provider: selection.provider,
      model: selection.model,
      reasoningEffort: selection.reasoningEffort,
    }
  return unwrapModlensSelection(raw)
}

export async function saveModelPreference(selection: ModelPreference): Promise<ModelPreference> {
  const response = await fetch('/api/desktop/model-preference', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ selection: unwrapModlensSelection(selection) }),
  })
  const value = await response.json() as {
    ok?: boolean
    selection?: ModelPreference
    error?: string
  }
  if (!response.ok || value.ok === false || value.selection == null) {
    throw new Error(value.error ?? '无法保存默认模型')
  }
  const saved = value.selection
  if (typeof saved.provider !== 'string' || typeof saved.model !== 'string') {
    throw new Error('无法保存默认模型')
  }
  return unwrapModlensSelection(
    saved.reasoningEffort === undefined
      ? { provider: saved.provider, model: saved.model }
      : { provider: saved.provider, model: saved.model, reasoningEffort: saved.reasoningEffort },
  )
}
