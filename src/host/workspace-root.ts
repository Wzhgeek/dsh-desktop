/** Shared workspace-boundary resolution for desktop-only host endpoints. */

import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

interface WorkspaceLike {
  path: string
}

export type WorkspaceRootResolution =
  | { ok: true; root: string }
  | { ok: false; error: string }

/**
 * Resolve a renderer-supplied cwd against the registered desktop workspaces.
 * A named environment override is retained for headless smoke tests and
 * deliberate single-repository deployments.
 */
export function resolveWorkspaceRoot(
  ctx: Context,
  requestedRoot?: string,
  envName = 'DSH_DESKTOP_WORKSPACE_ROOT',
): WorkspaceRootResolution {
  const envRoot = process.env[envName]
  if (envRoot !== undefined && envRoot.trim() !== '') return { ok: true, root: resolve(envRoot) }

  const registry = ctx.get('workspaceRegistry') as { list?: () => readonly WorkspaceLike[] } | undefined
  const workspaces = registry?.list?.() ?? []
  if (requestedRoot !== undefined) {
    const normalized = resolve(requestedRoot)
    const workspace = workspaces.find(entry => resolve(entry.path) === normalized)
    if (workspace === undefined) return { ok: false, error: 'requested workspace is not registered' }
    return { ok: true, root: resolve(workspace.path) }
  }

  const workspace = workspaces[0]
  return { ok: true, root: resolve(workspace?.path ?? process.cwd()) }
}

