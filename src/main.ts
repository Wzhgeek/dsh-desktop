// Author: Zihan Wang
// <wangzh011031@163.com>
/**
 * dsh-desktop main process — present the embedded dsh `web` tree in a native
 * window. Boots the tree through {@link bootDesktopTree}, then loads the SPA
 * from its loopback URL (see `boot.ts` for the same-origin rationale). The
 * tree is disposed on window close and application exit.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  shell,
  Tray,
} from 'electron'
import type { NativeImage } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import electronUpdater from 'electron-updater'
import type { Context } from '@deepseek-ai/cordis'
import { bootDesktopTree } from './boot.ts'
import { packagedUpdateUnavailableReason, macAppProperlySigned } from './desktop-update.ts'
import { DesktopPtyHost, parsePtyCreateRequest, parsePtyKillRequest, parsePtyResizeRequest, parsePtyWriteRequest } from './desktop-pty.ts'
import {
  DESKTOP_ACTIVE_SESSION_CHANNEL,
  DESKTOP_COMMAND_CHANNEL,
  DESKTOP_NOTIFICATION_CHANNEL,
  DESKTOP_OPEN_PATH_CHANNEL,
  DESKTOP_SHELL_CLEAR_RECENTS_CHANNEL,
  DESKTOP_SHELL_GET_STATE_CHANNEL,
  DESKTOP_SHELL_REMEMBER_WORKSPACE_CHANNEL,
  DESKTOP_SHELL_SET_ACCELERATOR_CHANNEL,
  DESKTOP_SHELL_STATE_CHANNEL,
  DESKTOP_THEME_CHANNEL,
  DESKTOP_PTY_CREATE_CHANNEL,
  DESKTOP_PTY_DATA_CHANNEL,
  DESKTOP_PTY_EXIT_CHANNEL,
  DESKTOP_PTY_KILL_CHANNEL,
  DESKTOP_PTY_RESIZE_CHANNEL,
  DESKTOP_PTY_WRITE_CHANNEL,
  DESKTOP_UPDATE_CHECK_CHANNEL,
  DESKTOP_UPDATE_DOWNLOAD_CHANNEL,
  DESKTOP_UPDATE_GET_STATE_CHANNEL,
  DESKTOP_UPDATE_INSTALL_CHANNEL,
  DESKTOP_UPDATE_OPEN_RELEASES_CHANNEL,
  DESKTOP_UPDATE_STATE_CHANNEL,
  isSessionId,
  parseNotification,
  parseOpenPathRequest,
} from './desktop-ipc.ts'
import {
  DEFAULT_SHOW_WINDOW_ACCELERATOR,
  formatAcceleratorLabel,
  normalizeShowWindowAccelerator,
  parsePersistedDesktopState,
  parseRememberWorkspaceRequest,
  recentWorkspaceLabel,
  rememberRecentWorkspace,
  type DesktopShellState,
  type RecentWorkspace,
} from './desktop-shell.ts'
import type {
  DesktopCommandPayload,
  DesktopFileOpener,
  DesktopOpenPathResult,
  DesktopThemePayload,
  DesktopUpdateActionResult,
  DesktopUpdateState,
} from './desktop-ipc.ts'

const { autoUpdater } = electronUpdater

/** Booted tree plus the URL each created window loads. */
const state: {
  ctx: Context | undefined
  url: string | undefined
  win: BrowserWindow | undefined
  /** Shown while `bootDesktopTree` is still settling (e.g. vision runtime prepare). */
  bootSplash: BrowserWindow | undefined
  tray: Tray | undefined
  notifications: Set<Notification>
  quitting: boolean
  activeSessionId: string | undefined
  showWindowAccelerator: string
  recentWorkspaces: RecentWorkspace[]
} = {
  ctx: undefined,
  url: undefined,
  win: undefined,
  bootSplash: undefined,
  tray: undefined,
  notifications: new Set(),
  quitting: false,
  activeSessionId: undefined,
  showWindowAccelerator: DEFAULT_SHOW_WINDOW_ACCELERATOR,
  recentWorkspaces: [],
}

const PRELOAD_PATH = fileURLToPath(new URL('./preload.cjs', import.meta.url))
const APP_ICON_PATH = fileURLToPath(new URL('../resources/dsh-icon.png', import.meta.url))
const APP_NAME = 'Dsh Desktop'
const LEGACY_USER_DATA_NAME = '@deepseek-ai/dsh-desktop'
const STATE_FILE_NAME = 'dsh-desktop-state.json'
const RELEASES_URL = 'https://github.com/Wzhgeek/dsh-desktop/releases'
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60_000
let disposePromise: Promise<void> | undefined
let stateWriteQueue: Promise<void> = Promise.resolve()
let cachedAppIcon: NativeImage | undefined
let updateState: DesktopUpdateState = initialUpdateState()
const ptyHost = new DesktopPtyHost()

