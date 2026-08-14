/**
 * Electron render smoke: boot the embedded tree, load the SPA in an offscreen
 * BrowserWindow, and assert the renderer actually receives the shell. Run with
 * `electron dist/render-smoke.js` after a repository build.
 * @module @deepseek-ai/dsh-desktop/render-smoke
 */

import { app, BrowserWindow } from 'electron'
import { bootDesktopTree } from './boot.ts'

void app.whenReady().then(async () => {
  const { ctx, url } = await bootDesktopTree()
  try {
    const win = new BrowserWindow({ show: false })
    await win.loadURL(url)
    const title = await win.webContents.executeJavaScript('document.title') as string
    const hasBoot = await win.webContents.executeJavaScript(
      'typeof window.__DSH_BOOT__ !== "undefined"',
    ) as boolean
    const bootJson = await win.webContents.executeJavaScript(
      'JSON.stringify(window.__DSH_BOOT__ ?? null)',
    ) as string
    if (title !== 'DeepSeek Harness') throw new Error(`unexpected title: ${JSON.stringify(title)}`)
    if (!hasBoot) throw new Error('renderer received no window.__DSH_BOOT__ host injection')
    if (!bootJson.includes('@dsh-desktop/client')) throw new Error('client-modules did not discover @dsh-desktop/client bundle')
    console.log(`OK: rendered ${JSON.stringify(title)} with window.__DSH_BOOT__ (+ @dsh-desktop/client)`)
  } finally {
    await ctx.fiber.dispose()
    app.exit(0)
  }
})
