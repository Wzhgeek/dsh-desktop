/**
 * Cross-session request, token, and estimated-cost dashboard shown in Settings.
 * @module @dsh-desktop/client/usage/UsageDashboard
 */

import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
import { useCallback, useEffect, useMemo, useState } from 'react'

interface UsageTokens {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

interface UsageBucket extends UsageTokens {
  key: string
  label: string
  sessions: number
  calls: number
  fallbackPricedCalls: number
  cost: number
  provider?: string
  model?: string
}

interface UsageSummaryResponse {
  currency: string
  generatedAt: number
  failedSessions: number
  overview: UsageTokens & {
    sessions: number
    calls: number
    fallbackPricedCalls: number
    cost: number
  }
  byDay: UsageBucket[]
  byWeek: UsageBucket[]
  byModel: UsageBucket[]
}

interface UsageBudgetConfig {
  enabled: boolean
  period: 'daily' | 'monthly'
  limitUsd: number
  notifyAtPercent: number
}

interface ChartDatum extends UsageBucket {
  displayLabel: string
}

type Dimension = 'day' | 'week' | 'model'

const INTEGER_FORMAT = new Intl.NumberFormat()
const COMPACT_FORMAT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'numeric', day: 'numeric' })
const LONG_DATE_FORMAT = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const CHART_WIDTH = 520
const CHART_HEIGHT = 250
const CHART_PADDING = { top: 24, right: 14, bottom: 36, left: 52 }

/** Fetch and validate the dashboard HTTP boundary. */
async function loadSummary(): Promise<UsageSummaryResponse> {
  const response = await fetch('/api/desktop/usage/summary')
  const value = await response.json() as UsageSummaryResponse & { error?: string }
  if (!response.ok) throw new Error(value.error ?? `Usage request failed (${String(response.status)})`)
  return value
}

async function loadBudget(): Promise<UsageBudgetConfig> {
  const response = await fetch('/api/desktop/usage/budget')
  const value = await response.json() as UsageBudgetConfig & { error?: string }
  if (!response.ok) throw new Error(value.error ?? `Budget request failed (${String(response.status)})`)
  return value
}

async function saveBudget(value: UsageBudgetConfig): Promise<UsageBudgetConfig> {
  const response = await fetch('/api/desktop/usage/budget', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  })
  const result = await response.json() as UsageBudgetConfig & { error?: string }
  if (!response.ok) throw new Error(result.error ?? `Budget save failed (${String(response.status)})`)
  return result
}

/** Total prompt-side tokens (the three disjoint provider buckets). */
function inputTokens(value: UsageTokens): number {
  return value.uncachedInputTokens + value.cacheReadTokens + value.cacheWriteTokens
}

/** Total input and output tokens. */
function allTokens(value: UsageTokens): number {
  return inputTokens(value) + value.outputTokens
}

/** Stable cost copy for both tiny and larger totals. */
function formatCost(cost: number): string {
  const digits = cost === 0 ? 2 : cost < 0.01 ? 4 : cost < 1 ? 3 : 2
  return `$${cost.toFixed(digits)}`
}

/** Compact date label for day/week keys. */
function formatPeriod(row: UsageBucket, dimension: Dimension): string {
  if (dimension === 'model') return row.label
  const start = new Date(`${row.key}T00:00:00`)
  if (!Number.isFinite(start.getTime())) return row.label
  if (dimension === 'day') return DATE_FORMAT.format(start)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return `${DATE_FORMAT.format(start)} - ${DATE_FORMAT.format(end)}`
}

