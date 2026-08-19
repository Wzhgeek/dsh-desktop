// Author: Zihan Wang
// <wangzh011031@163.com>
/** Open and remember desktop workspaces through the shared client runtime. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** Register a path as a workspace, connect a session, and remember it natively. */
export async function openDesktopWorkspace(ctx: ClientContext, path: string): Promise<void> {
  const workspace = await ctx.workspaces.create({ path })
  ctx.workspaces.startSession(workspace.workspaceId)
  window.dshDesktop?.rememberWorkspace({ path: workspace.path, title: workspace.title })
}

/** Open the native directory picker, then adopt the selected folder. */
export async function pickDesktopWorkspace(ctx: ClientContext): Promise<void> {
  const selected = await ctx.workspaces.pickDirectory()
  if (selected === null || selected.trim() === '') return
  await openDesktopWorkspace(ctx, selected)
}

/** Push the current session workspace into the native recents list. */
export function rememberCurrentWorkspace(ctx: ClientContext): string | undefined {
  const sessions = ctx.sessions.list.getSnapshot()
  const workspaces = ctx.workspaces.list.getSnapshot()
  const current = sessions.current === undefined ? undefined : sessions.byId[sessions.current]
  const cwd = current?.cwd
  if (cwd !== undefined && cwd.trim() !== '') {
    const match = workspaces.items.find(item => item.path === cwd)
    window.dshDesktop?.rememberWorkspace(match === undefined ? { path: cwd } : { path: cwd, title: match.title })
    return cwd
  }
  const recent = workspaces.items.find(item => item.workspaceId === workspaces.recentWorkspaceId) ?? workspaces.items[0]
  if (recent === undefined) return undefined
  window.dshDesktop?.rememberWorkspace({ path: recent.path, title: recent.title })
  return recent.path
}
