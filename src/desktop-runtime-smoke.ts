// Author: Zihan Wang
// <wangzh011031@163.com>
/** Hidden Electron smoke for the sandbox preload and its DOM event contract. */

import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'
import { DESKTOP_COMMAND_CHANNEL, DESKTOP_THEME_CHANNEL, DESKTOP_UPDATE_STATE_CHANNEL } from './desktop-ipc.ts'

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
    const updaterBridgeTypes = await win.webContents.executeJavaScript(`[
      typeof window.dshDesktop?.getUpdateState,
      typeof window.dshDesktop?.checkForUpdates,
      typeof window.dshDesktop?.downloadUpdate,
      typeof window.dshDesktop?.installUpdate,
      typeof window.dshDesktop?.openReleasePage,
      typeof window.dshDesktop?.onUpdateState,
    ].join(',')`) as unknown
    if (updaterBridgeTypes !== 'function,function,function,function,function,function') {
      throw new Error('updater bridge was not exposed')
    }
    const shellBridgeTypes = await win.webContents.executeJavaScript(`[
      typeof window.dshDesktop?.getShellState,
      typeof window.dshDesktop?.setShowWindowAccelerator,
      typeof window.dshDesktop?.rememberWorkspace,
      typeof window.dshDesktop?.clearRecentWorkspaces,
      typeof window.dshDesktop?.onShellState,
    ].join(',')`) as unknown
    if (shellBridgeTypes !== 'function,function,function,function,function') {
      throw new Error('shell bridge was not exposed')
    }
    const pathForFileType = await win.webContents.executeJavaScript('typeof window.dshDesktop?.pathForFile') as unknown
    if (pathForFileType !== 'function') throw new Error('pathForFile bridge was not exposed')
    const ptyBridgeTypes = await win.webContents.executeJavaScript(`[
      typeof window.dshDesktop?.createPty,
      typeof window.dshDesktop?.writePty,
      typeof window.dshDesktop?.resizePty,
      typeof window.dshDesktop?.killPty,
      typeof window.dshDesktop?.onPtyData,
      typeof window.dshDesktop?.onPtyExit,
    ].join(',')`) as unknown
    if (ptyBridgeTypes !== 'function,function,function,function,function,function') {
      throw new Error('pty bridge was not exposed')
    }

    await win.webContents.executeJavaScript(`
      window.__desktopSmoke = { commands: 0, themes: 0, updateStates: 0, fallbackClicks: 0 };
      window.__desktopCommandListener = (event) => {
        window.__desktopSmoke.commands += 1;
        event.preventDefault();
      };
      window.addEventListener(${JSON.stringify(DESKTOP_COMMAND_CHANNEL)}, window.__desktopCommandListener);
      window.addEventListener(${JSON.stringify(DESKTOP_THEME_CHANNEL)}, () => { window.__desktopSmoke.themes += 1; });
      window.__disposeUpdateSmoke = window.dshDesktop.onUpdateState((state) => {
        if (state.phase === 'available' && state.availableVersion === '9.9.9') window.__desktopSmoke.updateStates += 1;
      });
      document.querySelector('button').addEventListener('click', () => { window.__desktopSmoke.fallbackClicks += 1; });
    `)
    win.webContents.send(DESKTOP_COMMAND_CHANNEL, { command: 'settings' })
    win.webContents.send(DESKTOP_THEME_CHANNEL, { dark: true })
    win.webContents.send(DESKTOP_UPDATE_STATE_CHANNEL, { phase: 'available', currentVersion: '1.0.0', availableVersion: '9.9.9' })
    await waitFor(win, 'window.__desktopSmoke.commands', 1)
    await waitFor(win, 'window.__desktopSmoke.themes', 1)
    await waitFor(win, 'window.__desktopSmoke.updateStates', 1)
    await waitFor(win, 'window.__desktopSmoke.fallbackClicks', 0)

    await win.webContents.executeJavaScript(`
      window.removeEventListener(${JSON.stringify(DESKTOP_COMMAND_CHANNEL)}, window.__desktopCommandListener);
      window.__disposeUpdateSmoke();
    `)
    win.webContents.send(DESKTOP_COMMAND_CHANNEL, { command: 'settings' })
    await waitFor(win, 'window.__desktopSmoke.fallbackClicks', 1)
    console.log('OK: sandbox preload, desktop commands, theme bridge, updater bridge, and shell bridge')
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
