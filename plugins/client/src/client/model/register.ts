// Author: Zihan Wang
// <wangzh011031@163.com>
/**
 * Default model feature: General settings row + blank-session restore from the
 * official agentDefaultModel preference (persisted in settings.yaml).
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { DefaultModelSetting } from './DefaultModelSetting.tsx'
import { fetchModelPreference, unwrapModlensSelection, type ModelPreference } from './api.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.general.item': { kind: 'list'; scope: 'root'; owner: { children?: never } }
  }
}

const ITEM_ID = 'desktop-default-model'
const ITEM_ORDER = 25

/** Register the default-model settings row and blank-session restore. */
export function register(ctx: ClientContext): void {
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: ITEM_ID,
    order: ITEM_ORDER,
    inject: () => ({ ctx }),
  }, DefaultModelSetting))

  installBlankSessionRestore(ctx)
}

/**
 * When a blank session becomes current, apply the saved default if it differs
 * from the session's current selection. Non-blank (logged) sessions keep their
 * own model — matching official agent-default-model semantics.
 */
function installBlankSessionRestore(ctx: ClientContext): void {
  const applied = new Set<SessionId>()

  const ensurePreference = async (): Promise<ModelPreference | null> => {
    try {
      return await fetchModelPreference()
    } catch {
      return null
    }
  }

  const tryRestore = async (sessionId: SessionId): Promise<void> => {
    if (applied.has(sessionId)) return
    if (ctx.modelDirectories === undefined) return
    const summary = ctx.sessions.list.getSnapshot().byId[sessionId]
    if (summary === undefined || summary.blank !== true) return

    const loaded = await ensurePreference()
    if (loaded == null) return
    const pref = unwrapModlensSelection(loaded)

    const directory = ctx.modelDirectories.directoryFor(sessionId)
    try {
      await directory.load()
    } catch {
      return
    }
    const current = directory.store.getSnapshot().current
    if (current?.provider === pref.provider && current.model === pref.model) {
      applied.add(sessionId)
      return
    }
    try {
      await directory.select(pref as ModelSelection)
      applied.add(sessionId)
    } catch {
      // Provider may be temporarily unavailable; retry on next list tick.
    }
  }

  const onSessions = (): void => {
    const snapshot = ctx.sessions.list.getSnapshot()
    if (snapshot.phase !== 'ready' || snapshot.current === undefined) return
    void tryRestore(snapshot.current)
  }

  onSessions()
  const unsubscribe = ctx.sessions.list.subscribe(onSessions)
  ctx.effect(() => () => { unsubscribe() }, 'desktop-default-model:blank-restore')
}
