// Author: Zihan Wang
// <wangzh011031@163.com>
/**
 * Default-model preference helpers. ModLens clones each real provider as a
 * vision wrapper (`deepseek-modlens`, `modlens-<id>`). Those twins are not a
 * separate model — they still call the same upstream. Desktop default must
 * store the real provider so the picker stays unambiguous.
 */

export interface ModelPreference {
  provider: string
  model: string
  reasoningEffort?: string
}

/** Official DeepSeek wrap keeps the historical `deepseek-modlens` id. */
export const DEEPSEEK_MODLENS_PROVIDER = 'deepseek-modlens'
export const DEEPSEEK_OFFICIAL_PROVIDER = 'deepseek-official'
export const MODLENS_PROVIDER_PREFIX = 'modlens-'

export function isModlensWrapperProvider(provider: string): boolean {
  return provider === DEEPSEEK_MODLENS_PROVIDER || provider.startsWith(MODLENS_PROVIDER_PREFIX)
}

/** Map a ModLens vision twin back to the provider that actually serves it. */
export function unwrapModlensSelection(selection: ModelPreference): ModelPreference {
  const provider = unwrapModlensProvider(selection.provider)
  if (provider === selection.provider) return selection
  if (selection.reasoningEffort === undefined) {
    return { provider, model: selection.model }
  }
  return { provider, model: selection.model, reasoningEffort: selection.reasoningEffort }
}

export function unwrapModlensProvider(provider: string): string {
  if (provider === DEEPSEEK_MODLENS_PROVIDER) return DEEPSEEK_OFFICIAL_PROVIDER
  if (provider.startsWith(MODLENS_PROVIDER_PREFIX)) {
    const upstream = provider.slice(MODLENS_PROVIDER_PREFIX.length)
    return upstream === '' ? provider : upstream
  }
  return provider
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

export function parseSelection(value: unknown): ModelPreference | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const nested = record.selection
  const source = (typeof nested === 'object' && nested !== null ? nested : record) as Record<string, unknown>
  const provider = source.provider
  const model = source.model
  if (typeof provider !== 'string' || provider.trim() === '') return undefined
  if (typeof model !== 'string' || model.trim() === '') return undefined
  const effort = source.reasoningEffort
  if (effort === undefined) {
    return unwrapModlensSelection({ provider: provider.trim(), model: model.trim() })
  }
  if (typeof effort !== 'string') return undefined
  return unwrapModlensSelection({
    provider: provider.trim(),
    model: model.trim(),
    reasoningEffort: effort,
  })
}
