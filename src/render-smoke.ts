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
    if (title !== 'DeepSeek Harness') throw new Error(`unexpected title: ${JSON.stringify(title)}`)
    if (!hasBoot) throw new Error('renderer received no window.__DSH_BOOT__ host injection')
    console.log(`OK: rendered ${JSON.stringify(title)} with window.__DSH_BOOT__`)
  } finally {
    await ctx.fiber.dispose()
    app.exit(0)
  }
})
