import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aggregateUsage,
  estimateUsageCost,
  type ModelPricing,
  type UsageSessionInspection,
} from './usage-aggregate.ts'

const RATE: ModelPricing = {
  inputPerMToken: 1,
  cacheReadPerMToken: 0.25,
  cacheWritePerMToken: 2,
  outputPerMToken: 4,
}

test('prices disjoint token buckets and groups calls by day, week, and model', () => {
  const time = new Date(2026, 7, 12, 15, 30).getTime()
  const sessions: UsageSessionInspection[] = [{
    meta: { id: 'session-one', createdAt: time },
    events: [{
      type: 'assistant/message',
      seq: 0,
      time,
      data: {
        message: { source: { provider: 'deepseek-official', model: 'flash' } },
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: 10 },
      },
    }],
  }]
  const summary = aggregateUsage(sessions, { flash: RATE }, 'flash')

  assert.equal(summary.overview.sessions, 1)
  assert.equal(summary.overview.calls, 1)
  assert.equal(summary.overview.uncachedInputTokens, 100)
  assert.equal(summary.overview.cacheReadTokens, 40)
  assert.equal(summary.overview.cacheWriteTokens, 10)
  assert.equal(summary.overview.outputTokens, 20)
  assert.equal(summary.overview.cost, estimateUsageCost({
    uncachedInputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 40,
    cacheWriteTokens: 10,
  }, RATE))
  assert.equal(summary.byDay.length, 1)
  assert.equal(summary.byWeek.length, 1)
  assert.equal(summary.byModel[0]?.key, 'deepseek-official:flash')
})

test('excludes inherited fork events and flags fallback-priced model calls', () => {
  const time = new Date(2026, 7, 13, 9).getTime()
  const usage = { inputTokens: 10, outputTokens: 5 }
  const summary = aggregateUsage([{
    meta: {
      id: 'fork',
      createdAt: time,
      parentSession: 'parent',
      seedLength: 2,
    },
    events: [
      { type: 'assistant/message', seq: 0, time, data: { message: {}, usage } },
      { type: 'assistant/message', seq: 1, time, data: { message: {}, usage } },
      { type: 'assistant/message', seq: 2, time, data: { message: {}, usage } },
    ],
  }], { default: RATE }, 'default')

  assert.equal(summary.overview.calls, 1)
  assert.equal(summary.overview.uncachedInputTokens, 10)
  assert.equal(summary.overview.fallbackPricedCalls, 1)
})