/** Fill the last twelve calendar days so quiet days remain visible in the chart. */
function dailyChartRows(rows: readonly UsageBucket[]): ChartDatum[] {
  if (rows.length === 0) return []
  const latestKey = rows.at(-1)?.key
  const latest = new Date(`${latestKey ?? ''}T00:00:00`)
  if (!Number.isFinite(latest.getTime())) return rows.slice(-12).map(row => ({ ...row, displayLabel: row.label }))
  const byKey = new Map(rows.map(row => [row.key, row]))
  return Array.from({ length: 12 }, (_, index): ChartDatum => {
    const date = new Date(latest)
    date.setDate(date.getDate() - (11 - index))
    const key = `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const existing = byKey.get(key)
    return existing === undefined
      ? {
          key,
          label: key,
          displayLabel: DATE_FORMAT.format(date),
          sessions: 0,
          calls: 0,
          fallbackPricedCalls: 0,
          cost: 0,
          uncachedInputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }
      : { ...existing, displayLabel: DATE_FORMAT.format(date) }
  })
}

/** Build the time/category series for the selected grouping. */
function chartRows(summary: UsageSummaryResponse, dimension: Dimension): ChartDatum[] {
  if (dimension === 'day') return dailyChartRows(summary.byDay)
  const rows = dimension === 'week' ? summary.byWeek.slice(-12) : summary.byModel.slice(0, 10)
  return rows.map(row => ({ ...row, displayLabel: formatPeriod(row, dimension) }))
}

/** Smooth path through chart points using horizontal cubic control points. */
function smoothPath(points: readonly { x: number; y: number }[]): string {
  const first = points[0]
  if (first === undefined) return ''
  let path = `M ${first.x} ${first.y}`
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    if (previous === undefined || current === undefined) continue
    const middle = (previous.x + current.x) / 2
    path += ` C ${middle} ${previous.y}, ${middle} ${current.y}, ${current.x} ${current.y}`
  }
  return path
}

/** Indexes used for a compact four-label x axis. */
function labelIndexes(length: number): Set<number> {
  if (length <= 1) return new Set([0])
  return new Set([0, Math.round((length - 1) / 3), Math.round((length - 1) * 2 / 3), length - 1])
}

/** Requests area chart matching the supplied dark dashboard reference. */
function RequestChart({ rows }: { rows: readonly ChartDatum[] }): JSX.Element {
  const [hovered, setHovered] = useState<number | null>(null)
  const [pinned, setPinned] = useState<number | null>(null)
  const active = hovered ?? pinned
  const innerWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right
  const innerHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom
  const maximum = Math.max(1, ...rows.map(row => row.calls))
  const points = rows.map((row, index) => ({
    x: CHART_PADDING.left + (rows.length <= 1 ? innerWidth / 2 : index / (rows.length - 1) * innerWidth),
    y: CHART_PADDING.top + innerHeight - row.calls / maximum * innerHeight,
  }))
  const line = smoothPath(points)
  const first = points[0]
  const last = points.at(-1)
  const area = first === undefined || last === undefined ? '' : `${line} L ${last.x} ${CHART_PADDING.top + innerHeight} L ${first.x} ${CHART_PADDING.top + innerHeight} Z`
  const labels = labelIndexes(rows.length)
  const activePoint = active === null ? undefined : points[active]
  const activeRow = active === null ? undefined : rows[active]

  return (
    <div className="dsh-usage-chart-wrap">
      <svg className="dsh-usage-chart-svg" viewBox={`0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`} role="img" aria-label="API request volume chart">
        {[0, 0.5, 1].map(ratio => {
          const y = CHART_PADDING.top + innerHeight - ratio * innerHeight
          return (
            <g key={ratio}>
              <line className="dsh-usage-grid-line" x1={CHART_PADDING.left} x2={CHART_WIDTH - CHART_PADDING.right} y1={y} y2={y} />
              <text className="dsh-usage-axis-text" x={8} y={y + 4}>{COMPACT_FORMAT.format(maximum * ratio)}</text>
            </g>
          )
        })}
        {area !== '' ? <path className="dsh-usage-area" d={area} /> : null}
        {line !== '' ? <path className="dsh-usage-line" d={line} /> : null}
        {rows.map((row, index) => {
          const point = points[index]
          if (point === undefined) return null
          return (
            <g key={row.key}>
              {labels.has(index) ? <text className="dsh-usage-axis-text is-x" x={point.x} y={CHART_HEIGHT - 10}>{row.displayLabel}</text> : null}
              <circle className={`dsh-usage-point ${active === index ? 'is-active' : ''}`} cx={point.x} cy={point.y} r={active === index ? 4 : 2.5} />
              <circle
                className="dsh-usage-hit-target"
                cx={point.x}
                cy={point.y}
                r={14}
                tabIndex={0}
                aria-label={`${row.displayLabel}: ${INTEGER_FORMAT.format(row.calls)} requests`}
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
                onClick={() => setPinned(current => current === index ? null : index)}
              />
            </g>
          )
        })}
      </svg>
      {activePoint !== undefined && activeRow !== undefined ? (
        <div className="dsh-usage-tooltip" style={{
          left: `${String(Math.min(82, Math.max(18, activePoint.x / CHART_WIDTH * 100)))}%`,
          top: `${String(Math.max(42, activePoint.y / CHART_HEIGHT * 100))}%`,
        }}>
          <strong>{activeRow.displayLabel}</strong>
          <span>请求次数 <b>{INTEGER_FORMAT.format(activeRow.calls)}</b></span>
          <span>会话 <b>{INTEGER_FORMAT.format(activeRow.sessions)}</b></span>
        </div>
      ) : null}
    </div>
  )
}

const TOKEN_PARTS = [
  { key: 'uncachedInputTokens', label: 'Input', color: '#3b82f6' },
  { key: 'cacheReadTokens', label: 'Cache read', color: '#8bd3f7' },
  { key: 'cacheWriteTokens', label: 'Cache write', color: '#a78bfa' },
  { key: 'outputTokens', label: 'Output', color: '#f062a6' },
] as const

/** Stacked token columns with keyboard-accessible inspection targets. */
function TokenChart({ rows }: { rows: readonly ChartDatum[] }): JSX.Element {
  const [hovered, setHovered] = useState<number | null>(null)
  const [pinned, setPinned] = useState<number | null>(null)
  const active = hovered ?? pinned
  const innerWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right
  const innerHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom
  const maximum = Math.max(1, ...rows.map(allTokens))
  const step = rows.length <= 1 ? innerWidth : innerWidth / rows.length
  const barWidth = Math.min(32, Math.max(8, step * 0.56))
  const labels = labelIndexes(rows.length)
  const activeRow = active === null ? undefined : rows[active]
  const activeX = active === null ? 0 : CHART_PADDING.left + step * active + step / 2

  return (
    <div className="dsh-usage-chart-wrap">
      <svg className="dsh-usage-chart-svg" viewBox={`0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`} role="img" aria-label="Token volume chart">
        {[0, 0.5, 1].map(ratio => {
          const y = CHART_PADDING.top + innerHeight - ratio * innerHeight
          return (
            <g key={ratio}>
              <line className="dsh-usage-grid-line" x1={CHART_PADDING.left} x2={CHART_WIDTH - CHART_PADDING.right} y1={y} y2={y} />
              <text className="dsh-usage-axis-text" x={8} y={y + 4}>{COMPACT_FORMAT.format(maximum * ratio)}</text>
            </g>
          )
        })}
        {rows.map((row, index) => {
          const x = CHART_PADDING.left + step * index + step / 2
          let stacked = 0
          return (
            <g key={row.key}>
              {TOKEN_PARTS.map(part => {
                const value = row[part.key]
                const height = value / maximum * innerHeight
                const y = CHART_PADDING.top + innerHeight - stacked - height
                stacked += height
                return height <= 0 ? null : <rect key={part.key} x={x - barWidth / 2} y={y} width={barWidth} height={height} rx={2} fill={part.color} />
              })}
              {labels.has(index) ? <text className="dsh-usage-axis-text is-x" x={x} y={CHART_HEIGHT - 10}>{row.displayLabel}</text> : null}
              <rect
                className="dsh-usage-hit-target"
                x={x - Math.max(barWidth, 20) / 2}
                y={CHART_PADDING.top}
                width={Math.max(barWidth, 20)}
                height={innerHeight}
                tabIndex={0}
                aria-label={`${row.displayLabel}: ${INTEGER_FORMAT.format(allTokens(row))} tokens`}
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
                onClick={() => setPinned(current => current === index ? null : index)}
              />
            </g>
          )
        })}
      </svg>
      {activeRow !== undefined ? (
        <div className="dsh-usage-tooltip" style={{ left: `${String(Math.min(82, Math.max(18, activeX / CHART_WIDTH * 100)))}%`, top: '45%' }}>
          <strong>{activeRow.displayLabel}</strong>
          <span>Tokens <b>{INTEGER_FORMAT.format(allTokens(activeRow))}</b></span>
          <span>Input <b>{COMPACT_FORMAT.format(inputTokens(activeRow))}</b></span>
          <span>Output <b>{COMPACT_FORMAT.format(activeRow.outputTokens)}</b></span>
        </div>
      ) : null}
    </div>
  )
}

/** Settings section showing aggregate usage across every durable session. */
export function UsageDashboard(): JSX.Element {
  const [summary, setSummary] = useState<UsageSummaryResponse | null>(null)
  const [budget, setBudget] = useState<UsageBudgetConfig | null>(null)
  const [budgetDraft, setBudgetDraft] = useState('20')
  const [budgetSaving, setBudgetSaving] = useState(false)
  const [dimension, setDimension] = useState<Dimension>('day')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextSummary, nextBudget] = await Promise.all([loadSummary(), loadBudget()])
      setSummary(nextSummary)
      setBudget(nextBudget)
      setBudgetDraft(String(nextBudget.limitUsd))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const rows = useMemo(() => summary === null ? [] : chartRows(summary, dimension), [dimension, summary])
  const tableRows = useMemo(() => {
    if (summary === null) return []
    if (dimension === 'week') return summary.byWeek
    if (dimension === 'model') return summary.byModel
    return summary.byDay
  }, [dimension, summary])
  const models = summary?.byModel.length ?? 0
  const budgetSpend = useMemo(() => {
    if (summary === null || budget === null) return 0
    const today = new Date()
    const day = `${String(today.getFullYear())}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const key = budget.period === 'daily' ? day : day.slice(0, 7)
    return summary.byDay.reduce((total, row) => total + ((budget.period === 'daily' ? row.key === key : row.key.startsWith(`${key}-`)) ? row.cost : 0), 0)
  }, [budget, summary])

  const updateBudget = useCallback(async (next: UsageBudgetConfig) => {
    setBudget(next)
    setBudgetSaving(true)
    setError(null)
    try {
      const saved = await saveBudget(next)
      setBudget(saved)
      setBudgetDraft(String(saved.limitUsd))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      try {
        const restored = await loadBudget()
        setBudget(restored)
        setBudgetDraft(String(restored.limitUsd))
      } catch {
        // The original save error is the useful message.
      }
    } finally {
      setBudgetSaving(false)
    }
  }, [])

  const commitBudgetLimit = (): void => {
    if (budget === null) return
    const parsed = Number(budgetDraft)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setBudgetDraft(String(budget.limitUsd))
      return
    }
    void updateBudget({ ...budget, limitUsd: parsed })
  }

  return (
    <section className="dsh-usage-dashboard" aria-label="Usage">
      <style>{USAGE_CSS}</style>
      <header className="dsh-usage-header">
        <div>
          <h2>Usage</h2>
          {summary !== null ? <span>{summary.failedSessions > 0 ? `${String(summary.failedSessions)} unread · ` : ''}Updated {new Date(summary.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> : null}
        </div>
        <div className="dsh-usage-controls">
          <div role="tablist" aria-label="Usage grouping" className="dsh-usage-segments">
            {(['day', 'week', 'model'] as const).map(value => (
              <button key={value} role="tab" type="button" aria-selected={dimension === value} onClick={() => setDimension(value)}>
                {value === 'day' ? '按日' : value === 'week' ? '按周' : '按模型'}
              </button>
            ))}
          </div>
          <button className="dsh-usage-refresh" type="button" aria-label="Refresh usage" title="Refresh usage" onClick={() => { void refresh() }} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'is-loading' : undefined} />
          </button>
        </div>
      </header>

      {error !== null ? <div className="dsh-usage-error" role="alert">{error}</div> : null}
      {summary === null ? (
        <div className="dsh-usage-empty">{loading ? 'Loading usage...' : 'No usage data available.'}</div>
      ) : rows.length === 0 ? (
        <div className="dsh-usage-empty">No model calls recorded yet.</div>
      ) : (
        <>
          <div className="dsh-usage-charts">
            <article className="dsh-usage-chart-card">
              <h3>API 请求次数 <strong>{INTEGER_FORMAT.format(summary.overview.calls)}</strong></h3>
              <RequestChart rows={rows} />
            </article>
            <article className="dsh-usage-chart-card">
              <h3>Tokens <strong>{INTEGER_FORMAT.format(allTokens(summary.overview))}</strong></h3>
              <TokenChart rows={rows} />
              <div className="dsh-usage-legend" aria-label="Token categories">
                {TOKEN_PARTS.map(part => <span key={part.key}><i style={{ background: part.color }} />{part.label}</span>)}
              </div>
            </article>
          </div>

          <div className="dsh-usage-metrics">
            <Metric label="预估成本" value={formatCost(summary.overview.cost)} />
            <Metric label="会话" value={INTEGER_FORMAT.format(summary.overview.sessions)} />
            <Metric label="模型" value={INTEGER_FORMAT.format(models)} />
            <Metric label="平均 Tokens / 请求" value={COMPACT_FORMAT.format(allTokens(summary.overview) / Math.max(1, summary.overview.calls))} />
          </div>

          {budget !== null ? (
            <section className="dsh-usage-budget" aria-label="成本预算告警">
              <div className="dsh-usage-budget-head">
                <div>
                  <h3>成本预算</h3>
                  <span>{budget.period === 'daily' ? '今日' : '本月'}已用 {formatCost(budgetSpend)} / {formatCost(budget.limitUsd)}</span>
                </div>
                <label className="dsh-usage-switch">
                  <input
                    type="checkbox"
                    checked={budget.enabled}
                    disabled={budgetSaving}
                    onChange={event => { void updateBudget({ ...budget, enabled: event.currentTarget.checked }) }}
                  />
                  <span aria-hidden="true" />
                  告警
                </label>
              </div>
              <div className="dsh-usage-budget-progress" aria-label={`预算使用 ${String(Math.round(budgetSpend / Math.max(0.01, budget.limitUsd) * 100))}%`}>
                <i style={{ width: `${String(Math.min(100, budgetSpend / Math.max(0.01, budget.limitUsd) * 100))}%` }} />
                <b style={{ left: `${String(budget.notifyAtPercent)}%` }} title={`告警阈值 ${String(budget.notifyAtPercent)}%`} />
              </div>
              <div className="dsh-usage-budget-controls">
                <label>周期
                  <select value={budget.period} disabled={budgetSaving} onChange={event => { void updateBudget({ ...budget, period: event.currentTarget.value as UsageBudgetConfig['period'] }) }}>
                    <option value="daily">每日</option>
                    <option value="monthly">每月</option>
                  </select>
                </label>
                <label>预算（USD）
                  <input
                    type="number"
                    min="0.01"
                    step="1"
                    value={budgetDraft}
                    disabled={budgetSaving}
                    onChange={event => setBudgetDraft(event.currentTarget.value)}
                    onBlur={commitBudgetLimit}
                    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
                  />
                </label>
                <label>通知阈值
                  <select value={budget.notifyAtPercent} disabled={budgetSaving} onChange={event => { void updateBudget({ ...budget, notifyAtPercent: Number(event.currentTarget.value) }) }}>
                    {[50, 75, 80, 90, 100].map(value => <option key={value} value={value}>{value}%</option>)}
                  </select>
                </label>
                <span className={budget.enabled ? 'is-on' : undefined}>{budgetSaving ? '保存中...' : budget.enabled ? `达到 ${formatCost(budget.limitUsd * budget.notifyAtPercent / 100)} 时通知` : '未启用'}</span>
              </div>
            </section>
          ) : null}

          <div className="dsh-usage-table-wrap">
            <table>
              <colgroup>
                <col className="is-period" />
                <col className="is-sessions" />
                <col className="is-calls" />
                <col className="is-input" />
                <col className="is-output" />
                <col className="is-cost" />
              </colgroup>
              <thead>
                <tr>
                  <th>{dimension === 'model' ? '模型' : '周期'}</th>
                  <th>会话</th>
                  <th>请求</th>
                  <th>输入</th>
                  <th>输出</th>
                  <th>预估成本</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map(row => (
                  <tr key={row.key}>
                    <td><strong title={formatPeriod(row, dimension)}>{formatPeriod(row, dimension)}</strong>{dimension === 'model' ? <span>{row.provider}</span> : null}</td>
                    <td>{INTEGER_FORMAT.format(row.sessions)}</td>
                    <td>{INTEGER_FORMAT.format(row.calls)}</td>
                    <td>{COMPACT_FORMAT.format(inputTokens(row))}</td>
                    <td>{COMPACT_FORMAT.format(row.outputTokens)}</td>
                    <td>{formatCost(row.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="dsh-usage-footnote">
            Desktop rate card · {LONG_DATE_FORMAT.format(new Date(summary.generatedAt))}
            {summary.overview.fallbackPricedCalls > 0 ? ` · ${String(summary.overview.fallbackPricedCalls)} calls use fallback pricing` : ''}
          </p>
        </>
      )}
    </section>
  )
}

/** One compact metric in the summary strip. */
function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return <div><span>{label}</span><strong>{value}</strong></div>
}

const USAGE_CSS = `
.dsh-usage-dashboard {
  --usage-border: var(--dsw-alias-border-l1, rgba(127,127,127,.2));
  --usage-text: var(--dsw-alias-label-primary, #f2f2f3);
  --usage-muted: var(--dsw-alias-label-secondary, #98989f);
  --usage-surface: var(--dsw-alias-bg-layer-1, #171719);
  --usage-raised: var(--dsw-alias-bg-layer-2, #2b2b2e);
  min-width: 0; padding: 0 0 8px; color: var(--usage-text); container-type: inline-size;
}
.dsh-usage-header { min-height: 42px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.dsh-usage-header > div:first-child { min-width: 0; display: flex; align-items: baseline; gap: 10px; }
.dsh-usage-header h2 { margin: 0; font-size: 18px; line-height: 26px; font-weight: 600; letter-spacing: 0; }
.dsh-usage-header span { color: var(--usage-muted); font-size: 10px; white-space: nowrap; }
.dsh-usage-controls { display: flex; align-items: center; gap: 7px; }
.dsh-usage-segments { height: 32px; padding: 2px; display: inline-flex; border: 1px solid var(--usage-border); border-radius: 6px; background: var(--usage-raised); }
.dsh-usage-segments button { min-width: 66px; padding: 0 10px; border: 0; border-radius: 4px; color: var(--usage-muted); background: transparent; font: 500 11px/18px inherit; cursor: pointer; }
.dsh-usage-segments button[aria-selected="true"] { color: var(--usage-text); background: var(--usage-surface); box-shadow: inset 0 0 0 1px var(--usage-border); }
.dsh-usage-refresh { width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid var(--usage-border); border-radius: 6px; color: var(--usage-muted); background: transparent; cursor: pointer; }
.dsh-usage-refresh:hover:not(:disabled) { color: var(--usage-text); background: var(--usage-raised); }
.dsh-usage-refresh:disabled { opacity: .5; }
.dsh-usage-refresh .is-loading { animation: dsh-usage-spin .8s linear infinite; }
.dsh-usage-charts { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
.dsh-usage-chart-card { min-width: 0; padding: 16px 16px 10px; border: 1px solid var(--usage-border); border-radius: 8px; background: var(--usage-raised); }
.dsh-usage-chart-card h3 { margin: 0 0 4px; font-size: 13px; line-height: 20px; font-weight: 550; }
.dsh-usage-chart-card h3 strong { color: var(--usage-muted); font-weight: 450; }
.dsh-usage-chart-wrap { position: relative; width: 100%; aspect-ratio: 1.85; min-height: 220px; }
.dsh-usage-chart-svg { width: 100%; height: 100%; display: block; overflow: visible; }
.dsh-usage-grid-line { stroke: color-mix(in srgb, var(--usage-border) 75%, transparent); stroke-width: 1; vector-effect: non-scaling-stroke; }
.dsh-usage-axis-text { fill: var(--usage-muted); font: 11px/14px inherit; }
.dsh-usage-axis-text.is-x { text-anchor: middle; }
.dsh-usage-area { fill: rgba(77,143,222,.62); }
.dsh-usage-line { fill: none; stroke: #2f81f7; stroke-width: 2; vector-effect: non-scaling-stroke; }
.dsh-usage-point { fill: var(--usage-raised); stroke: #2f81f7; stroke-width: 2; vector-effect: non-scaling-stroke; }
.dsh-usage-point.is-active { fill: #fff; }
.dsh-usage-hit-target { fill: transparent; outline: none; cursor: crosshair; }
.dsh-usage-hit-target:focus { stroke: #fff; stroke-width: 1; vector-effect: non-scaling-stroke; }
.dsh-usage-tooltip { position: absolute; z-index: 3; min-width: 132px; padding: 10px 12px; display: grid; gap: 5px; transform: translate(-50%,-108%); border: 1px solid rgba(255,255,255,.08); border-radius: 7px; color: #b8bac2; background: #1f1f21; box-shadow: 0 12px 30px rgba(0,0,0,.3); pointer-events: none; font-size: 11px; }
.dsh-usage-tooltip strong { color: #f7f7f8; font-size: 12px; }
.dsh-usage-tooltip span { display: flex; justify-content: space-between; gap: 16px; }
.dsh-usage-tooltip b { color: #f7f7f8; font-weight: 550; font-variant-numeric: tabular-nums; }
.dsh-usage-legend { min-height: 20px; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px 12px; color: var(--usage-muted); font-size: 9px; }
.dsh-usage-legend span { display: inline-flex; align-items: center; gap: 4px; }
.dsh-usage-legend i { width: 7px; height: 7px; border-radius: 2px; }
.dsh-usage-metrics { margin-top: 12px; display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); border-top: 1px solid var(--usage-border); border-bottom: 1px solid var(--usage-border); }
.dsh-usage-metrics > div { min-width: 0; padding: 11px 14px; display: grid; gap: 2px; border-right: 1px solid var(--usage-border); }
.dsh-usage-metrics > div:last-child { border-right: 0; }
.dsh-usage-metrics span { overflow: hidden; color: var(--usage-muted); text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.dsh-usage-metrics strong { overflow: hidden; text-overflow: ellipsis; font-size: 17px; line-height: 23px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dsh-usage-budget { margin-top: 12px; padding: 13px 0 14px; border-top: 1px solid var(--usage-border); border-bottom: 1px solid var(--usage-border); }
.dsh-usage-budget-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.dsh-usage-budget-head > div { min-width: 0; display: flex; align-items: baseline; gap: 9px; }
.dsh-usage-budget h3 { margin: 0; font-size: 13px; line-height: 20px; font-weight: 600; letter-spacing: 0; }
.dsh-usage-budget-head > div > span { color: var(--usage-muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.dsh-usage-switch { display: inline-flex; align-items: center; gap: 7px; color: var(--usage-muted); font-size: 10px; cursor: pointer; }
.dsh-usage-switch input { position: absolute; opacity: 0; pointer-events: none; }
.dsh-usage-switch > span { position: relative; width: 30px; height: 17px; border-radius: 9px; background: color-mix(in srgb, var(--usage-muted) 32%, transparent); transition: background .15s ease; }
.dsh-usage-switch > span::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #fff; transition: transform .15s ease; }
.dsh-usage-switch input:checked + span { background: var(--dsh-desktop-accent, #4f8cff); }
.dsh-usage-switch input:checked + span::after { transform: translateX(13px); }
.dsh-usage-switch input:focus-visible + span { outline: 2px solid var(--dsh-desktop-accent, #4f8cff); outline-offset: 2px; }
.dsh-usage-budget-progress { position: relative; height: 5px; margin: 11px 0 12px; overflow: visible; border-radius: 3px; background: color-mix(in srgb, var(--usage-muted) 18%, transparent); }
.dsh-usage-budget-progress i { display: block; height: 100%; border-radius: inherit; background: var(--dsh-desktop-accent, #4f8cff); transition: width .2s ease; }
.dsh-usage-budget-progress b { position: absolute; top: -2px; width: 1px; height: 9px; background: #f5b942; transform: translateX(-1px); }
.dsh-usage-budget-controls { display: grid; grid-template-columns: 110px minmax(130px,170px) 130px minmax(180px,1fr); align-items: end; gap: 10px; }
.dsh-usage-budget-controls label { min-width: 0; display: grid; gap: 4px; color: var(--usage-muted); font-size: 9px; }
.dsh-usage-budget-controls select, .dsh-usage-budget-controls input { box-sizing: border-box; width: 100%; height: 30px; padding: 0 8px; border: 1px solid var(--usage-border); border-radius: 5px; color: var(--usage-text); background: var(--usage-raised); font: 11px/18px inherit; }
.dsh-usage-budget-controls > span { align-self: center; justify-self: end; color: var(--usage-muted); font-size: 10px; }
.dsh-usage-budget-controls > span.is-on { color: #49c681; }
.dsh-usage-table-wrap { max-height: 230px; margin-top: 10px; overflow-y: auto; overflow-x: hidden; }
.dsh-usage-table-wrap table { width: 100%; min-width: 0; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
.dsh-usage-table-wrap th { position: sticky; top: 0; z-index: 1; padding: 8px 5px; overflow: hidden; border-bottom: 1px solid var(--usage-border); color: var(--usage-muted); background: var(--usage-surface); text-align: right; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.dsh-usage-table-wrap col.is-period { width: 26%; }
.dsh-usage-table-wrap col.is-sessions, .dsh-usage-table-wrap col.is-calls { width: 11%; }
.dsh-usage-table-wrap col.is-input { width: 17%; }
.dsh-usage-table-wrap col.is-output { width: 15%; }
.dsh-usage-table-wrap col.is-cost { width: 20%; }
.dsh-usage-table-wrap th:first-child { padding-left: 0; text-align: left; }
.dsh-usage-table-wrap td { padding: 8px 5px; overflow: hidden; border-bottom: 1px solid var(--usage-border); text-align: right; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.dsh-usage-table-wrap td:first-child { padding-left: 0; text-align: left; }
.dsh-usage-table-wrap td strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.dsh-usage-table-wrap td span { display: block; margin-top: 1px; color: var(--usage-muted); font-size: 9px; }
.dsh-usage-footnote { margin: 9px 0 0; color: var(--usage-muted); font-size: 9px; line-height: 15px; }
.dsh-usage-error { margin-bottom: 12px; padding: 10px 12px; border: 1px solid rgba(239,68,68,.3); border-radius: 6px; color: #f58b87; background: rgba(239,68,68,.06); font-size: 11px; }
.dsh-usage-empty { min-height: 260px; display: grid; place-items: center; border-top: 1px solid var(--usage-border); border-bottom: 1px solid var(--usage-border); color: var(--usage-muted); font-size: 12px; }
@keyframes dsh-usage-spin { to { transform: rotate(360deg); } }
@container (max-width: 680px) {
  .dsh-usage-chart-card { padding: 13px 10px 8px; }
  .dsh-usage-chart-wrap { min-height: 150px; }
  .dsh-usage-metrics { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .dsh-usage-metrics > div:nth-child(2) { border-right: 0; }
  .dsh-usage-metrics > div:nth-child(-n+2) { border-bottom: 1px solid var(--usage-border); }
  .dsh-usage-budget-controls { grid-template-columns: repeat(3,minmax(0,1fr)); }
  .dsh-usage-budget-controls > span { grid-column: 1 / -1; justify-self: start; }
}
@container (max-width: 520px) {
  .dsh-usage-charts { grid-template-columns: 1fr; }
  .dsh-usage-chart-wrap { min-height: 0; aspect-ratio: 2 / 1; }
}
@container (max-width: 440px) {
  .dsh-usage-header { align-items: flex-start; }
  .dsh-usage-header > div:first-child { display: grid; gap: 0; }
  .dsh-usage-segments button { min-width: 52px; padding: 0 7px; }
  .dsh-usage-budget-head > div { display: grid; gap: 0; }
  .dsh-usage-budget-controls { grid-template-columns: 1fr; }
  .dsh-usage-budget-controls > span { grid-column: auto; }
}
@media (prefers-reduced-motion: reduce) { .dsh-usage-refresh .is-loading { animation: none; } }
`
