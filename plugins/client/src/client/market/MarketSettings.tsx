// Author: Zihan Wang
// <wangzh011031@163.com>
/** Settings section: curated plugin market with review-then-install hand-off. */

import ExternalLink from 'lucide-react/dist/esm/icons/external-link.mjs'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.mjs'
import Store from 'lucide-react/dist/esm/icons/store.mjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { FIND_SCENARIOS, rankPluginsForNeed } from './find.ts'
import { stageReviewInstall } from './install.ts'
import { buildReviewPrompt } from './prompt.ts'

export type MarketSettingsProps = PropsRuntime<'settings.section'> & PropsRenderSlots<never> & {
  ctx: ClientContext
}

interface MarketPlugin {
  fullName: string
  owner: string
  name: string
  url: string
  description: string
  stars: number
  language: string
  license: string
  pushedAt: string
  defaultBranch: string
  category: string
  categoryZh: string
  categoryEn: string
}

interface MarketCategory {
  key: string
  zh: string
  en: string
  count: number
}

interface MarketCatalog {
  items: MarketPlugin[]
  categories: MarketCategory[]
  fetchedAt: string
  refreshedAt: string
  scanned: number
}

type CatalogState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; catalog: MarketCatalog; stale: boolean; error: string }
  | { status: 'error'; message: string }

