// Author: Zihan Wang
// <wangzh011031@163.com>
/** Serve GET/POST `/api/desktop/vision-engine` for ~/.modlens/config.json. */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  applyVisionPatch,
  modlensConfigPath,
  parseModlensFile,
  parseVisionPatch,
  toPublicView,
} from './vision-engine.ts'

export const name = 'desktop-vision-engine'
export const inject = ['webServer']

const MAX_BODY_BYTES = 8 * 1024

/** Read and update the shared ModLens engine file. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/desktop/vision-engine',
    handler: (req: IncomingMessage, res: ServerResponse): void | Promise<void> => {
      if (req.method === 'GET') {
        writeJson(res, 200, { ok: true, ...toPublicView(readConfig()) })
        return
      }
      if (req.method === 'POST') {
        return handlePost(req, res)
      }
      res.writeHead(405)
      res.end()
    },
  }), 'desktop-vision-engine:route')
}

async function handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let raw: string
  try {
    raw = await readBody(req)
  } catch {
    writeJson(res, 413, { ok: false, error: '请求过大。' })
    return
  }
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    writeJson(res, 400, { ok: false, error: '不是 JSON。' })
    return
  }
  const patch = parseVisionPatch(value)
  if (patch === undefined) {
    writeJson(res, 400, { ok: false, error: '识图配置无效。' })
    return
  }
  const next = applyVisionPatch(readConfig(), patch)
  try {
    writeConfig(next)
  } catch {
    writeJson(res, 500, { ok: false, error: '无法写入识图配置。' })
    return
  }
  writeJson(res, 200, { ok: true, ...toPublicView(next) })
}

function readConfig(): Record<string, unknown> {
  const path = modlensConfigPath()
  if (!existsSync(path)) return {}
  try {
    return parseModlensFile(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

function writeConfig(config: Record<string, unknown>): void {
  const path = modlensConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // Windows ignores POSIX modes.
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
  })
  res.end(payload)
}
