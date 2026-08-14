/**
 * dsh-desktop main process — present the embedded dsh `web` tree in a native
 * window. Boots the tree through {@link bootDesktopTree}, then loads the SPA
 * from its loopback URL (see `boot.ts` for the same-origin rationale). The
 * tree is disposed on window close and application exit.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { app, BrowserWindow } from 'electron'
import type { Context } from '@deepseek-ai/cordis'
import { bootDesktopTree } from './boot.ts'

/** Booted tree plus the URL each created window loads. */
const state: { ctx?: Context; url?: string } = {}

/**
 * Dispose the plugin tree, then exit the application.
 * @param code - the process exit code.
 */
async function disposeAndQuit(code: number): Promise<void> {
  await state.ctx?.fiber.dispose()
  app.exit(code)
}

/** Create the application window and load the embedded GUI. */
function createWindow(): void {
  if (state.url === undefined) return
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'DeepSeek Harness',
  })
  void win.loadURL(state.url)
}

void app.whenReady().then(async () => {
  try {
    const { ctx, url } = await bootDesktopTree((code) => { void disposeAndQuit(code) })
    state.ctx = ctx
    state.url = url
  } catch (error) {
    console.error(error)
    app.exit(1)
    return
  }
  createWindow()
})

// macOS: a dock click with no open window reopens one.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  // macOS keeps the app alive in the dock; other platforms quit.
  if (process.platform !== 'darwin') void disposeAndQuit(0)
})
