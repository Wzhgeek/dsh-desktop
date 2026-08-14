/**
 * dsh-desktop host plugins — mounted in the boot `prepare` callback before the
 * config-tree entries settle. Registers the desktop HTTP endpoints and the
 * index.html taps (CSS variable injection for the appearance feature). The
 * `webServer` service arrives from the web-app bundle rows, so activation
 * waits on it through the declared injection.
 * @module @deepseek-ai/dsh-desktop/host
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: ctx.webServer type augmentation.
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'desktop-host'

/** Services required before the desktop surface can mount. */
export const inject = ['webServer']

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

  ctx.effect(() => server.tapIndex((html) => html.replace(
    '</head>',
    '<style>body::after{content:"desktop-host";position:fixed;right:4px;bottom:2px;font:10px/1 monospace;color:var(--dsw-alias-label-tertiary);z-index:0;pointer-events:none}</style></head>',
  )), 'desktop-host:index-tap')
}
