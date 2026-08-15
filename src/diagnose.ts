/**
 * Electron diagnostic: report which directory-picker backend is mounted and
 * whether the appearance CSS-variable injection actually recomputes the brand
 * token on the live page. Run with `electron dist/diagnose.js`.
 * @module @deepseek-ai/dsh-desktop/diagnose
 */

import { app, BrowserWindow } from 'electron'
import { bootDesktopTree } from './boot.ts'

void app.whenReady().then(async () => {
  const { ctx, url } = await bootDesktopTree()
  try {
    const picker = ctx.get('directoryPicker') as { capability?: () => unknown } | undefined
    console.log('PICKER_CAPABILITY:', JSON.stringify(picker?.capability?.() ?? null))

    const win = new BrowserWindow({ show: false })
    await win.loadURL(url)
    // Let the shell activate and mount the UI before sampling computed styles.
    await new Promise((resolve) => { setTimeout(resolve, 3500) })
    const bootJson = await win.webContents.executeJavaScript(
      'JSON.stringify(window.__DSH_BOOT__ ?? null)',
    ) as string
    console.log('NATIVE_SURFACE_MOUNTED:', bootJson.includes('@deepseek-ai/dsh-client-ui-directory-picker-native'))
    const theme = await win.webContents.executeJavaScript(`(() => {
      const root = document.documentElement
      const bodyStyle = getComputedStyle(document.body)
      const before = bodyStyle.getPropertyValue('--dsw-alias-button-primary-fill').trim()
      root.style.setProperty('--dsh-desktop-accent', '#ff0000')
      const after = getComputedStyle(document.body).getPropertyValue('--dsw-alias-button-primary-fill').trim()
      const accentVar = root.style.getPropertyValue('--dsh-desktop-accent').trim()
      const styleTag = document.querySelector('style#dsh-desktop-appearance') !== null
      return { before, after, accentVar, styleTagPresent: styleTag }
    })()`)
    console.log('THEME_RECOMPUTE:', JSON.stringify(theme))
  } finally {
    await ctx.fiber.dispose()
    app.exit(0)
  }
})
