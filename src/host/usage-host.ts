/**
 * Usage host plugin — serves the model pricing table the client session
 * readout fetches to estimate per-session token cost. The readout itself rides
 * the durable `tokenUsage` projection on the client, so the host surface stays
 * a single static rate card; no session state crosses this boundary.
 * @module @deepseek-ai/dsh-desktop/host/usage
 */

import type { ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: ctx.webServer type augmentation.
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'desktop-usage'

/** Services required before the usage surface can mount. */
export const inject = ['webServer']

/**
 * Per-million-token price in USD of one model. Cache-hit input is billed below
 * cache-miss input, so it owns a bucket of its own; cache-write and output
 * ride their card rates. Mirrors the DeepSeek API rate card.
 */
export interface ModelPricing {
  /** USD per 1M cache-miss input tokens. */
  inputPerMToken: number
  /** USD per 1M cache-hit input tokens. */
  cacheReadPerMToken: number
  /** USD per 1M cache-write input tokens. */
  cacheWritePerMToken: number
  /** USD per 1M output tokens. */
  outputPerMToken: number
}

/**
 * Built-in rate card for the models the desktop shell targets. pi-ai's catalog
 * carries cost metadata the harness deliberately never reads (see
 * dsh-llm-pi-ai/src/catalog.ts), so this is a plain constant keyed by model
 * id; entries exist only for models the readout can actually meet.
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
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
}

/** The model the client readout prices against when a session records no model. */
export const DEFAULT_MODEL = 'deepseek-chat'

/** Pricing route response body: one rate card plus the default model id. */
export interface PricingResponse {
  currency: 'USD'
  defaultModel: string
  models: Record<string, ModelPricing>
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
}