// Renaming must not strand Chromium storage and desktop state in a new folder.
const legacyUserDataPath = join(app.getPath('appData'), LEGACY_USER_DATA_NAME)
app.setName(APP_NAME)
app.setPath('userData', legacyUserDataPath)
app.setPath('sessionData', legacyUserDataPath)
process.title = APP_NAME

const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) app.exit(0)

/** Load the vendored Harness icon once; an empty image falls back gracefully. */
function getAppIcon(): NativeImage | undefined {
  if (cachedAppIcon !== undefined) return cachedAppIcon
  const icon = nativeImage.createFromPath(APP_ICON_PATH)
  if (icon.isEmpty()) {
    console.error(`[desktop] application icon is unavailable: ${APP_ICON_PATH}`)
    return undefined
  }
  cachedAppIcon = icon
  return icon
}

/**
 * Dispose the plugin tree, then exit the application.
 * @param code - the process exit code.
 */
async function disposeResources(): Promise<void> {
  disposePromise ??= (async () => {
    dismissBootSplash()
    ptyHost.dispose()
    state.tray?.destroy()
    state.tray = undefined
    globalShortcut.unregisterAll()
    await stateWriteQueue
    await state.ctx?.fiber.dispose()
  })()
  await disposePromise
}

async function disposeAndQuit(code: number): Promise<void> {
  state.quitting = true
  await disposeResources()
  app.exit(code)
}

/** Close the temporary boot splash if it is still open. */
function dismissBootSplash(): void {
  const splash = state.bootSplash
  state.bootSplash = undefined
  if (splash === undefined || splash.isDestroyed()) return
  splash.destroy()
}

/**
 * Show a small native window while the embedded tree is still booting.
 * Profile plugins such as Vision Toolkit may prepare a Python runtime for
 * several minutes before `bootDesktopTree` resolves; without this splash the
 * Dock icon appears live but activate/showWindow cannot open the SPA yet.
 */
function showBootSplash(message: string): BrowserWindow {
  const existing = state.bootSplash
  if (existing !== undefined && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return existing
  }
  const icon = getAppIcon()
  const splash = new BrowserWindow({
    width: 440,
    height: 200,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: APP_NAME,
    autoHideMenuBar: true,
    ...(icon === undefined ? {} : { icon }),
  })
  state.bootSplash = splash
  splash.on('closed', () => {
    if (state.bootSplash === splash) state.bootSplash = undefined
  })
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${APP_NAME}</title>
<style>
  html,body{margin:0;height:100%;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  background:#111;color:#eee;display:flex;align-items:center;justify-content:center}
  main{max-width:24rem;padding:1.25rem 1.5rem;text-align:center}
  h1{margin:0 0 .5rem;font-size:1.05rem;font-weight:600}
  p{margin:0;opacity:.78}
</style></head><body><main><h1>${APP_NAME}</h1><p>${message}</p></main></body></html>`
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(body)}`)
  splash.show()
  splash.focus()
  return splash
}

