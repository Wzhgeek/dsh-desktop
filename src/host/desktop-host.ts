/**
 * dsh-desktop host plugins — mounted in the boot `prepare` callback before the
 * config-tree entries settle. Registers the desktop HTTP endpoints and the
 * index.html taps (CSS variable injection for the appearance feature). The
 * `webServer` service arrives from the web-app bundle rows, so activation
 * waits on it through the declared injection.
 * @module @deepseek-ai/dsh-desktop/host
 */

import { opendir, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: ctx.webServer type augmentation.
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'desktop-host'

/** Services required before the desktop surface can mount. */
export const inject = ['webServer']

const SEARCH_LIMIT = 40
const SEARCH_SCAN_LIMIT = 12_000
const SEARCH_DEPTH_LIMIT = 14
const IGNORED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', '.next', '.cache', '.pytest_cache', '__pycache__', 'coverage',
])

export interface DesktopFileSearchResult {
  path: string
  relativePath: string
  name: string
}

/**
 * Mount the desktop host surface: the ping health route (proving the HTTP
 * path) and an index tap that tags the SPA with a desktop marker.
 * @param ctx - plugin context carrying the webServer service.
 */
export function apply(ctx: Context): void {
  const server = ctx.webServer
  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/desktop/ping',
    handler: (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    },
  }), 'desktop-host:ping')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/desktop/files/search',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const cwd = url.searchParams.get('cwd')?.trim() ?? ''
        const query = url.searchParams.get('q')?.trim() ?? ''
        const mention = url.searchParams.get('mention') === '1'
        if (cwd === '' || !isAbsolute(cwd) || (!mention && query === '') || query.length > 200) {
          sendJson(res, 400, { error: 'A workspace and query are required.' })
          return
        }
        const root = resolve(cwd)
        if (!(await stat(root)).isDirectory()) {
          sendJson(res, 400, { error: 'The workspace is not a directory.' })
          return
        }
        sendJson(res, 200, { items: await searchWorkspaceFiles(root, query) })
      } catch (error) {
        ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        sendJson(res, 500, { error: 'Unable to search workspace files.' })
      }
    },
  }), 'desktop-host:file-search')

  ctx.effect(() => server.tapIndex((html) => html.replace(
    '</head>',
    '<style>body::after{content:"desktop-host";position:fixed;right:4px;bottom:2px;font:10px/1 monospace;color:var(--dsw-alias-label-tertiary);z-index:0;pointer-events:none}</style></head>',
  )), 'desktop-host:index-tap')
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Bounded filename/path search that never follows directory symlinks. */
export async function searchWorkspaceFiles(root: string, rawQuery: string): Promise<DesktopFileSearchResult[]> {
  const query = rawQuery.toLocaleLowerCase()
  const matches: Array<DesktopFileSearchResult & { score: number }> = []
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }]
  let scanned = 0
  while (queue.length > 0 && scanned < SEARCH_SCAN_LIMIT) {
    const current = queue.shift()
    if (current === undefined) break
    let directory
    try {
      directory = await opendir(current.path)
    } catch {
      continue
    }
    for await (const entry of directory) {
      scanned += 1
      if (scanned > SEARCH_SCAN_LIMIT) break
      const path = join(current.path, entry.name)
      if (entry.isDirectory()) {
        if (current.depth < SEARCH_DEPTH_LIMIT && !IGNORED_DIRECTORIES.has(entry.name)) {
          queue.push({ path, depth: current.depth + 1 })
        }
        continue
      }
      if (!entry.isFile()) continue
      const relativePath = relative(root, path).split(sep).join('/')
      const lowerName = entry.name.toLocaleLowerCase()
      const lowerPath = relativePath.toLocaleLowerCase()
      const index = lowerPath.indexOf(query)
      if (index < 0) continue
      const score = lowerName === query ? 0 : lowerName.startsWith(query) ? 1 : lowerName.includes(query) ? 2 : 3 + index / 1_000
      matches.push({ path, relativePath, name: basename(path), score })
    }
  }
  return matches
    .sort((left, right) => left.score - right.score || left.relativePath.length - right.relativePath.length || left.relativePath.localeCompare(right.relativePath))
    .slice(0, SEARCH_LIMIT)
    .map(({ score: _score, ...entry }) => entry)
}
