/**
 * Usage host plugin — serves the model pricing table and a cross-session
 * usage summary. The summary inspects the persistence service rather than the
 * physical JSONL/Zstandard layout, so it works with every persistence backend.
 * @module @deepseek-ai/dsh-desktop/host/usage
 */

import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: ctx.webServer type augmentation.
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  aggregateUsage,
  type ModelPricing,
  type UsageSessionHeader,
  type UsageSessionInspection,
  type UsageSummary,
} from './usage-aggregate.ts'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  DEFAULT_USAGE_BUDGET,
  parseUsageBudget,
  usageBudgetNotificationKey,
  usageBudgetStatus,
  type UsageBudgetConfig,
} from './usage-budget.ts'

export type { ModelPricing } from './usage-aggregate.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-usage'

/** Services required before the usage surface can mount. */
export const inject = ['webServer', 'sessions', 'sessionPersistence']

export const USAGE_BUDGET_FILE_NAME = 'dsh-desktop-usage-budget.json'

interface PersistedBudget {
  config: UsageBudgetConfig
  lastNotificationKey?: string
}

/**
 * Per-million-token price in USD of one model. Cache-hit input is billed below
 * cache-miss input, so it owns a bucket of its own; cache-write and output
 * ride their card rates. Mirrors the DeepSeek API rate card.
 */
/**
 * Built-in rate card for the models the desktop shell targets. pi-ai's catalog
 * carries cost metadata the harness deliberately never reads (see
 * dsh-llm-pi-ai/src/catalog.ts), so this is a plain constant keyed by model
 * id; entries exist only for models the readout can actually meet.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'deepseek-chat': {
    inputPerMToken: 0.27,
    cacheReadPerMToken: 0.07,
    cacheWritePerMToken: 0.27,
    outputPerMToken: 1.10,
  },
  'deepseek-reasoner': {
    inputPerMToken: 0.55,
    cacheReadPerMToken: 0.14,
    cacheWritePerMToken: 0.55,
    outputPerMToken: 2.19,
  },
  // Harness-facing model ids share the desktop rate classes above. Keeping
  // aliases explicit lets model aggregation retain its real model label.
  'deepseek-v4-flash': {
    inputPerMToken: 0.27,
    cacheReadPerMToken: 0.07,
    cacheWritePerMToken: 0.27,
    outputPerMToken: 1.10,
  },
  'deepseek-v4-pro': {
    inputPerMToken: 0.55,
    cacheReadPerMToken: 0.14,
    cacheWritePerMToken: 0.55,
    outputPerMToken: 2.19,
  },
}

/** The model the client readout prices against when a session records no model. */
export const DEFAULT_MODEL = 'deepseek-chat'

/** Pricing route response body: one rate card plus the default model id. */
export interface PricingResponse {
  currency: 'USD'
  defaultModel: string
  models: Record<string, ModelPricing>
}

/** Structural persistence surface used without importing a transitive package. */
interface SessionPersistenceService {
  list(): Promise<UsageSessionHeader[]>
  inspect(id: string): Promise<UsageSessionInspection>
}

/** Structural live-session surface merged with persistence metadata. */
interface SessionStoreService {
  list(): Array<{ header: UsageSessionHeader }>
}

/** Cordis context plus the two services declared in this plugin's inject list. */
type UsageHostContext = Context & {
  sessionPersistence: SessionPersistenceService
  sessions: SessionStoreService
}

/** Serialize one JSON route response. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * Mount the usage host surface: the pricing route the client readout consumes.
 * @param ctx - plugin context carrying the webServer service.
 */
export function apply(ctx: Context): void {
  const server = ctx.webServer
  const usageCtx = ctx as UsageHostContext
  const budgetPath = join(resolveDshHome(), USAGE_BUDGET_FILE_NAME)
  let budget = readBudget(budgetPath)
  let budgetWriteQueue: Promise<void> = Promise.resolve()
  const persistBudget = (next: PersistedBudget): Promise<void> => {
    const queued = budgetWriteQueue.then(async () => {
      await mkdir(dirname(budgetPath), { recursive: true })
      await writeFile(budgetPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    })
    budgetWriteQueue = queued.catch(() => {})
    return queued
  }
  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/desktop/usage/pricing',
    handler: (_req, res) => {
      const body: PricingResponse = {
        currency: 'USD',
        defaultModel: DEFAULT_MODEL,
        models: MODEL_PRICING,
      }
      sendJson(res, 200, body)
    },
  }), 'desktop-usage:pricing')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/desktop/usage/summary',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      try {
        sendJson(res, 200, await buildUsageSummary(usageCtx))
      } catch (error) {
        ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        sendJson(res, 500, { error: 'Unable to read session usage.' })
      }
    },
  }), 'desktop-usage:summary')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/desktop/usage/budget',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'GET') {
        sendJson(res, 200, budget.config)
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      const value = await readJsonBody(req)
      const config = parseUsageBudget(value)
      if (config === undefined) {
        sendJson(res, 400, { error: 'Invalid usage budget.' })
        return
      }
      budget = { config }
      try {
        await persistBudget(budget)
        sendJson(res, 200, config)
      } catch (error) {
        ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        sendJson(res, 500, { error: 'Unable to save usage budget.' })
      }
    },
  }), 'desktop-usage:budget')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/desktop/usage/budget/check',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      try {
        const status = usageBudgetStatus(await buildUsageSummary(usageCtx), budget.config)
        const key = usageBudgetNotificationKey(budget.config, status)
        const notify = status.exceeded && budget.lastNotificationKey !== key
        if (notify) {
          budget = { ...budget, lastNotificationKey: key }
          await persistBudget(budget)
        }
        sendJson(res, 200, { config: budget.config, status, notify })
      } catch (error) {
        ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        sendJson(res, 500, { error: 'Unable to check usage budget.' })
      }
    },
  }), 'desktop-usage:budget-check')
}

function readBudget(path: string): PersistedBudget {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (typeof value !== 'object' || value === null) return { config: { ...DEFAULT_USAGE_BUDGET } }
    const record = value as Record<string, unknown>
    const config = parseUsageBudget(record.config)
    if (config === undefined) return { config: { ...DEFAULT_USAGE_BUDGET } }
    return {
      config,
      ...(typeof record.lastNotificationKey === 'string' ? { lastNotificationKey: record.lastNotificationKey } : {}),
    }
  } catch {
    return { config: { ...DEFAULT_USAGE_BUDGET } }
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

/** Build a fresh summary from every materialized and currently live session. */
export async function buildUsageSummary(ctx: UsageHostContext): Promise<UsageSummary> {
  const headers = new Map<string, UsageSessionHeader>()
  for (const header of await ctx.sessionPersistence.list()) headers.set(header.id, header)
  for (const session of ctx.sessions.list()) headers.set(session.header.id, session.header)

  const inspections: UsageSessionInspection[] = []
  let failedSessions = 0
  await mapWithConcurrency([...headers.values()], 6, async (header) => {
    try {
      inspections.push(await ctx.sessionPersistence.inspect(header.id))
    } catch (error) {
      failedSessions += 1
      ctx.logger.warn(`desktop usage: failed to inspect ${header.id}: ${String(error)}`)
    }
  })
  return aggregateUsage(inspections, MODEL_PRICING, DEFAULT_MODEL, failedSessions)
}

/** Bound parallel log reads so a large history does not saturate the disk. */
async function mapWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  visit: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      const value = values[index]
      if (value !== undefined) await visit(value)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
}