/** Create the application window and load the embedded GUI. */
function createWindow(): BrowserWindow | undefined {
  if (state.url === undefined) return
  const existing = state.win
  if (existing !== undefined && !existing.isDestroyed()) return existing
  const icon = getAppIcon()
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    title: APP_NAME,
    ...(icon === undefined ? {} : { icon }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD_PATH,
      sandbox: true,
    },
  })
  state.win = win
  win.on('close', (event) => {
    if (!state.quitting && state.tray !== undefined) {
      event.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    if (state.win === win) state.win = undefined
  })
  win.webContents.on('did-finish-load', () => {
    sendTheme(win)
    sendUpdateState(win)
    sendShellState(win)
    if (state.activeSessionId !== undefined) {
      sendCommand({ command: 'restore-session', sessionId: state.activeSessionId }, win)
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  void win.loadURL(state.url)
  return win
}

/** Reveal the existing application window, recreating it only after destruction. */
function showWindow(): BrowserWindow | undefined {
  if (state.url === undefined) {
    showBootSplash('正在启动…首次启用识图插件时可能需要几分钟准备运行时。')
    return undefined
  }
  dismissBootSplash()
  const win = createWindow()
  if (win === undefined) return undefined
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return win
}

/** Deliver one native menu command to the isolated renderer bridge. */
function sendCommand(payload: DesktopCommandPayload, target = showWindow()): void {
  if (target === undefined || target.isDestroyed()) return
  if (target.webContents.isLoadingMainFrame()) {
    target.webContents.once('did-finish-load', () => { sendCommand(payload, target) })
    return
  }
  target.webContents.send(DESKTOP_COMMAND_CHANNEL, payload)
}

/** Publish the current effective system theme to the renderer bridge. */
function sendTheme(target = state.win): void {
  if (target === undefined || target.isDestroyed()) return
  const payload: DesktopThemePayload = { dark: nativeTheme.shouldUseDarkColors }
  target.webContents.send(DESKTOP_THEME_CHANNEL, payload)
}

/** Publish the updater snapshot to the current renderer, if it is ready. */
function sendUpdateState(target = state.win): void {
  if (target === undefined || target.isDestroyed() || target.webContents.isLoadingMainFrame()) return
  target.webContents.send(DESKTOP_UPDATE_STATE_CHANNEL, updateState)
}

/** Replace updater state while keeping the installed version authoritative. */
function setUpdateState(next: Omit<DesktopUpdateState, 'currentVersion'>): void {
  updateState = { currentVersion: app.getVersion(), ...next }
  sendUpdateState()
}

/** Install native accelerators without claiming OS-global shortcuts. */
function installApplicationMenu(): void {
  const send = (command: 'command-palette' | 'new-session' | 'settings' | 'open-workspace-picker' | 'toggle-terminal') => (): void => {
    sendCommand({ command })
  }
  const appMenu: MenuItemConstructorOptions = {
    label: APP_NAME,
    submenu: [
      { role: 'about' },
      { label: '检查更新…', click: () => { void checkForDesktopUpdates() } },
      { type: 'separator' },
      { label: '设置', accelerator: 'CmdOrCtrl+,', click: send('settings') },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { void disposeAndQuit(0) } },
    ],
  }
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [appMenu] : []),
    {
      label: '文件',
      submenu: [
        { label: '新会话', accelerator: 'CmdOrCtrl+N', click: send('new-session') },
        { label: '打开工作区…', accelerator: 'CmdOrCtrl+O', click: send('open-workspace-picker') },
        { label: '最近打开', submenu: recentWorkspaceMenuItems() },
        ...(process.platform === 'darwin' ? [] : [
          { type: 'separator' as const },
          { label: '设置', accelerator: 'CmdOrCtrl+,', click: send('settings') },
          { type: 'separator' as const },
          { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { void disposeAndQuit(0) } },
        ]),
      ],
    },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: '查看',
      submenu: [
        { label: '命令面板', accelerator: 'CmdOrCtrl+K', click: send('command-palette') },
        { label: '终端', accelerator: 'Ctrl+`', click: send('toggle-terminal') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: `显示窗口（${formatAcceleratorLabel(state.showWindowAccelerator)}）`, click: () => { showWindow() } },
        { role: 'minimize' },
        { role: 'front' },
      ],
    },
    ...(process.platform === 'darwin' ? [] : [{
      label: '帮助',
      submenu: [
        { label: '检查更新…', click: () => { void checkForDesktopUpdates() } },
        { label: 'GitHub Releases', click: () => { void shell.openExternal(RELEASES_URL) } },
      ],
    }]),
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function recentWorkspaceMenuItems(): MenuItemConstructorOptions[] {
  if (state.recentWorkspaces.length === 0) {
    return [{ label: '没有最近工程', enabled: false }]
  }
  return [
    ...state.recentWorkspaces.map(entry => ({
      label: recentWorkspaceLabel(entry),
      toolTip: entry.path,
      click: () => { openRecentWorkspace(entry.path) },
    })),
    { type: 'separator' as const },
    { label: '清除最近记录', click: () => { clearRecentWorkspaces() } },
  ]
}

function trayMenuTemplate(): MenuItemConstructorOptions[] {
  const recents = state.recentWorkspaces.slice(0, 5).map(entry => ({
    label: recentWorkspaceLabel(entry),
    toolTip: entry.path,
    click: () => { openRecentWorkspace(entry.path) },
  }))
  return [
    { label: `显示窗口（${formatAcceleratorLabel(state.showWindowAccelerator)}）`, click: () => { showWindow() } },
    { type: 'separator' },
    ...(recents.length === 0
      ? [{ label: '没有最近工程', enabled: false }]
      : [{ label: '最近打开', enabled: false }, ...recents]),
    { type: 'separator' },
    { label: '退出', click: () => { void disposeAndQuit(0) } },
  ]
}

function rebuildNativeChrome(): void {
  installApplicationMenu()
  state.tray?.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()))
  state.tray?.setToolTip(`${APP_NAME}（${formatAcceleratorLabel(state.showWindowAccelerator)} 唤出）`)
  if (process.platform === 'darwin') {
    app.dock?.setMenu(Menu.buildFromTemplate(recentWorkspaceMenuItems()))
  }
}

