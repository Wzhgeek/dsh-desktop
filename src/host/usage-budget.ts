/** Pure budget preference validation and period-cost calculation. */

import { dayKey, type UsageSummary } from './usage-aggregate.ts'

export type UsageBudgetPeriod = 'daily' | 'monthly'

export interface UsageBudgetConfig {
  enabled: boolean
  period: UsageBudgetPeriod
  limitUsd: number
  notifyAtPercent: number
}

export interface UsageBudgetStatus {
  periodKey: string
  spentUsd: number
  limitUsd: number
  thresholdUsd: number
  progress: number
  exceeded: boolean
}

export const DEFAULT_USAGE_BUDGET: UsageBudgetConfig = Object.freeze({
  enabled: false,
  period: 'monthly',
  limitUsd: 20,
  notifyAtPercent: 80,
})

/** Validate a persisted or submitted configuration, applying field defaults. */
export function parseUsageBudget(value: unknown): UsageBudgetConfig | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const period = record.period === 'daily' || record.period === 'monthly' ? record.period : DEFAULT_USAGE_BUDGET.period
  const limitUsd = typeof record.limitUsd === 'number' && Number.isFinite(record.limitUsd)
    ? Math.min(1_000_000, Math.max(0.01, Math.round(record.limitUsd * 100) / 100))
    : DEFAULT_USAGE_BUDGET.limitUsd
  const notifyAtPercent = typeof record.notifyAtPercent === 'number' && Number.isFinite(record.notifyAtPercent)
    ? Math.min(100, Math.max(1, Math.round(record.notifyAtPercent)))
    : DEFAULT_USAGE_BUDGET.notifyAtPercent
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_USAGE_BUDGET.enabled,
    period,
    limitUsd,
    notifyAtPercent,
  }
}

/** Calculate current local-calendar spend and threshold state. */
export function usageBudgetStatus(
  summary: UsageSummary,
  config: UsageBudgetConfig,
  now = Date.now(),
): UsageBudgetStatus {
  const currentDay = dayKey(now)
  const periodKey = config.period === 'daily' ? currentDay : currentDay.slice(0, 7)
  const spentUsd = summary.byDay.reduce((total, row) => {
    const matches = config.period === 'daily' ? row.key === periodKey : row.key.startsWith(`${periodKey}-`)
    return matches ? total + row.cost : total
  }, 0)
  const thresholdUsd = config.limitUsd * config.notifyAtPercent / 100
  return {
    periodKey,
    spentUsd,
    limitUsd: config.limitUsd,
    thresholdUsd,
    progress: config.limitUsd === 0 ? 0 : spentUsd / config.limitUsd,
    exceeded: config.enabled && spentUsd >= thresholdUsd,
  }
}

/** Stable deduplication key; preference changes intentionally allow a fresh alert. */
export function usageBudgetNotificationKey(config: UsageBudgetConfig, status: UsageBudgetStatus): string {
  return `${config.period}:${status.periodKey}:${config.limitUsd}:${config.notifyAtPercent}`
}
