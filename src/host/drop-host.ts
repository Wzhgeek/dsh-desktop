// Author: Zihan Wang
// <wangzh011031@163.com>
/** Desktop drag-and-drop: classify paths and import files into the workspace inbox. */

import { existsSync } from 'node:fs'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, extname, join, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { resolveWorkspaceRoot } from './workspace-root.ts'
import {
  classifyDroppedPath,
  MAX_DROP_PATHS,
  MAX_INBOX_BYTES,
  type DropClassification,
} from './drop.ts'

export const name = 'desktop-drop'
export const inject = ['webServer']

const MAX_BODY_BYTES = 64 * 1024
const INBOX_DIR = '.dsh-inbox'

/** Serve drop classify / import endpoints. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/desktop/drop/classify',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      try {
        const body = await readJson(req)
        const items = await classifyPaths(body.paths)
        writeJson(res, 200, { ok: true, items })
      } catch (error) {
        ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        writeJson(res, 400, { ok: false, error: '无法识别拖入的文件。' })
      }
    },
  }), 'desktop-drop:classify')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/desktop/drop/import',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      try {
        const body = await readJson(req)
        const imported = await importDroppedFile(ctx, body)
        if (imported === undefined) {
          writeJson(res, 400, { ok: false, error: '无法把文件附到当前工作区。' })
          return
        }
        writeJson(res, 200, { ok: true, ...imported })
      } catch (error) {
        ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        writeJson(res, 500, { ok: false, error: '无法导入拖入的文件。' })
      }
    },
  }), 'desktop-drop:import')
}

async function classifyPaths(value: unknown): Promise<DropClassification[]> {
  if (!Array.isArray(value)) return []
  const items: DropClassification[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '' || entry.length > 4_096) continue
    const path = resolve(entry)
    try {
      items.push(classifyDroppedPath(path, (await stat(path)).isDirectory()))
    } catch {
      continue
    }
    if (items.length >= MAX_DROP_PATHS) break
  }
  return items
}

async function importDroppedFile(
  ctx: Context,
  body: Record<string, unknown>,
): Promise<{ path: string; relativePath: string } | undefined> {
  if (typeof body.path !== 'string' || typeof body.cwd !== 'string') return undefined
  const workspace = resolveWorkspaceRoot(ctx, body.cwd)
  if (!workspace.ok) return undefined
  const source = resolve(body.path)
  const info = await stat(source)
  if (!info.isFile() || info.size > MAX_INBOX_BYTES) return undefined
  const root = workspace.root
  if (inside(source, root)) {
    return { path: source, relativePath: toPosix(relative(root, source)) }
  }
  const inbox = join(root, INBOX_DIR)
  await mkdir(inbox, { recursive: true })
  const target = uniqueTarget(inbox, basename(source))
  await copyFile(source, target)
  return { path: target, relativePath: toPosix(relative(root, target)) }
}

function uniqueTarget(directory: string, fileName: string): string {
  const ext = extname(fileName)
  const stem = basename(fileName, ext)
  const first = join(directory, fileName)
  if (!existsSync(first)) return first
  return join(directory, `${stem}-${String(Date.now())}${ext}`)
}

function inside(path: string, root: string): boolean {
  const relativePath = relative(root, path)
  return relativePath !== '' && !relativePath.startsWith('..') && !relativePath.includes(':')
}

function toPosix(path: string): string {
  return path.split('\\').join('/')
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  return parsed as Record<string, unknown>
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`, 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
  })
  res.end(payload)
}