function currentShellState(): DesktopShellState {
  return {
    accelerator: state.showWindowAccelerator,
    acceleratorLabel: formatAcceleratorLabel(state.showWindowAccelerator),
    recents: state.recentWorkspaces,
  }
}

function sendShellState(target = state.win): void {
  if (target === undefined || target.isDestroyed() || target.webContents.isLoadingMainFrame()) return
  target.webContents.send(DESKTOP_SHELL_STATE_CHANNEL, currentShellState())
}

function openRecentWorkspace(path: string): void {
  sendCommand({ command: 'open-workspace', path })
}

function rememberWorkspace(request: { path: string; title?: string }): void {
  const next = rememberRecentWorkspace(state.recentWorkspaces, request)
  const current = state.recentWorkspaces[0]
  if (current?.path === next[0]?.path && current?.title === next[0]?.title && next.length === state.recentWorkspaces.length) return
  state.recentWorkspaces = next
  queueDesktopStateWrite()
  rebuildNativeChrome()
  sendShellState()
}

function clearRecentWorkspaces(): void {
  if (state.recentWorkspaces.length === 0) return
  state.recentWorkspaces = []
  queueDesktopStateWrite()
  rebuildNativeChrome()
  sendShellState()
}

function installShowWindowShortcut(): boolean {
  globalShortcut.unregisterAll()
  try {
    return globalShortcut.register(state.showWindowAccelerator, () => { showWindow() })
  } catch (error) {
    console.error('[desktop] could not register show-window shortcut:', error)
    return false
  }
}

function setShowWindowAccelerator(value: string): DesktopUpdateActionResult {
  const accelerator = normalizeShowWindowAccelerator(value)
  const previous = state.showWindowAccelerator
  state.showWindowAccelerator = accelerator
  if (!installShowWindowShortcut()) {
    state.showWindowAccelerator = previous
    if (!installShowWindowShortcut() && previous !== DEFAULT_SHOW_WINDOW_ACCELERATOR) {
      state.showWindowAccelerator = DEFAULT_SHOW_WINDOW_ACCELERATOR
      installShowWindowShortcut()
    }
    return { ok: false, error: '这个快捷键无法注册，可能已被系统或其他应用占用。' }
  }
  queueDesktopStateWrite()
  rebuildNativeChrome()
  sendShellState()
  return { ok: true }
}

/** Create the status item after ready so packaged builds inherit their app icon. */
async function createTray(): Promise<void> {
  try {
    const appIcon = getAppIcon() ?? await app.getFileIcon(process.execPath, { size: 'small' })
    const icon = appIcon.isEmpty() ? nativeImage.createEmpty() : appIcon.resize({ width: 18, height: 18 })
    if (process.platform === 'darwin') icon.setTemplateImage(true)
    const tray = new Tray(icon)
    state.tray = tray
    tray.setToolTip(`${APP_NAME}（${formatAcceleratorLabel(state.showWindowAccelerator)} 唤出）`)
    tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()))
    tray.on('click', () => { showWindow() })
  } catch (error) {
    console.error('[desktop] could not create system tray:', error)
  }
}

function isTrustedRenderer(sender: Electron.WebContents): boolean {
  const win = state.win
  if (win === undefined || win.isDestroyed() || sender !== win.webContents || state.url === undefined) return false
  try {
    return new URL(sender.getURL()).origin === new URL(state.url).origin
  } catch {
    return false
  }
}

