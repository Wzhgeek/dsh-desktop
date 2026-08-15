/**
 * dsh-desktop main process — present the embedded dsh `web` tree in a native
 * window. Boots the tree through {@link bootDesktopTree}, then loads the SPA
 * from its loopback URL (see `boot.ts` for the same-origin rationale). The
 * tree is disposed on window close and application exit.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
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
import type { Context } from '@deepseek-ai/cordis'
import { bootDesktopTree } from './boot.ts'
import {
  DESKTOP_ACTIVE_SESSION_CHANNEL,
  DESKTOP_COMMAND_CHANNEL,
  DESKTOP_NOTIFICATION_CHANNEL,
  DESKTOP_OPEN_PATH_CHANNEL,
  DESKTOP_THEME_CHANNEL,
  isSessionId,
  parseNotification,
  parseOpenPathRequest,
} from './desktop-ipc.ts'
import type { DesktopCommandPayload, DesktopFileOpener, DesktopOpenPathResult, DesktopThemePayload } from './desktop-ipc.ts'

/** Booted tree plus the URL each created window loads. */
const state: {
  ctx: Context | undefined
  url: string | undefined
  win: BrowserWindow | undefined
  tray: Tray | undefined
  notifications: Set<Notification>
  quitting: boolean
  activeSessionId: string | undefined
} = {
  ctx: undefined,
  url: undefined,
  win: undefined,
  tray: undefined,
  notifications: new Set(),
  quitting: false,
  activeSessionId: undefined,
}

const PRELOAD_PATH = fileURLToPath(new URL('./preload.cjs', import.meta.url))
const APP_ICON_PATH = fileURLToPath(new URL('../resources/dsh-icon.png', import.meta.url))
const APP_NAME = 'Dsh Desktop'
const LEGACY_USER_DATA_NAME = '@deepseek-ai/dsh-desktop'
const STATE_FILE_NAME = 'dsh-desktop-state.json'
let disposePromise: Promise<void> | undefined
let stateWriteQueue: Promise<void> = Promise.resolve()
let cachedAppIcon: NativeImage | undefined

// Renaming must not strand Chromium storage and desktop state in a new folder.
const legacyUserDataPath = join(app.getPath('appData'), LEGACY_USER_DATA_NAME)
app.setName(APP_NAME)
app.setPath('userData', legacyUserDataPath)
app.setPath('sessionData', legacyUserDataPath)
process.title = APP_NAME

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
async function disposeAndQuit(code: number): Promise<void> {
  state.quitting = true
  disposePromise ??= (async () => {
    state.tray?.destroy()
    state.tray = undefined
    await stateWriteQueue
    await state.ctx?.fiber.dispose()
    app.exit(code)
  })()
  await disposePromise
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
    if (state.activeSessionId !== undefined) {
      sendCommand({ command: 'restore-session', sessionId: state.activeSessionId }, win)
    }
  })
  void win.loadURL(state.url)
  return win
}

/** Reveal the existing application window, recreating it only after destruction. */
function showWindow(): BrowserWindow | undefined {
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

/** Install native accelerators without claiming OS-global shortcuts. */
function installApplicationMenu(): void {
  const send = (command: 'command-palette' | 'new-session' | 'settings') => (): void => {
    sendCommand({ command })
  }
  const appMenu: MenuItemConstructorOptions = {
    label: APP_NAME,
    submenu: [
      { role: 'about' },
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
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'front' }] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Create the status item after ready so packaged builds inherit their app icon. */
async function createTray(): Promise<void> {
  try {
    const appIcon = getAppIcon() ?? await app.getFileIcon(process.execPath, { size: 'small' })
    const icon = appIcon.isEmpty() ? nativeImage.createEmpty() : appIcon.resize({ width: 18, height: 18 })
    if (process.platform === 'darwin') icon.setTemplateImage(true)
    const tray = new Tray(icon)
    state.tray = tray
    tray.setToolTip(APP_NAME)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示', click: () => { showWindow() } },
      { type: 'separator' },
      { label: '退出', click: () => { void disposeAndQuit(0) } },
    ]))
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

interface PersistedDesktopState { activeSessionId?: string }

function desktopStatePath(): string {
  return join(app.getPath('userData'), STATE_FILE_NAME)
}

async function readDesktopState(): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(desktopStatePath(), 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null) return
    const activeSessionId = (parsed as Record<string, unknown>).activeSessionId
    if (isSessionId(activeSessionId)) state.activeSessionId = activeSessionId
  } catch {
    // First launch and malformed state both safely start without a restored session.
  }
}

function queueDesktopStateWrite(): void {
  const snapshot: PersistedDesktopState = state.activeSessionId === undefined ? {} : { activeSessionId: state.activeSessionId }
  stateWriteQueue = stateWriteQueue.then(async () => {
    const path = desktopStatePath()
    const temporaryPath = `${path}.${process.pid}.tmp`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, path)
  }).catch((error: unknown) => {
    console.error('[desktop] could not persist active session:', error)
  })
}

void app.whenReady().then(async () => {
  nativeTheme.themeSource = 'system'
  const icon = getAppIcon()
  if (process.platform === 'darwin' && icon !== undefined) app.dock?.setIcon(icon)
  installIpc()
  installApplicationMenu()
  await readDesktopState()
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
  await createTray()
  nativeTheme.on('updated', () => { sendTheme() })
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
