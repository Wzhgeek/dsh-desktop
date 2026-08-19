// Author: Zihan Wang
// <wangzh011031@163.com>
/** Strip ModLens vision-wrapper provider ids back to the real upstream. */

import type { ModelPreference } from './api.ts'

export const DEEPSEEK_MODLENS_PROVIDER = 'deepseek-modlens'
export const DEEPSEEK_OFFICIAL_PROVIDER = 'deepseek-official'
export const MODLENS_PROVIDER_PREFIX = 'modlens-'

export function isModlensWrapperProvider(provider: string): boolean {
  return provider === DEEPSEEK_MODLENS_PROVIDER || provider.startsWith(MODLENS_PROVIDER_PREFIX)
}

export function unwrapModlensProvider(provider: string): string {
  if (provider === DEEPSEEK_MODLENS_PROVIDER) return DEEPSEEK_OFFICIAL_PROVIDER
  if (provider.startsWith(MODLENS_PROVIDER_PREFIX)) {
    const upstream = provider.slice(MODLENS_PROVIDER_PREFIX.length)
    return upstream === '' ? provider : upstream
  }
  return provider
}

export function unwrapModlensSelection(selection: ModelPreference): ModelPreference {
  const provider = unwrapModlensProvider(selection.provider)
  if (provider === selection.provider) return selection
  if (selection.reasoningEffort === undefined) {
    return { provider, model: selection.model }
  }
  return { provider, model: selection.model, reasoningEffort: selection.reasoningEffort }
}

/** Synthetic provider id ModLens registers for one upstream. */
export function wrapModlensProvider(provider: string): string {
  if (isModlensWrapperProvider(provider)) return provider
  if (provider === DEEPSEEK_OFFICIAL_PROVIDER) return DEEPSEEK_MODLENS_PROVIDER
  return `${MODLENS_PROVIDER_PREFIX}${provider}`
}

export interface ModlensCatalogGroup {
  id: string
  models: readonly { id: string }[]
}

/** Route through the ModLens twin when that twin actually exists in the catalog. */
export function wrapModlensSelection(
  selection: ModelPreference,
  groups: readonly ModlensCatalogGroup[],
): ModelPreference {
  const unwrapped = unwrapModlensSelection(selection)
  const twin = wrapModlensProvider(unwrapped.provider)
  const group = groups.find(entry => entry.id === twin)
  if (group === undefined || !group.models.some(model => model.id === unwrapped.model)) return unwrapped
  if (unwrapped.reasoningEffort === undefined) return { provider: twin, model: unwrapped.model }
  return { provider: twin, model: unwrapped.model, reasoningEffort: unwrapped.reasoningEffort }
}

export function hasModlensTwin(
  groups: readonly ModlensCatalogGroup[],
  provider: string,
  model: string,
): boolean {
  const twin = wrapModlensProvider(unwrapModlensProvider(provider))
  return groups.some(group => group.id === twin && group.models.some(entry => entry.id === model))
}

/** Compare provider + model only; reasoning effort is adapter-owned. */
export function sameRoute(a: ModelPreference | null | undefined, b: ModelPreference | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null
  return unwrapModlensProvider(a.provider) === unwrapModlensProvider(b.provider) && a.model === b.model
}