function installIpc(): void {
  ipcMain.handle(DESKTOP_OPEN_PATH_CHANNEL, async (event, value: unknown): Promise<DesktopOpenPathResult> => {
    if (!isTrustedRenderer(event.sender)) return { ok: false, error: 'Untrusted renderer.' }
    const request = parseOpenPathRequest(value)
    if (request === undefined) return { ok: false, error: 'Invalid path.' }
    const source = sourceLocation(request.path)
    const requestedPath = source.path
    const expandedPath = requestedPath === '~'
      ? homedir()
      : requestedPath.startsWith('~/') || requestedPath.startsWith('~\\')
        ? join(homedir(), requestedPath.slice(2))
        : requestedPath
    const localPath = isAbsolute(expandedPath)
      ? resolve(expandedPath)
      : resolve(request.cwd ?? process.cwd(), expandedPath)
    try {
      const stats = await stat(localPath)
      return await openLocalPath(localPath, stats.isDirectory(), request.opener ?? 'system', source.line, source.column)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.on(DESKTOP_NOTIFICATION_CHANNEL, (event, value: unknown) => {
    if (!isTrustedRenderer(event.sender)) return
    const payload = parseNotification(value)
    if (payload === undefined || !Notification.isSupported()) return
    const notification = new Notification({
      title: payload.title,
      body: payload.body,
      ...(payload.silent === undefined ? {} : { silent: payload.silent }),
    })
    state.notifications.add(notification)
    const release = (): void => { state.notifications.delete(notification) }
    notification.on('close', release)
    notification.on('failed', (_failedEvent, error) => {
      release()
      console.error('[desktop] native notification failed:', error)
    })
    notification.on('click', () => {
      release()
      const win = showWindow()
      if (payload.sessionId !== undefined) {
        sendCommand({ command: 'restore-session', sessionId: payload.sessionId }, win)
      }
    })
    notification.show()
    setTimeout(release, 5 * 60_000).unref()
  })
  ipcMain.on(DESKTOP_ACTIVE_SESSION_CHANNEL, (event, value: unknown) => {
    if (!isTrustedRenderer(event.sender)) return
    if (value !== undefined && !isSessionId(value)) return
    if (state.activeSessionId === value) return
    state.activeSessionId = value
    queueDesktopStateWrite()
  })
  ipcMain.handle(DESKTOP_UPDATE_GET_STATE_CHANNEL, (event): DesktopUpdateState => {
    return isTrustedRenderer(event.sender) ? updateState : unsupportedUpdateState('Untrusted renderer.')
  })
  ipcMain.handle(DESKTOP_UPDATE_CHECK_CHANNEL, async (event): Promise<DesktopUpdateActionResult> => {
    if (!isTrustedRenderer(event.sender)) return { ok: false, error: 'Untrusted renderer.' }
    return await checkForDesktopUpdates()
  })
  ipcMain.handle(DESKTOP_UPDATE_DOWNLOAD_CHANNEL, async (event): Promise<DesktopUpdateActionResult> => {
    if (!isTrustedRenderer(event.sender)) return { ok: false, error: 'Untrusted renderer.' }
    return await downloadDesktopUpdate()
  })
  ipcMain.on(DESKTOP_UPDATE_INSTALL_CHANNEL, (event) => {
    if (!isTrustedRenderer(event.sender) || updateState.phase !== 'downloaded') return
    if (!desktopUpdatesSupported()) {
      void shell.openExternal(RELEASES_URL)
      return
    }
    void installDesktopUpdate()
  })
  ipcMain.handle(DESKTOP_UPDATE_OPEN_RELEASES_CHANNEL, async (event): Promise<DesktopUpdateActionResult> => {
    if (!isTrustedRenderer(event.sender)) return { ok: false, error: 'Untrusted renderer.' }
    try {
      await shell.openExternal(RELEASES_URL)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errorText(error) }
    }
  })
  ipcMain.handle(DESKTOP_SHELL_GET_STATE_CHANNEL, (event): DesktopShellState | { accelerator: string; acceleratorLabel: string; recents: [] } => {
    return isTrustedRenderer(event.sender)
      ? currentShellState()
      : { accelerator: DEFAULT_SHOW_WINDOW_ACCELERATOR, acceleratorLabel: formatAcceleratorLabel(DEFAULT_SHOW_WINDOW_ACCELERATOR), recents: [] }
  })
  ipcMain.handle(DESKTOP_SHELL_SET_ACCELERATOR_CHANNEL, (event, value: unknown): DesktopUpdateActionResult => {
    if (!isTrustedRenderer(event.sender)) return { ok: false, error: 'Untrusted renderer.' }
    if (typeof value !== 'string') return { ok: false, error: 'Invalid shortcut.' }
    return setShowWindowAccelerator(value)
  })
  ipcMain.on(DESKTOP_SHELL_REMEMBER_WORKSPACE_CHANNEL, (event, value: unknown) => {
    if (!isTrustedRenderer(event.sender)) return
    const request = parseRememberWorkspaceRequest(value)
    if (request !== undefined) rememberWorkspace(request)
  })
  ipcMain.on(DESKTOP_SHELL_CLEAR_RECENTS_CHANNEL, (event) => {
    if (isTrustedRenderer(event.sender)) clearRecentWorkspaces()
  })
  ipcMain.handle(DESKTOP_PTY_CREATE_CHANNEL, (event, value: unknown) => {
    if (!isTrustedRenderer(event.sender)) return { ok: false, error: 'Untrusted renderer.' }
    const request = parsePtyCreateRequest(value)
    if (request === undefined) return { ok: false, error: 'Invalid terminal request.' }
    const sender = event.sender
    return ptyHost.create(
      request,
      (id, data) => { if (!sender.isDestroyed()) sender.send(DESKTOP_PTY_DATA_CHANNEL, { id, data }) },
      (id) => { if (!sender.isDestroyed()) sender.send(DESKTOP_PTY_EXIT_CHANNEL, { id }) },
    )
  })
  ipcMain.on(DESKTOP_PTY_WRITE_CHANNEL, (event, value: unknown) => {
    if (!isTrustedRenderer(event.sender)) return
    const request = parsePtyWriteRequest(value)
    if (request !== undefined) ptyHost.write(request)
  })
  ipcMain.on(DESKTOP_PTY_RESIZE_CHANNEL, (event, value: unknown) => {
    if (!isTrustedRenderer(event.sender)) return
    const request = parsePtyResizeRequest(value)
    if (request !== undefined) ptyHost.resize(request)
  })
  ipcMain.on(DESKTOP_PTY_KILL_CHANNEL, (event, value: unknown) => {
    if (!isTrustedRenderer(event.sender)) return
    const request = parsePtyKillRequest(value)
    if (request !== undefined) ptyHost.kill(request)
  })
}

/** Register updater events and schedule quiet periodic checks for packaged apps. */
function installDesktopUpdater(): void {
  if (!desktopUpdatesSupported()) {
    updateState = initialUpdateState()
    return
  }
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = app.getVersion().includes('-')
  autoUpdater.on('checking-for-update', () => {
    setUpdateState({ phase: 'checking', message: '正在检查 GitHub Releases…' })
  })
  autoUpdater.on('update-available', (info) => {
    setUpdateState({ phase: 'available', availableVersion: info.version, checkedAt: Date.now() })
  })
  autoUpdater.on('update-not-available', () => {
    setUpdateState({ phase: 'not-available', checkedAt: Date.now() })
  })
  autoUpdater.on('download-progress', (progress) => {
    setUpdateState({
      phase: 'downloading',
      ...optionalAvailableVersion(updateState.availableVersion),
      progressPercent: Math.max(0, Math.min(100, progress.percent)),
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    setUpdateState({ phase: 'downloaded', availableVersion: info.version, progressPercent: 100 })
  })
  autoUpdater.on('error', (error) => {
    setUpdateState({
      phase: 'error',
      ...optionalAvailableVersion(updateState.availableVersion),
      message: errorText(error),
      checkedAt: Date.now(),
    })
  })

  const firstCheck = setTimeout(() => { void checkForDesktopUpdates() }, 15_000)
  firstCheck.unref()
  const repeatedChecks = setInterval(() => { void checkForDesktopUpdates() }, UPDATE_CHECK_INTERVAL_MS)
  repeatedChecks.unref()
}

async function checkForDesktopUpdates(): Promise<DesktopUpdateActionResult> {
  if (!desktopUpdatesSupported()) return { ok: false, error: updateState.message ?? 'Updates are unavailable.' }
  if (updateState.phase === 'checking' || updateState.phase === 'downloading' || updateState.phase === 'downloaded') {
    return { ok: false, error: 'An update operation is already running.' }
  }
  try {
    setUpdateState({ phase: 'checking', message: '正在检查 GitHub Releases…' })
    await autoUpdater.checkForUpdates()
    return { ok: true }
  } catch (error) {
    const message = errorText(error)
    setUpdateState({ phase: 'error', message, checkedAt: Date.now() })
    return { ok: false, error: message }
  }
}

async function downloadDesktopUpdate(): Promise<DesktopUpdateActionResult> {
  if (updateState.phase !== 'available') return { ok: false, error: 'No downloadable update is available.' }
  const availableVersion = updateState.availableVersion
  try {
    setUpdateState({ phase: 'downloading', ...optionalAvailableVersion(availableVersion), progressPercent: 0 })
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (error) {
    const message = errorText(error)
    setUpdateState({ phase: 'error', ...optionalAvailableVersion(availableVersion), message })
    return { ok: false, error: message }
  }
}

async function installDesktopUpdate(): Promise<void> {
  // Unsigned / adhoc macOS builds cannot be replaced by Squirrel.Mac; opening
  // Releases avoids the white-screen path where quitAndInstall leaves a live
  // window after the update helper fails.
  if (!desktopUpdatesSupported()) {
    setUpdateState(initialUpdateState())
    try { await shell.openExternal(RELEASES_URL) } catch { /* ignore */ }
    return
  }
  state.quitting = true
  try {
    autoUpdater.quitAndInstall(false, true)
  } catch (error) {
    state.quitting = false
    setUpdateState({
      phase: 'error',
      ...optionalAvailableVersion(updateState.availableVersion),
      message: errorText(error),
    })
    try { await shell.openExternal(RELEASES_URL) } catch { /* ignore */ }
    return
  }
  // If Squirrel does not exit the process, roll back so the UI stays usable.
  setTimeout(() => {
    if (!state.quitting) return
    state.quitting = false
    setUpdateState({
      phase: 'error',
      ...optionalAvailableVersion(updateState.availableVersion),
      message: '自动安装未完成。请从 GitHub Releases 下载 DMG，拖到「应用程序」后重新打开。',
      checkedAt: Date.now(),
    })
    showWindow()
    void shell.openExternal(RELEASES_URL)
  }, 4_000).unref()
}

function desktopUpdatesSupported(): boolean {
  return packagedUpdateUnavailableReason(updateInstallSnapshot()) === undefined
}

function initialUpdateState(): DesktopUpdateState {
  const unavailable = packagedUpdateUnavailableReason(updateInstallSnapshot())
  if (unavailable !== undefined) return unsupportedUpdateState(unavailable)
  return { phase: 'idle', currentVersion: app.getVersion() }
}

function updateInstallSnapshot(): {
  packaged: boolean
  platform: NodeJS.Platform
  appImage: boolean
  hasUpdateConfig: boolean
  properlySigned: boolean
} {
  return {
    packaged: app.isPackaged,
    platform: process.platform,
    appImage: Boolean(process.env.APPIMAGE),
    hasUpdateConfig: existsSync(join(process.resourcesPath, 'app-update.yml')),
    properlySigned: process.platform !== 'darwin' || !app.isPackaged || macAppProperlySigned(process.execPath),
  }
}

function unsupportedUpdateState(message: string): DesktopUpdateState {
  return { phase: 'unsupported', currentVersion: app.getVersion(), message }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function optionalAvailableVersion(version: string | undefined): Pick<DesktopUpdateState, 'availableVersion'> | Record<never, never> {
  return version === undefined ? {} : { availableVersion: version }
}

interface SourceLocation { path: string; line?: number; column?: number }

/** Parse editor-style source locations without mistaking a Windows drive. */
function sourceLocation(value: string): SourceLocation {
  const trimmed = value.trim().replace(/^file:\/\//, '')
  const hashLocation = trimmed.match(/^(.*)#L\d+(?::\d+)?$/)
  if (hashLocation?.[1] !== undefined) {
    const numbers = trimmed.slice(hashLocation[1].length).match(/\d+/g) ?? []
    return {
      path: hashLocation[1],
      ...(numbers[0] === undefined ? {} : { line: Number(numbers[0]) }),
      ...(numbers[1] === undefined ? {} : { column: Number(numbers[1]) }),
    }
  }
  const colonLocation = trimmed.match(/^(.*?)(?::\d+){1,2}$/)
  if (colonLocation?.[1] === undefined) return { path: trimmed }
  const numbers = trimmed.slice(colonLocation[1].length).match(/\d+/g) ?? []
  return {
    path: colonLocation[1],
    ...(numbers[0] === undefined ? {} : { line: Number(numbers[0]) }),
    ...(numbers[1] === undefined ? {} : { column: Number(numbers[1]) }),
  }
}

/** Route a validated path to one native application. */
async function openLocalPath(
  localPath: string,
  directory: boolean,
  opener: DesktopFileOpener,
  line?: number,
  column?: number,
): Promise<DesktopOpenPathResult> {
  if (opener === 'vscode' || opener === 'cursor') {
    const scheme = opener === 'vscode' ? 'vscode' : 'cursor'
    const location = line === undefined ? '' : `:${String(line)}${column === undefined ? '' : `:${String(column)}`}`
    await shell.openExternal(`${scheme}://file${pathToFileURL(localPath).pathname}${location}`, { activate: true })
    return { ok: true }
  }
  if (opener === 'finder') {
    if (!directory) {
      shell.showItemInFolder(localPath)
      return { ok: true }
    }
    const error = await shell.openPath(localPath)
    return error === '' ? { ok: true } : { ok: false, error }
  }
  if (opener === 'terminal') {
    await openTerminal(directory ? localPath : dirname(localPath))
    return { ok: true }
  }
  const error = await shell.openPath(localPath)
  return error === '' ? { ok: true } : { ok: false, error }
}

/** Launch the platform terminal in one validated working directory. */
async function openTerminal(directory: string): Promise<void> {
  const command = process.platform === 'darwin'
    ? { file: '/usr/bin/open', args: ['-a', 'Terminal', directory] }
    : process.platform === 'win32'
      ? { file: 'cmd.exe', args: ['/K', 'cd', '/d', directory] }
      : { file: 'x-terminal-emulator', args: [`--working-directory=${directory}`] }
  await new Promise<void>((resolveLaunch, rejectLaunch) => {
    const child = spawn(command.file, command.args, {
      cwd: directory,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.once('error', rejectLaunch)
    child.once('spawn', () => {
      child.unref()
      resolveLaunch()
    })
  })
}

function desktopStatePath(): string {
  return join(app.getPath('userData'), STATE_FILE_NAME)
}

async function readDesktopState(): Promise<void> {
  try {
    const parsed = parsePersistedDesktopState(JSON.parse(await readFile(desktopStatePath(), 'utf8')) as unknown)
    if (parsed.activeSessionId !== undefined) state.activeSessionId = parsed.activeSessionId
    if (parsed.showWindowAccelerator !== undefined) state.showWindowAccelerator = parsed.showWindowAccelerator
    if (parsed.recentWorkspaces !== undefined) state.recentWorkspaces = parsed.recentWorkspaces
  } catch {
    // First launch and malformed state both safely start without a restored session.
  }
}

function queueDesktopStateWrite(): void {
  const snapshot = parsePersistedDesktopState({
    ...(state.activeSessionId === undefined ? {} : { activeSessionId: state.activeSessionId }),
    showWindowAccelerator: state.showWindowAccelerator,
    recentWorkspaces: state.recentWorkspaces,
  })
  stateWriteQueue = stateWriteQueue.then(async () => {
    const path = desktopStatePath()
    const temporaryPath = `${path}.${process.pid}.tmp`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, path)
  }).catch((error: unknown) => {
    console.error('[desktop] could not persist desktop state:', error)
  })
}

void app.whenReady().then(async () => {
  if (!isPrimaryInstance) return
  nativeTheme.themeSource = 'system'
  const icon = getAppIcon()
  if (process.platform === 'darwin' && icon !== undefined) app.dock?.setIcon(icon)
  installIpc()
  installDesktopUpdater()
  await readDesktopState()
  installApplicationMenu()
  if (!installShowWindowShortcut() && state.showWindowAccelerator !== DEFAULT_SHOW_WINDOW_ACCELERATOR) {
    state.showWindowAccelerator = DEFAULT_SHOW_WINDOW_ACCELERATOR
    installShowWindowShortcut()
  }
  showBootSplash('正在启动…首次启用识图插件时可能需要几分钟准备运行时。')
  try {
    console.info('[desktop] booting embedded web tree…')
    const { ctx, url } = await bootDesktopTree((code) => { void disposeAndQuit(code) })
    state.ctx = ctx
    state.url = url
    console.info(`[desktop] web tree ready: ${url}`)
  } catch (error) {
    dismissBootSplash()
    console.error(error)
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('Dsh Desktop 无法启动', message)
    app.exit(1)
    return
  }
  showWindow()
  await createTray()
  if (process.platform === 'darwin') {
    app.dock?.setMenu(Menu.buildFromTemplate(recentWorkspaceMenuItems()))
  }
  nativeTheme.on('updated', () => { sendTheme() })
})

app.on('second-instance', () => {
  showWindow()
})

// macOS: a dock click with no open window reopens one.
app.on('activate', () => {
  showWindow()
})

app.on('window-all-closed', () => {
  if (state.tray !== undefined || process.platform === 'darwin') return
  void disposeAndQuit(0)
})

app.on('before-quit', (event) => {
  if (state.quitting) return
  event.preventDefault()
  void disposeAndQuit(0)
})
