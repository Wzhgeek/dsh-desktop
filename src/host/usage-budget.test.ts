import assert from 'node:assert/strict'
import test from 'node:test'
import type { UsageSummary } from './usage-aggregate.ts'
import {
  parseUsageBudget,
  usageBudgetNotificationKey,
  usageBudgetStatus,
} from './usage-budget.ts'

function summary(byDay: Array<{ key: string; cost: number }>): UsageSummary {
  const tokenFields = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  return {
    currency: 'USD',
    generatedAt: 0,
    failedSessions: 0,
    overview: { ...tokenFields, sessions: 0, calls: 0, fallbackPricedCalls: 0, cost: 0 },
    byDay: byDay.map(row => ({ ...row, ...tokenFields, label: row.key, sessions: 1, calls: 1, fallbackPricedCalls: 0 })),
    byWeek: [],
    byModel: [],
  }
}

test('validates and clamps budget preferences', () => {
  assert.deepEqual(parseUsageBudget({ enabled: true, period: 'daily', limitUsd: -2, notifyAtPercent: 180 }), {
    enabled: true,
    period: 'daily',
    limitUsd: 0.01,
    notifyAtPercent: 100,
  })
  assert.equal(parseUsageBudget(null), undefined)
})

test('calculates daily and monthly spend against the configured threshold', () => {
  const usage = summary([
    { key: '2026-07-31', cost: 1 },
    { key: '2026-08-13', cost: 2 },
    { key: '2026-08-14', cost: 3 },
  ])
  const now = new Date(2026, 7, 14, 12).getTime()
  const daily = usageBudgetStatus(usage, { enabled: true, period: 'daily', limitUsd: 4, notifyAtPercent: 75 }, now)
  assert.equal(daily.periodKey, '2026-08-14')
  assert.equal(daily.spentUsd, 3)
  assert.equal(daily.exceeded, true)

  const monthly = usageBudgetStatus(usage, { enabled: true, period: 'monthly', limitUsd: 10, notifyAtPercent: 80 }, now)
  assert.equal(monthly.periodKey, '2026-08')
  assert.equal(monthly.spentUsd, 5)
  assert.equal(monthly.exceeded, false)
  assert.match(usageBudgetNotificationKey({ enabled: true, period: 'monthly', limitUsd: 10, notifyAtPercent: 80 }, monthly), /^monthly:2026-08:/)
})
