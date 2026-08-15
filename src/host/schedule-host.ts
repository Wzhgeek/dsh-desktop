/** Desktop schedule management over dsh's durable session schedule log. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  ScheduleId,
  ScheduleInputError,
  ScheduleLogError,
  allocateScheduleId,
  createAfterScheduleRecord,
  createAtScheduleRecord,
  createEveryScheduleRecord,
  foldScheduleEvents,
  scheduleView,
} from '@deepseek-ai/dsh-schedule'

export const name = 'desktop-schedule'
export const inject = ['webServer', 'sessions']

const MAX_BODY_BYTES = 32 * 1024

interface LiveScheduleSession {
  readonly events: Parameters<typeof foldScheduleEvents>[0]
  readonly header: { readonly seedLength?: number }
  append(type: string, data: unknown): unknown
}

interface ScheduleSessionStore {
  get(id: string): LiveScheduleSession | undefined
  flush(session: LiveScheduleSession): Promise<boolean>
}

type ScheduleHostContext = Context & { sessions: ScheduleSessionStore }

interface CreateRequest {
  action: 'create'
  sessionId: string
  prompt: string
  kind: 'after' | 'at' | 'every'
  value: number | string
}

interface DeleteRequest {
  action: 'delete'
  sessionId: string
  id: string
}

export function apply(ctx: Context): void {
  const host = ctx as ScheduleHostContext
  const queues = new Map<string, Promise<unknown>>()
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/desktop/schedules',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (req.method === 'GET') {
          const sessionId = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('sessionId') ?? ''
          const session = resolveSession(host, sessionId)
          if (session === undefined) {
            sendJson(res, 404, { ok: false, error: 'Session is not active.' })
            return
          }
          await host.sessions.flush(session)
          sendJson(res, 200, { ok: true, items: activeScheduleViews(session) })
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }
        const body = parseRequest(await readJsonBody(req))
        if (body === undefined) {
          sendJson(res, 400, { ok: false, error: 'Invalid schedule request.' })
          return
        }
        const result = await runExclusive(queues, body.sessionId, async () => {
          const session = resolveSession(host, body.sessionId)
          if (session === undefined) return { status: 404, body: { ok: false, error: 'Session is not active.' } }
          await host.sessions.flush(session)
          const folded = foldScheduleEvents(session.events, session.header.seedLength ?? 0)
          if (body.action === 'delete') {
            const id = ScheduleId(body.id)
            if (!folded.active.some(record => record.id === id)) {
              return { status: 200, body: { ok: true, deleted: false, items: activeScheduleViews(session) } }
            }
            session.append('schedule/change', { version: 1, operation: 'delete', id })
            await host.sessions.flush(session)
            return { status: 200, body: { ok: true, deleted: true, items: activeScheduleViews(session) } }
          }
          const id = allocateScheduleId(folded)
          const now = Date.now()
          const record = body.kind === 'after'
            ? createAfterScheduleRecord(id, body.prompt, body.value as number, now)
            : body.kind === 'every'
              ? createEveryScheduleRecord(id, body.prompt, body.value as number, now)
              : createAtScheduleRecord(id, body.prompt, body.value as string, now)
          session.append('schedule/change', { version: 1, operation: 'create', schedule: record })
          await host.sessions.flush(session)
          return { status: 200, body: { ok: true, created: scheduleView(record, Date.now()), items: activeScheduleViews(session) } }
        })
        sendJson(res, result.status, result.body)
      } catch (error) {
        if (error instanceof ScheduleInputError) {
          sendJson(res, 400, { ok: false, code: error.code, error: error.message })
          return
        }
        if (error instanceof ScheduleLogError) {
          sendJson(res, 409, { ok: false, code: error.code, error: 'The session schedule log is corrupt.' })
          return
        }
        ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        sendJson(res, 500, { ok: false, error: 'Unable to update schedules.' })
      }
    },
  }), 'desktop-schedule:routes')
}

function resolveSession(ctx: ScheduleHostContext, sessionId: string): LiveScheduleSession | undefined {
  if (sessionId === '' || sessionId.length > 256) return undefined
  return ctx.sessions.get(sessionId)
}

function activeScheduleViews(session: LiveScheduleSession): ReturnType<typeof scheduleView>[] {
  const now = Date.now()
  return foldScheduleEvents(session.events, session.header.seedLength ?? 0).active.map(record => scheduleView(record, now))
}

function parseRequest(value: unknown): CreateRequest | DeleteRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const body = value as Record<string, unknown>
  if (typeof body.sessionId !== 'string' || body.sessionId === '' || body.sessionId.length > 256) return undefined
  if (body.action === 'delete') {
    if (typeof body.id !== 'string' || body.id === '' || body.id.trim() !== body.id) return undefined
    return { action: 'delete', sessionId: body.sessionId, id: body.id }
  }
  if (body.action !== 'create' || typeof body.prompt !== 'string' || body.prompt.trim() === '') return undefined
  if (body.kind === 'at' && typeof body.value === 'string') {
    return { action: 'create', sessionId: body.sessionId, prompt: body.prompt, kind: 'at', value: body.value }
  }
  if ((body.kind === 'after' || body.kind === 'every') && typeof body.value === 'number' && Number.isSafeInteger(body.value)) {
    return { action: 'create', sessionId: body.sessionId, prompt: body.prompt, kind: body.kind, value: body.value }
  }
  return undefined
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

function runExclusive<T>(queues: Map<string, Promise<unknown>>, key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(task)
  queues.set(key, current)
  void current.finally(() => {
    if (queues.get(key) === current) queues.delete(key)
  }).catch(() => {})
  return current
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
