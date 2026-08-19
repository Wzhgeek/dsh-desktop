// Author: Zihan Wang
// <wangzh011031@163.com>
/**
 * Hide ModLens twins from the picker while still selecting them under the hood
 * when the 识图 switch is on.
 */

import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelDirectory, ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import {
  isModlensWrapperProvider,
  unwrapModlensSelection,
  wrapModlensSelection,
} from '../model/unwrap.ts'
import { isModlensEnabled } from './store.ts'

const rawGetters = new WeakMap<ModelDirectory, () => ModelDirectoryState>()
const rawSelects = new WeakMap<ModelDirectory, (selection: ModelSelection) => Promise<void>>()
const patched = new WeakSet<ModelDirectory>()

const MODLENS_NAME = /\(modlens vision\)/i

/** Catalog as the host reported it, including ModLens twins. */
export function rawDirectoryState(directory: ModelDirectory): ModelDirectoryState {
  return rawGetters.get(directory)?.() ?? directory.store.getSnapshot()
}

/** Align the host route with the 识图 switch without changing the visible model. */
export async function syncModlensRoute(directory: ModelDirectory): Promise<void> {
  const rawGet = rawGetters.get(directory)
  const rawSelect = rawSelects.get(directory)
  if (rawGet === undefined || rawSelect === undefined) return
  const state = rawGet()
  if (state.current == null) return
  const desired = isModlensEnabled()
    ? wrapModlensSelection(state.current, state.groups)
    : unwrapModlensSelection(state.current)
  if (desired.provider === state.current.provider && desired.model === state.current.model) return
  await rawSelect(desired as ModelSelection)
}

/** Intercept per-session directories so the picker never lists ModLens twins. */
export function installDirectoryMask(ctx: ClientContext): void {
  const resolver = ctx.modelDirectories
  if (resolver === undefined) return
  const original = resolver.directoryFor.bind(resolver)
  resolver.directoryFor = ((sessionId: SessionId) => {
    const directory = original(sessionId)
    patchDirectory(directory)
    return directory
  }) as typeof resolver.directoryFor
}

function patchDirectory(directory: ModelDirectory): void {
  if (patched.has(directory)) return
  patched.add(directory)

  const store = directory.store
  const rawGet = store.getSnapshot.bind(store)
  rawGetters.set(directory, rawGet)
  rawSelects.set(directory, directory.select.bind(directory))

  let lastRaw: ModelDirectoryState | undefined
  let lastMasked: ModelDirectoryState | undefined
  store.getSnapshot = (): ModelDirectoryState => {
    const raw = rawGet()
    if (raw === lastRaw && lastMasked !== undefined) return lastMasked
    lastRaw = raw
    lastMasked = maskDirectoryState(raw)
    return lastMasked
  }

  const rawSelect = rawSelects.get(directory)
  const rawLoad = directory.load.bind(directory)
  if (rawSelect === undefined) return

  directory.select = (async (selection: ModelSelection) => {
    const groups = rawGet().groups
    const next = isModlensEnabled()
      ? wrapModlensSelection(selection, groups)
      : unwrapModlensSelection(selection)
    await rawSelect(next as ModelSelection)
  }) as ModelDirectory['select']

  directory.load = (async () => {
    const result = await rawLoad()
    await syncModlensRoute(directory)
    return result
  }) as ModelDirectory['load']
}

export function maskDirectoryState(state: ModelDirectoryState): ModelDirectoryState {
  return {
    ...state,
    current: state.current == null ? null : unwrapModlensSelection(state.current) as ModelDirectoryState['current'],
    groups: state.groups
      .filter(group => !isModlensWrapperProvider(group.id))
      .map(group => ({
        ...group,
        models: group.models.filter(model => !MODLENS_NAME.test(model.name)),
      })),
  }
}
