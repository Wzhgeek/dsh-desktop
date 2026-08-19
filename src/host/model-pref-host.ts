// Author: Zihan Wang
// <wangzh011031@163.com>
/**
 * Default model preference surface — reads/writes the official
 * `ctx.agentDefaultModel` selection (backed by `$DSH_HOME/settings.yaml`
 * section `agent-default-model`). Selecting a model in the composer already
 * calls `saveSelection`; this endpoint exposes the same fact for the desktop
 * settings UI and blank-session restore.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  parseSelection,
  unwrapModlensSelection,
  type ModelPreference,
} from './model-pref.ts'

export const name = 'desktop-model-pref'
export const inject = ['webServer']
export type { ModelPreference }

const MAX_BODY_BYTES = 4 * 1024

interface AgentDefaultModelFace {
  currentSelection: () => ModelPreference
  saveSelection: (next: ModelPreference) => Promise<void>
}

/** Serve GET/POST `/api/desktop/model-preference`. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/desktop/model-preference',
    handler: (req: IncomingMessage, res: ServerResponse): void | Promise<void> => {
      const face = ctx.get('agentDefaultModel') as AgentDefaultModelFace | undefined
      if (face === undefined) {
        writeJson(res, 503, { ok: false, error: 'agentDefaultModel unavailable' })
        return
      }
      if (req.method === 'GET') {
        const current = face.currentSelection()
        const selection = unwrapModlensSelection(current)
        if (selection.provider !== current.provider) {
          void face.saveSelection(selection).catch(() => {})
        }
        writeJson(res, 200, { ok: true, selection })
        return
      }
      if (req.method === 'POST') {
        return handlePost(req, res, face)
      }
      res.writeHead(405)
      res.end()
    },
  }), 'desktop-model-pref:route')
}

async function handlePost(
  req: IncomingMessage,
  res: ServerResponse,
  face: AgentDefaultModelFace,
): Promise<void> {
  const body = await readBody(req)
  let value: unknown
  try {
    value = JSON.parse(body) as unknown
  } catch {
    writeJson(res, 400, { ok: false, error: 'body is not JSON' })
    return
  }
  const selection = parseSelection(value)
  if (selection === undefined) {
    writeJson(res, 400, { ok: false, error: 'invalid model preference' })
    return
  }
  try {
    await face.saveSelection(selection)
  } catch (error) {
    writeJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }
  writeJson(res, 200, { ok: true, selection: unwrapModlensSelection(face.currentSelection()) })
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
