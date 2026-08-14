/**
 * Per-session usage readout: durable token counts plus an estimated USD cost
 * derived from the host pricing table. Mounted in the session header action
 * row; reads the `tokenUsage` projection the same way ui-conversation's
 * StatsLine does.
 * @module @dsh-desktop/client/usage/UsageReadout
 */

import { memo, useEffect, useState } from 'react'
import type { UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: loads the SessionProjectionMap interface this file augments.
import type {} from '@deepseek-ai/dsh-session-projection/types'

/**
 * Durable cumulative provider usage for a complete session log. Mirror of
 * @deepseek-ai/dsh-token-meter's TokenUsageProjection; declared here so the
 * `tokenUsage` SessionProjectionMap key resolves without depending on that
 * package's published type graph (its client.d.ts re-exports through a
 * `.ts`-suffixed specifier).
 */
export interface TokenUsageProjection {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Provider-reported usage accumulated across the complete durable log. */
    tokenUsage: TokenUsageProjection
  }
}

/** Per-million-token price (USD) of one model; mirrors the host pricing route. */
interface ModelPricing {
  inputPerMToken: number
  cacheReadPerMToken: number
  cacheWritePerMToken: number
  outputPerMToken: number
}

/** The host /api/desktop/usage/pricing response body. */
interface PricingResponse {
  currency: string
  defaultModel: string
  models: Record<string, ModelPricing>
}

/** Fallback model priced when the rate card names no default. */
const FALLBACK_MODEL = 'deepseek-chat'

/** Module-level rate-card cache: the price table is static for the app lifetime. */
let pricingCache: Promise<PricingResponse> | undefined

/**
 * Fetch the host pricing table once. A rejected fetch clears the cache so a
 * later session remount retries instead of pinning the failure.
 */
function loadPricing(): Promise<PricingResponse> {
  pricingCache ??= fetch('/api/desktop/usage/pricing').then(
    (res) => {
      if (!res.ok) throw new Error(`usage pricing route answered ${String(res.status)}`)
      return res.json() as Promise<PricingResponse>
    },
    (reason: unknown) => {
      pricingCache = undefined
      throw reason
    },
  )
  return pricingCache
}

/** Sum the three disjoint prompt-side billing buckets. */
function billedInputTokens(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** Compact token count: 517 / 12.2K / 517K / 1.2M. */
function formatTokens(n: number): string {
  const scaled = (v: number): string => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/** USD estimate with 2-4 significant decimals; zero renders as $0.00. */
function formatCost(cost: number): string {
  if (cost === 0) return '$0.00'
  const digits = cost < 0.01 ? 4 : cost < 1 ? 3 : 2
  return `$${cost.toFixed(digits)}`
}

/** Price one session's durable token usage against one model's rate card. */
function estimateCost(usage: TokenUsageProjection, price: ModelPricing): number {
  const m = 1_000_000
  return usage.uncachedInputTokens / m * price.inputPerMToken
    + usage.cacheReadTokens / m * price.cacheReadPerMToken
    + usage.cacheWriteTokens / m * price.cacheWritePerMToken
    + usage.outputTokens / m * price.outputPerMToken
}

/** Props: the framework session-kit subset this readout consumes. */
export interface UsageReadoutProps {
  /** Key-addressed projection reader (tokenUsage rides the session standard kit). */
  useProjection: UseProjection
}

/**
 * Readout of the current session's token usage and estimated cost.
 * @param props - the projection reader.
 * @returns the readout span, or null while usage or the rate card is absent.
 */
export const UsageReadout = memo(function UsageReadout({
  useProjection,
}: UsageReadoutProps): JSX.Element | null {
  const usage = useProjection('tokenUsage')
  const [pricing, setPricing] = useState<PricingResponse | undefined>(undefined)
  useEffect(() => {
    let live = true
    loadPricing()
      .then((table) => { if (live) setPricing(table) })
      .catch(() => { /* rate card unavailable: cost stays hidden, tokens still show */ })
    return () => { live = false }
  }, [])
  if (usage === undefined || pricing === undefined) return null
  const price = pricing.models[pricing.defaultModel] ?? pricing.models[FALLBACK_MODEL]
  if (price === undefined) return null
  const input = billedInputTokens(usage)
  const output = usage.outputTokens
  if (input === 0 && output === 0) return null
  const cost = estimateCost(usage, price)
  const detail = `tokens: ${String(input)} in / ${String(output)} out · est. cost: ${formatCost(cost)} ${pricing.currency}`
  return (
    <span title={detail}>
      {formatTokens(input)} in · {formatTokens(output)} out · {formatCost(cost)}
    </span>
  )
})
