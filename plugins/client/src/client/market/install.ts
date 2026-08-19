// Author: Zihan Wang
// <wangzh011031@163.com>
/** Open a workspace session and stage a review prompt without sending it. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'

const SCOPE_WAIT_MS = 4_000
const SCOPE_POLL_MS = 60

export type InstallOutcome =
  | { ok: true }
  | { ok: false; reason: 'not-ready' | 'no-workspace' | 'failed'; message?: string }

function wait(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/** Stage `prompt` in a new session for the current or most recent workspace. */
export async function stageReviewInstall(ctx: ClientContext, prompt: string): Promise<InstallOutcome> {
  const workspaces = ctx.workspaces
  const sessions = ctx.sessions
  const conversation = ctx.get('conversation') as IConversation | undefined
  if (conversation === undefined) {
    return { ok: false, reason: 'failed', message: '会话输入服务未就绪' }
  }

  const workspaceState = workspaces.list.getSnapshot()
  if (!workspaceState.baselinesReady) return { ok: false, reason: 'not-ready' }

  const current = sessions.list.getSnapshot().current
  const currentWorkspaceId = current === undefined
    ? undefined
    : workspaceState.items.find(item => item.sessionIds.includes(current))?.workspaceId
  const workspaceId = currentWorkspaceId ?? workspaceState.recentWorkspaceId
  if (workspaceId === undefined) return { ok: false, reason: 'no-workspace' }

  try {
    const sessionId = await workspaces.connectWorkspace(workspaceId)
    sessions.open(sessionId)
    const deadline = Date.now() + SCOPE_WAIT_MS
    let actx = sessions.scope(sessionId)
    while (actx === undefined && Date.now() < deadline) {
      await wait(SCOPE_POLL_MS)
      actx = sessions.scope(sessionId)
    }
    if (actx === undefined) {
      return { ok: false, reason: 'failed', message: '新会话未能打开' }
    }
    conversation.input.for(actx).setDraft(prompt)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}
