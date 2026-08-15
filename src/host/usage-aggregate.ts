/**
 * Pure cross-session token and cost aggregation for the desktop Usage page.
 * The caller supplies immutable persisted session inspections; this module
 * knows nothing about Cordis or HTTP and is straightforward to test in
 * isolation.
 * @module @deepseek-ai/dsh-desktop/host/usage-aggregate
 */

/** Per-million-token desktop rate for one model. */
export interface ModelPricing {
  inputPerMToken: number
  cacheReadPerMToken: number
  cacheWritePerMToken: number
  outputPerMToken: number
}

/** Four disjoint billing buckets accumulated from provider usage reports. */
export interface UsageTokens {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** One row returned to the dashboard for a day, week, or model. */
export interface UsageBucket extends UsageTokens {
  key: string
  label: string
  sessions: number
  calls: number
  fallbackPricedCalls: number
  cost: number
  provider?: string
  model?: string
}

/** Aggregate totals across every inspected call. */
export interface UsageOverview extends UsageTokens {
  sessions: number
  calls: number
  fallbackPricedCalls: number
  cost: number
}

/** Full response body consumed by the desktop Usage settings page. */
export interface UsageSummary {
  currency: 'USD'
  generatedAt: number
  failedSessions: number
  overview: UsageOverview
  byDay: UsageBucket[]
  byWeek: UsageBucket[]
  byModel: UsageBucket[]
}

/** Immutable stored-session metadata needed to exclude inherited fork events. */
export interface UsageSessionHeader {
  id: string
  createdAt: number
  parentSession?: string
  seedLength?: number
}

/** Narrow structural view over a durable session event. */
export interface UsageSessionEvent {
  type: string
  time: number
  seq: number
  data: unknown
}

/** One immutable session inspection supplied by the persistence service. */
export interface UsageSessionInspection {
  meta: UsageSessionHeader
  events: readonly UsageSessionEvent[]
}

interface UsageCall {
  sessionId: string
  time: number
  provider: string
  model: string
  tokens: UsageTokens
}

interface MutableBucket extends UsageBucket {
  sessionIds: Set<string>
}

/** Default route used when old logs do not identify their model. */
const UNKNOWN_PROVIDER = 'unknown'

/** Convert a timestamp to a local calendar date key. */
export function dayKey(time: number): string {
  const date = new Date(time)
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Convert a timestamp to the local Monday that starts its calendar week. */
export function weekKey(time: number): string {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return dayKey(date.getTime())
}

/** Price one provider usage report against a per-million-token rate card. */
export function estimateUsageCost(tokens: UsageTokens, pricing: ModelPricing): number {
  const million = 1_000_000
  return tokens.uncachedInputTokens / million * pricing.inputPerMToken
    + tokens.cacheReadTokens / million * pricing.cacheReadPerMToken
    + tokens.cacheWriteTokens / million * pricing.cacheWritePerMToken
    + tokens.outputTokens / million * pricing.outputPerMToken
}

/**
 * Aggregate stored sessions into daily, weekly, and model cuts.
 * @param sessions - immutable session inspections from the persistence seam.
 * @param pricing - rate card keyed by model id.
 * @param fallbackModel - pricing entry used for legacy or unknown model ids.
 * @param failedSessions - sessions that could not be inspected.
 */
export function aggregateUsage(
  sessions: readonly UsageSessionInspection[],
  pricing: Readonly<Record<string, ModelPricing>>,
  fallbackModel: string,
  failedSessions = 0,
): UsageSummary {
  const calls = sessions.flatMap(extractCalls)
  const byDay = new Map<string, MutableBucket>()
  const byWeek = new Map<string, MutableBucket>()
  const byModel = new Map<string, MutableBucket>()
  const overview = emptyOverview()
  const overviewSessions = new Set<string>()

  for (const call of calls) {
    const selectedPricing = pricing[call.model] ?? pricing[fallbackModel]
    if (selectedPricing === undefined) continue
    const usedFallback = pricing[call.model] === undefined
    const cost = estimateUsageCost(call.tokens, selectedPricing)
    addOverview(overview, overviewSessions, call, cost, usedFallback)
    addBucket(byDay, dayKey(call.time), dayKey(call.time), call, cost, usedFallback)
    addBucket(byWeek, weekKey(call.time), weekKey(call.time), call, cost, usedFallback)
    const modelKey = `${call.provider}:${call.model}`
    addBucket(byModel, modelKey, call.model, call, cost, usedFallback, call.provider, call.model)
  }

  overview.sessions = overviewSessions.size
  return {
    currency: 'USD',
    generatedAt: Date.now(),
    failedSessions,
    overview,
    byDay: finalizeBuckets(byDay, (a, b) => a.key.localeCompare(b.key)),
    byWeek: finalizeBuckets(byWeek, (a, b) => a.key.localeCompare(b.key)),
    byModel: finalizeBuckets(byModel, (a, b) => totalTokens(b) - totalTokens(a)),
  }
}

/** Read provider-reported call usage from one session without counting fork seed history. */
function extractCalls(session: UsageSessionInspection): UsageCall[] {
  const inherited = session.meta.parentSession === undefined ? 0 : session.meta.seedLength ?? 0
  const result: UsageCall[] = []
  let currentProvider = UNKNOWN_PROVIDER
  let currentModel = ''

  for (const event of session.events) {
    if (event.seq < inherited) continue
    const record = objectRecord(event.data)
    if (event.type === 'request/context') {
      currentProvider = stringValue(record?.provider) ?? currentProvider
      currentModel = stringValue(record?.model) ?? currentModel
      continue
    }
    if (event.type === 'request/header') {
      const header = objectRecord(record?.header)
      const config = objectRecord(header?.config)
      currentProvider = stringValue(config?.provider) ?? currentProvider
      currentModel = stringValue(config?.model) ?? currentModel
      continue
    }
    if (event.type !== 'assistant/message') continue
    const usage = parseUsage(record?.usage)
    if (usage === undefined) continue
    const message = objectRecord(record?.message)
    const source = objectRecord(message?.source)
    const provider = stringValue(source?.provider) ?? currentProvider
    const model = stringValue(source?.model) ?? currentModel
    result.push({
      sessionId: session.meta.id,
      time: event.time,
      provider,
      model,
      tokens: usage,
    })
  }
  return result
}

/** Narrow one unknown event usage payload to the four non-overlapping buckets. */
function parseUsage(value: unknown): UsageTokens | undefined {
  const record = objectRecord(value)
  if (record === undefined) return undefined
  const input = nonnegativeNumber(record.inputTokens)
  const output = nonnegativeNumber(record.outputTokens)
  if (input === undefined || output === undefined) return undefined
  return {
    uncachedInputTokens: input,
    outputTokens: output,
    cacheReadTokens: nonnegativeNumber(record.cacheReadTokens) ?? 0,
    cacheWriteTokens: nonnegativeNumber(record.cacheWriteTokens) ?? 0,
  }
}

/** Allocate a zeroed overview. */
function emptyOverview(): UsageOverview {
  return {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    sessions: 0,
    calls: 0,
    fallbackPricedCalls: 0,
    cost: 0,
  }
}

/** Add one call to the all-session total. */
function addOverview(
  overview: UsageOverview,
  sessions: Set<string>,
  call: UsageCall,
  cost: number,
  usedFallback: boolean,
): void {
  addTokens(overview, call.tokens)
  overview.calls += 1
  overview.cost += cost
  if (usedFallback) overview.fallbackPricedCalls += 1
  sessions.add(call.sessionId)
}

/** Add one call to a keyed aggregation bucket. */
function addBucket(
  buckets: Map<string, MutableBucket>,
  key: string,
  label: string,
  call: UsageCall,
  cost: number,
  usedFallback: boolean,
  provider?: string,
  model?: string,
): void {
  let bucket = buckets.get(key)
  if (bucket === undefined) {
    bucket = {
      key,
      label,
      sessions: 0,
      calls: 0,
      fallbackPricedCalls: 0,
      cost: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      sessionIds: new Set<string>(),
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
    }
    buckets.set(key, bucket)
  }
  addTokens(bucket, call.tokens)
  bucket.calls += 1
  bucket.cost += cost
  if (usedFallback) bucket.fallbackPricedCalls += 1
  bucket.sessionIds.add(call.sessionId)
}

/** Add token buckets in place. */
function addTokens(target: UsageTokens, value: UsageTokens): void {
  target.uncachedInputTokens += value.uncachedInputTokens
  target.outputTokens += value.outputTokens
  target.cacheReadTokens += value.cacheReadTokens
  target.cacheWriteTokens += value.cacheWriteTokens
}

/** Detach Sets and sort the serializable dashboard rows. */
function finalizeBuckets(
  buckets: Map<string, MutableBucket>,
  compare: (a: UsageBucket, b: UsageBucket) => number,
): UsageBucket[] {
  const result: UsageBucket[] = []
  for (const bucket of buckets.values()) {
    const { sessionIds, ...wire } = bucket
    wire.sessions = sessionIds.size
    result.push(wire)
  }
  return result.sort(compare)
}

/** Total reported tokens of a bucket, for model ranking. */
function totalTokens(value: UsageTokens): number {
  return value.uncachedInputTokens + value.cacheReadTokens + value.cacheWriteTokens + value.outputTokens
}

/** Object-only runtime narrowing for persisted JSON values. */
function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Non-empty string narrowing. */
function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Finite non-negative number narrowing. */
function nonnegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}