export function MarketSettings({ ctx, close }: MarketSettingsProps): JSX.Element {
  const [enabled, setEnabled] = useState(false)
  const [profile, setProfile] = useState('web')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [need, setNeed] = useState('')
  const [scenarioId, setScenarioId] = useState<string | null>(null)
  const [category, setCategory] = useState('')
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'idle' })
  const [cardBusy, setCardBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const loadCatalog = useCallback(async (force: boolean): Promise<void> => {
    setCatalog({ status: 'loading' })
    try {
      const response = await fetch(`/api/desktop/market/catalog?${force ? 'force=1' : ''}`)
      const value = await response.json() as {
        ok?: boolean
        catalog?: MarketCatalog | null
        stale?: boolean
        error?: string
      }
      if (response.status === 403) {
        setCatalog({ status: 'idle' })
        return
      }
      if (!response.ok || value.ok === false) throw new Error(value.error ?? '无法读取插件目录')
      if (value.catalog == null) throw new Error(value.error || '目录为空')
      setCatalog({
        status: 'ready',
        catalog: value.catalog,
        stale: value.stale === true,
        error: typeof value.error === 'string' ? value.error : '',
      })
    } catch (error) {
      setCatalog({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/desktop/market')
        const value = await response.json() as { enabled?: boolean; profile?: string; error?: string }
        if (!response.ok) throw new Error(value.error ?? '无法读取市场设置')
        setEnabled(value.enabled === true)
        if (typeof value.profile === 'string' && value.profile !== '') setProfile(value.profile)
        if (value.enabled === true) await loadCatalog(false)
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error))
      }
    })()
  }, [loadCatalog])

  const toggleEnabled = async (next: boolean): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/desktop/market', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const value = await response.json() as { ok?: boolean; enabled?: boolean; error?: string }
      if (!response.ok || value.ok === false) throw new Error(value.error ?? '无法更新市场设置')
      setEnabled(value.enabled === true)
      if (value.enabled === true) await loadCatalog(true)
      else setCatalog({ status: 'idle' })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const installSafe = async (item: MarketPlugin): Promise<void> => {
    setCardBusy(`${item.fullName}:safe`)
    setMessage(null)
    try {
      const prompt = buildReviewPrompt({
        url: item.url,
        owner: item.owner,
        name: item.name,
        branch: item.defaultBranch,
        profile,
      })
      const outcome = await stageReviewInstall(ctx, prompt)
      if (!outcome.ok) {
        if (outcome.reason === 'no-workspace') setMessage('请先在侧栏打开或创建一个工作区，再安全安装。')
        else if (outcome.reason === 'not-ready') setMessage('工作区列表还在加载，稍后再试。')
        else setMessage(outcome.message ?? '无法打开审查会话')
        return
      }
      close()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setCardBusy(null)
    }
  }

  const installDirectNow = async (item: MarketPlugin): Promise<void> => {
    if (!window.confirm(
      `直接安装 ${item.fullName}？\n\n会立即执行官方命令 dsh plugin --profile web add github:${item.fullName}，不会先审查代码。装的是别人写的程序，请自行判断风险。`,
    )) return
    setCardBusy(`${item.fullName}:direct`)
    setMessage(null)
    try {
      const response = await fetch('/api/desktop/market/installed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'install-direct', fullName: item.fullName }),
      })
      const value = await response.json() as {
        ok?: boolean
        notice?: string
        error?: string
      }
      if (!response.ok || value.ok === false) throw new Error(value.notice ?? value.error ?? '直接安装失败')
      setMessage(value.notice ?? '安装完成。请到设置 → 插件 → 已安装 查看，并重启桌面端。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setCardBusy(null)
    }
  }

  const renderInstallActions = (item: MarketPlugin): JSX.Element => (
    <div className="dsh-market-actions">
      <a href={item.url} target="_blank" rel="noreferrer">
        <ExternalLink size={14} aria-hidden="true" />
        GitHub
      </a>
      <button
        type="button"
        className="dsh-market-secondary"
        disabled={cardBusy !== null}
        title="开新会话并填入审查提示词，由 Agent 读代码后再装"
        onClick={() => { void installSafe(item) }}
      >
        {cardBusy === `${item.fullName}:safe` ? '打开中…' : '安全安装'}
      </button>
      <button
        type="button"
        disabled={cardBusy !== null}
        title="立即执行 dsh plugin add，不经 Agent 审查"
        onClick={() => { void installDirectNow(item) }}
      >
        {cardBusy === `${item.fullName}:direct` ? '安装中…' : '直接安装'}
      </button>
    </div>
  )

  const scenario = useMemo(
    () => FIND_SCENARIOS.find(entry => entry.id === scenarioId),
    [scenarioId],
  )

  const picks = useMemo(() => {
    if (catalog.status !== 'ready') return []
    if (need.trim() === '' && scenario === undefined) return []
    return rankPluginsForNeed(catalog.catalog.items, need, scenario, 8)
  }, [catalog, need, scenario])

  const shown = useMemo(() => {
    if (catalog.status !== 'ready') return []
    const q = query.trim().toLocaleLowerCase()
    return catalog.catalog.items.filter(item => {
      if (category !== '' && item.category !== category) return false
      if (q === '') return true
      const haystack = `${item.fullName} ${item.description} ${item.categoryZh} ${item.language}`.toLocaleLowerCase()
      return q.split(/\s+/).every(word => haystack.includes(word))
    })
  }, [catalog, category, query])

  if (!enabled) {
    return (
      <div className="dsh-market">
        <style>{MARKET_CSS}</style>
        <div className="dsh-market-hero">
          <Store size={28} aria-hidden="true" />
          <div>
            <h2>插件市场</h2>
            <p>浏览 awesome-dsh-plugin 精选目录（上游全部条目）。默认关闭，不会主动联网；启用后才会拉取目录快照。</p>
            <p className="dsh-market-note">启用、停用与卸载请到设置 → 插件 →「已安装」。本页只负责浏览与安装。</p>
          </div>
        </div>
        {message !== null ? <p className="dsh-market-error" role="alert">{message}</p> : null}
        <button type="button" className="dsh-market-primary" disabled={busy} onClick={() => { void toggleEnabled(true) }}>
          {busy ? '正在启用…' : '启用插件市场'}
        </button>
      </div>
    )
  }

  return (
    <div className="dsh-market">
      <style>{MARKET_CSS}</style>

      <section className="dsh-market-find" aria-label="30 秒找插件">
        <div className="dsh-market-find-title">
          <Sparkles size={16} aria-hidden="true" />
          <strong>30 秒找合适插件</strong>
          <span>点场景，或用一句话描述需求（本地匹配，不额外联网）</span>
        </div>
        <input
          type="search"
          value={need}
          placeholder="例如：想给模型看图做 OCR、跨会话记忆、定时跑任务…"
          onChange={event => { setNeed(event.currentTarget.value) }}
        />
        <div className="dsh-market-scenarios" role="list">
          {FIND_SCENARIOS.map(entry => (
            <button
              key={entry.id}
              type="button"
              title={entry.hint}
              className={scenarioId === entry.id ? 'is-active' : undefined}
              onClick={() => {
                setScenarioId(current => current === entry.id ? null : entry.id)
                setCategory('')
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {picks.length > 0 ? (
          <ul className="dsh-market-picks">
            {picks.map(({ item, reason }) => (
              <li key={`pick-${item.fullName}`}>
                <div className="dsh-market-card-head">
                  <strong>{item.fullName}</strong>
                  <span>★ {starCount(item.stars)}</span>
                </div>
                <p>{item.description || '（无简介）'}</p>
                <div className="dsh-market-meta">
                  <span>{reason}</span>
                  <span>{item.categoryZh}</span>
                </div>
                {renderInstallActions(item)}
              </li>
            ))}
          </ul>
        ) : (need.trim() !== '' || scenario !== undefined) && catalog.status === 'ready' ? (
          <p className="dsh-market-summary">目录里没有明显匹配，试试换个说法，或下面按分类浏览。</p>
        ) : null}
      </section>

      <header className="dsh-market-toolbar">
        <input
          type="search"
          value={query}
          placeholder="在全部插件中搜索名称、简介或语言"
          onChange={event => { setQuery(event.currentTarget.value) }}
        />
        <button
          type="button"
          className="dsh-market-ghost"
          disabled={catalog.status === 'loading'}
          onClick={() => { void loadCatalog(true) }}
          title="刷新目录"
        >
          <RefreshCw size={14} aria-hidden="true" />
          刷新
        </button>
        <button type="button" className="dsh-market-ghost" disabled={busy} onClick={() => { void toggleEnabled(false) }}>
          停用市场
        </button>
      </header>

      {catalog.status === 'ready' ? (
        <div className="dsh-market-chips" role="list">
          <button type="button" className={category === '' ? 'is-active' : undefined} onClick={() => { setCategory('') }}>
            全部 {catalog.catalog.items.length}
          </button>
          {catalog.catalog.categories.map(entry => (
            <button
              key={entry.key}
              type="button"
              className={category === entry.key ? 'is-active' : undefined}
              onClick={() => { setCategory(current => current === entry.key ? '' : entry.key) }}
            >
              {entry.zh} {entry.count}
            </button>
          ))}
        </div>
      ) : null}

      {message !== null ? <p className="dsh-market-error" role="alert">{message}</p> : null}
      {catalog.status === 'ready' && catalog.stale && catalog.error !== '' ? (
        <p className="dsh-market-warn">目录可能过期：{catalog.error}</p>
      ) : null}

      <p className="dsh-market-summary">
        {catalog.status === 'loading' ? '正在加载目录…'
          : catalog.status === 'error' ? catalog.message
            : catalog.status === 'ready'
              ? (shown.length === 0 ? '没有匹配的插件' : `显示 ${String(shown.length)} / ${String(catalog.catalog.items.length)}（上游精选目录全量）`)
              : null}
      </p>

      {catalog.status === 'ready' ? (
        <ul className="dsh-market-list">
          {shown.map(item => (
            <li key={item.fullName}>
              <div className="dsh-market-card-head">
                <strong>{item.fullName}</strong>
                <span>★ {starCount(item.stars)}</span>
              </div>
              <p>{item.description || '（无简介）'}</p>
              <div className="dsh-market-meta">
                <span>{item.categoryZh}</span>
                {item.language !== '' ? <span>{item.language}</span> : null}
                {item.license !== '' ? <span>{item.license}</span> : null}
              </div>
              {renderInstallActions(item)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function starCount(stars: number): string {
  if (stars < 1_000) return String(stars)
  return `${(stars / 1_000).toFixed(stars < 10_000 ? 1 : 0)}k`
}

const MARKET_CSS = `
.dsh-market { display: grid; gap: 12px; padding: 4px 2px 18px; color: var(--dsw-alias-label-primary, #f2f2f3); }
.dsh-market-hero { display: flex; gap: 14px; align-items: flex-start; padding: 14px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.22)); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, #171719); }
.dsh-market-hero h2 { margin: 0 0 6px; font-size: 16px; }
.dsh-market-hero p { margin: 0 0 8px; color: var(--dsw-alias-label-secondary, #999); font-size: 12px; line-height: 1.5; }
.dsh-market-note { color: var(--dsw-alias-label-primary, #ddd) !important; }
.dsh-market-primary { justify-self: start; min-height: 34px; padding: 0 14px; border: 0; border-radius: 8px; color: #fff; background: var(--dsh-desktop-accent, #4f8cff); cursor: pointer; }
.dsh-market-primary:disabled { opacity: .5; cursor: default; }
.dsh-market-find { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.22)); border-radius: 10px; background: color-mix(in srgb, var(--dsh-desktop-accent, #4f8cff) 8%, var(--dsw-alias-bg-layer-1, #171719)); }
.dsh-market-find-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dsh-market-find-title strong { font-size: 13px; }
.dsh-market-find-title span { color: var(--dsw-alias-label-secondary, #999); font-size: 11px; }
.dsh-market-find > input { width: 100%; height: 34px; box-sizing: border-box; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.24)); border-radius: 8px; color: inherit; background: var(--dsw-alias-bg-layer-1, #171719); }
.dsh-market-scenarios { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh-market-scenarios button { min-height: 28px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); border-radius: 999px; color: var(--dsw-alias-label-secondary, #999); background: transparent; cursor: pointer; font-size: 11px; }
.dsh-market-scenarios button.is-active { color: #fff; border-color: color-mix(in srgb, var(--dsh-desktop-accent, #4f8cff) 55%, transparent); background: color-mix(in srgb, var(--dsh-desktop-accent, #4f8cff) 28%, transparent); }
.dsh-market-picks { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.dsh-market-picks li { padding: 10px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); border-radius: 8px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, #222224) 80%, transparent); display: grid; gap: 6px; }
.dsh-market-toolbar { display: flex; gap: 8px; align-items: center; }
.dsh-market-toolbar input { min-width: 0; flex: 1; height: 34px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.24)); border-radius: 8px; color: inherit; background: var(--dsw-alias-bg-layer-1, #171719); }
.dsh-market-ghost { height: 34px; padding: 0 10px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.24)); border-radius: 8px; color: inherit; background: transparent; cursor: pointer; }
.dsh-market-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh-market-chips button { min-height: 28px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); border-radius: 999px; color: var(--dsw-alias-label-secondary, #999); background: transparent; cursor: pointer; font-size: 11px; }
.dsh-market-chips button.is-active { color: #fff; border-color: color-mix(in srgb, var(--dsh-desktop-accent, #4f8cff) 55%, transparent); background: color-mix(in srgb, var(--dsh-desktop-accent, #4f8cff) 28%, transparent); }
.dsh-market-summary, .dsh-market-warn, .dsh-market-error { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary, #999); }
.dsh-market-error { color: #f87171; }
.dsh-market-warn { color: #fbbf24; }
.dsh-market-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.dsh-market-list li { padding: 12px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, #171719); display: grid; gap: 8px; }
.dsh-market-card-head { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
.dsh-market-card-head strong { font-size: 13px; }
.dsh-market-card-head span { color: var(--dsw-alias-label-secondary, #999); font-size: 11px; }
.dsh-market-list p, .dsh-market-picks p { margin: 0; color: var(--dsw-alias-label-secondary, #bbb); font-size: 12px; line-height: 1.45; }
.dsh-market-meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--dsw-alias-label-caption, #777); font-size: 11px; }
.dsh-market-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.dsh-market-actions a, .dsh-market-actions button { min-height: 30px; padding: 0 10px; display: inline-flex; align-items: center; gap: 6px; border-radius: 7px; font: inherit; font-size: 12px; cursor: pointer; }
.dsh-market-actions a { color: inherit; text-decoration: none; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.24)); }
.dsh-market-actions button { border: 0; color: #fff; background: var(--dsh-desktop-accent, #4f8cff); }
.dsh-market-actions button:disabled { opacity: .55; cursor: default; }
.dsh-market-secondary { background: transparent !important; color: inherit !important; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.24)) !important; }
`
