/**
 * Headless smoke for the embedded web tree: boot it, confirm the SPA answers
 * 200 at the loopback URL, then dispose. Run with `tsx src/smoke.ts` after a
 * repository build (needs the built packages and apps/web dist).
 * @module @deepseek-ai/dsh-desktop/smoke
 */

import { bootDesktopTree } from './boot.ts'

const { ctx, url } = await bootDesktopTree()
try {
  const res = await fetch(url)
  const body = await res.text()
  if (res.status !== 200) throw new Error(`SPA answered ${res.status}`)
  if (!body.includes('<title>DeepSeek Harness</title>')) throw new Error('SPA index does not look like the dsh web shell')
  if (!body.includes('<script type="module"')) throw new Error('SPA index carries no module entry')
  console.log(`OK: ${url} -> ${res.status} (${body.length} bytes)`)
} finally {
  await ctx.fiber.dispose()
}
