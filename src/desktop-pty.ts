// Author: Zihan Wang
// <wangzh011031@163.com>
/** Trusted-renderer PTY helpers for the in-app terminal dock. */

import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { isLocalPath, MAX_LOCAL_PATH_LENGTH } from './desktop-ipc.ts'

const require = createRequire(import.meta.url)
const pty = require('node-pty') as typeof import('node-pty')

const MAX_PTY_WRITE = 16_384
const MAX_PTY_ID_LENGTH = 64
const MIN_COLS = 20
const MAX_COLS = 400
const MIN_ROWS = 8
const MAX_ROWS = 120
export const MAX_PTY_SESSIONS = 8

export interface PtyCreateRequest {
  cwd?: string
  cols: number
  rows: number
}

export interface PtyWriteRequest {
  id: string
  data: string
}

export interface PtyResizeRequest {
  id: string
  cols: number
  rows: number
}

export interface PtyKillRequest {
  id: string
}

export type PtyCreateResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

interface LivePty {
  id: string
  process: import('node-pty').IPty
}

/** Parse a renderer create request into bounded cols/rows and an optional cwd. */
export function parsePtyCreateRequest(value: unknown): PtyCreateRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  const cols = asSize(candidate.cols, MIN_COLS, MAX_COLS)
  const rows = asSize(candidate.rows, MIN_ROWS, MAX_ROWS)
  if (cols === undefined || rows === undefined) return undefined
  if (candidate.cwd === undefined) return { cols, rows }
  if (!isLocalPath(candidate.cwd)) return undefined
  const cwd = resolve(candidate.cwd.trim())
  if (cwd.length > MAX_LOCAL_PATH_LENGTH) return undefined
  return { cwd, cols, rows }
}

/** Parse a renderer write request. */
export function parsePtyWriteRequest(value: unknown): PtyWriteRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (!isPtyId(candidate.id) || typeof candidate.data !== 'string') return undefined
  if (candidate.data.length === 0 || candidate.data.length > MAX_PTY_WRITE) return undefined
  return { id: candidate.id, data: candidate.data }
}

/** Parse a renderer resize request. */
export function parsePtyResizeRequest(value: unknown): PtyResizeRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  const cols = asSize(candidate.cols, MIN_COLS, MAX_COLS)
  const rows = asSize(candidate.rows, MIN_ROWS, MAX_ROWS)
  if (!isPtyId(candidate.id) || cols === undefined || rows === undefined) return undefined
  return { id: candidate.id, cols, rows }
}

/** Parse a renderer kill request. */
export function parsePtyKillRequest(value: unknown): PtyKillRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  return isPtyId(candidate.id) ? { id: candidate.id } : undefined
}

export function isPtyId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_PTY_ID_LENGTH
    && /^[A-Za-z0-9_-]+$/.test(value)
}

/** Multi-session PTY host owned by the Electron main process. */
export class DesktopPtyHost {
  private readonly sessions = new Map<string, LivePty>()
  private ticket = 0

  create(request: PtyCreateRequest, onData: (id: string, data: string) => void, onExit: (id: string) => void): PtyCreateResult {
    if (this.sessions.size >= MAX_PTY_SESSIONS) return { ok: false, error: '终端数量已达上限。' }
    const cwd = request.cwd === undefined || request.cwd.trim() === '' ? homedir() : resolve(request.cwd)
    if (!isAbsolute(cwd)) return { ok: false, error: 'Invalid working directory.' }
    const id = `pty-${String(++this.ticket)}`
    try {
      const child = pty.spawn(loginShell(), [], {
        name: 'xterm-256color',
        cols: request.cols,
        rows: request.rows,
        cwd,
        env: processEnv(),
      })
      this.sessions.set(id, { id, process: child })
      child.onData((data) => {
        if (this.sessions.has(id)) onData(id, data)
      })
      child.onExit(() => {
        this.sessions.delete(id)
        onExit(id)
      })
      return { ok: true, id }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  write(request: PtyWriteRequest): void {
    this.sessions.get(request.id)?.process.write(request.data)
  }

  resize(request: PtyResizeRequest): void {
    this.sessions.get(request.id)?.process.resize(request.cols, request.rows)
  }

  kill(request: PtyKillRequest): void {
    this.disposeOne(request.id)
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.disposeOne(id)
  }

  private disposeOne(id: string): void {
    const current = this.sessions.get(id)
    this.sessions.delete(id)
    try {
      current?.process.kill()
    } catch {
      // A already-exited PTY is not an error for teardown.
    }
  }
}

function asSize(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return undefined
  return value
}

function loginShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC ?? 'powershell.exe'
  const shell = process.env.SHELL
  return shell !== undefined && shell.length > 0 ? shell : '/bin/zsh'
}

function processEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  return env
}
