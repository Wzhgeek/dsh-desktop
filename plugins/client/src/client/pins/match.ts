// Author: Zihan Wang
// <wangzh011031@163.com>
/** Map a sidebar workspace group to session/workspace ids without reading React fibers. */

import type { SessionListState, WorkspaceListState, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'

export interface PinBinding {
  type: 'session' | 'workspace'
  id: string
}

const UNGROUPED_LABELS = new Set(['未分组', 'Ungrouped'])
const NEW_SESSION_LABELS = new Set(['新会话', 'New Session'])

function displayTitle(summary: { displayTitle: string; blank: boolean }): string {
  return summary.blank ? '新会话' : summary.displayTitle
}

function workspaceSessions(
  workspace: WorkspaceView | undefined,
  sessions: SessionListState,
  workspaces: WorkspaceListState,
  archived: ReadonlySet<string>,
): Array<{ id: string; title: string }> {
  const ids = workspace === undefined
    ? sessions.ids.filter(id => !workspaces.items.some(item => item.sessionIds.includes(id)))
    : workspace.sessionIds
  const rows: Array<{ id: string; title: string }> = []
  for (const id of ids) {
    if (archived.has(id)) continue
    const summary = sessions.byId[id]
    if (summary === undefined) continue
    rows.push({ id, title: displayTitle(summary) })
  }
  return rows
}

/** Resolve one on-screen group to pin targets. */
export function bindingsForGroup(
  groupLabel: string,
  sessionTitles: readonly string[],
  sessions: SessionListState,
  workspaces: WorkspaceListState,
): { workspace: PinBinding | undefined; sessions: Array<PinBinding | undefined> } {
  const archived = new Set(workspaces.archivedSessionIds)
  const workspace = UNGROUPED_LABELS.has(groupLabel)
    ? undefined
    : workspaces.items.find(item => item.title === groupLabel)
  const candidates = workspaceSessions(workspace, sessions, workspaces, archived)
  const used = new Set<string>()
  const matched = sessionTitles.map(title => {
    const normalized = NEW_SESSION_LABELS.has(title) ? '新会话' : title
    const hit = candidates.find(candidate => !used.has(candidate.id) && candidate.title === normalized)
    if (hit === undefined) return undefined
    used.add(hit.id)
    return { type: 'session' as const, id: hit.id }
  })
  return {
    workspace: workspace === undefined ? undefined : { type: 'workspace', id: workspace.workspaceId },
    sessions: matched,
  }
}

/** Compact relative time for sidebar rows. */
export function relativeLabel(updatedAt: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - updatedAt)
  if (elapsed < 60_000) return '刚刚'
  if (elapsed < 3_600_000) return `${String(Math.floor(elapsed / 60_000))}分钟`
  if (elapsed < 86_400_000) return `${String(Math.floor(elapsed / 3_600_000))}小时`
  if (elapsed < 2_592_000_000) return `${String(Math.floor(elapsed / 86_400_000))}天`
  return `${String(Math.floor(elapsed / 2_592_000_000))}月`
}
