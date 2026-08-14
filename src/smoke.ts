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
  if (!body.includes('desktop-host')) throw new Error('host index tap did not run')
  const ping = await fetch(`${url}/api/desktop/ping`)
  const pingBody = await ping.text()
  if (ping.status !== 200 || pingBody !== '{"ok":true}') throw new Error(`desktop ping route answered ${ping.status} ${pingBody}`)
  const appearance = await fetch(`${url}/api/desktop/appearance`)
  const appearanceBody = await appearance.json() as { fontSize?: unknown }
  if (appearance.status !== 200 || typeof appearanceBody.fontSize !== 'number') throw new Error('appearance route failed')
  const pricing = await fetch(`${url}/api/desktop/usage/pricing`)
  const pricingBody = await pricing.json() as { defaultModel?: unknown }
  if (pricing.status !== 200 || typeof pricingBody.defaultModel !== 'string') throw new Error('pricing route failed')
  const git = await fetch(`${url}/api/desktop/git/status`)
  const gitBody = await git.json() as { ok?: unknown }
  if (git.status !== 200 || typeof gitBody.ok !== 'boolean') throw new Error('git status route failed')
  console.log(`OK: ${url} -> ${res.status} (${body.length} bytes), ping ${pingBody}; appearance/pricing/git routes up`)
} finally {
  await ctx.fiber.dispose()
}
