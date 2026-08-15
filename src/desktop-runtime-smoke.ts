/** Hidden Electron smoke for the sandbox preload and its DOM event contract. */

import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'
import { DESKTOP_COMMAND_CHANNEL, DESKTOP_THEME_CHANNEL } from './desktop-ipc.ts'

const PRELOAD_PATH = fileURLToPath(new URL('./preload.cjs', import.meta.url))

async function waitFor<T>(win: BrowserWindow, expression: string, expected: T): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await win.webContents.executeJavaScript(expression) as unknown
    if (current === expected) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${expression} to equal ${String(expected)}`)
}

void app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD_PATH,
      sandbox: true,
    },
  })
  try {
    await win.loadURL('data:text/html,<button aria-haspopup="dialog">settings</button>')
    const bridgeType = await win.webContents.executeJavaScript('typeof window.dshDesktop?.notify') as unknown
    if (bridgeType !== 'function') throw new Error('notification bridge was not exposed')
    const openPathBridgeType = await win.webContents.executeJavaScript('typeof window.dshDesktop?.openPath') as unknown
    if (openPathBridgeType !== 'function') throw new Error('open-path bridge was not exposed')

    await win.webContents.executeJavaScript(`
      window.__desktopSmoke = { commands: 0, themes: 0, fallbackClicks: 0 };
      window.__desktopCommandListener = (event) => {
        window.__desktopSmoke.commands += 1;
        event.preventDefault();
      };
      window.addEventListener(${JSON.stringify(DESKTOP_COMMAND_CHANNEL)}, window.__desktopCommandListener);
      window.addEventListener(${JSON.stringify(DESKTOP_THEME_CHANNEL)}, () => { window.__desktopSmoke.themes += 1; });
      document.querySelector('button').addEventListener('click', () => { window.__desktopSmoke.fallbackClicks += 1; });
    `)
    win.webContents.send(DESKTOP_COMMAND_CHANNEL, { command: 'settings' })
    win.webContents.send(DESKTOP_THEME_CHANNEL, { dark: true })
    await waitFor(win, 'window.__desktopSmoke.commands', 1)
    await waitFor(win, 'window.__desktopSmoke.themes', 1)
    await waitFor(win, 'window.__desktopSmoke.fallbackClicks', 0)

    await win.webContents.executeJavaScript(`
      window.removeEventListener(${JSON.stringify(DESKTOP_COMMAND_CHANNEL)}, window.__desktopCommandListener);
    `)
    win.webContents.send(DESKTOP_COMMAND_CHANNEL, { command: 'settings' })
    await waitFor(win, 'window.__desktopSmoke.fallbackClicks', 1)
    console.log('OK: sandbox preload, desktop command cancellation/fallback, and theme bridge')
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
