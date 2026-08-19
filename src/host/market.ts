// Author: Zihan Wang
// <wangzh011031@163.com>
/**
 * Curated plugin market catalog from awesome-dsh-plugin `market.json`.
 * Host-side parse/validation only — install never runs here.
 */

export const MARKET_FILE_NAME = 'dsh-desktop-market.json'
export const DEFAULT_CATALOG_BASE = 'https://raw.githubusercontent.com/bruc3van/awesome-dsh-plugin/main/data'
export const GITEE_CATALOG_BASE = 'https://gitee.com/bruc3van/awesome-dsh-plugin/raw/main/data'
/** Show every validated row from the published file (upstream soft cap ≈ 600). */
export const DEFAULT_MARKET_SIZE = 600
export const DEFAULT_PROFILE = 'web'

const SCHEMA_VERSION = 1
const DESCRIPTION_LIMIT = 300
const REPOSITORY_SLUG = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const BRANCH_SAFE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

export interface MarketPlugin {
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

export interface MarketCategory {
  key: string
  zh: string
  en: string
  count: number
}

export interface MarketCatalog {
  items: MarketPlugin[]
  categories: MarketCategory[]
  fetchedAt: string
  refreshedAt: string
  scanned: number
}

export interface MarketState {
  enabled: boolean
  /** Bump when truncation / wire rules change so stale local caches refetch. */
  catalogVersion: number
  marketEtag: string
  activeBase: string
  catalog: MarketCatalog | null
}

/** Invalidate local caches that were truncated at the old 200-row default. */
export const CATALOG_VERSION = 2

export const EMPTY_MARKET: MarketState = {
  enabled: false,
  catalogVersion: CATALOG_VERSION,
  marketEtag: '',
  activeBase: '',
  catalog: null,
}

/** Parse durable market settings + optional cached catalog. */
export function parseMarketState(value: unknown): MarketState {
  if (typeof value !== 'object' || value === null) return { ...EMPTY_MARKET }
  const candidate = value as Record<string, unknown>
  const catalogVersion = typeof candidate.catalogVersion === 'number' ? Math.floor(candidate.catalogVersion) : 0
  const catalog = catalogVersion === CATALOG_VERSION ? parseCatalog(candidate.catalog) : null
  return {
    enabled: candidate.enabled === true,
    catalogVersion: CATALOG_VERSION,
    marketEtag: catalog === null ? '' : (typeof candidate.marketEtag === 'string' ? candidate.marketEtag.slice(0, 256) : ''),
    activeBase: catalog === null ? '' : (typeof candidate.activeBase === 'string' ? candidate.activeBase.slice(0, 512) : ''),
    catalog,
  }
}

/** Validate and truncate a published market.json body. */
export function deriveMarket(body: unknown, marketSize: number = DEFAULT_MARKET_SIZE): MarketCatalog {
  const envelope = body as {
    schema_version?: unknown
    entries?: unknown
    source_fetched_at?: unknown
    source_repo_count?: unknown
  }
  if (envelope.schema_version !== SCHEMA_VERSION) {
    const version = envelope.schema_version === undefined ? 'absent' : String(envelope.schema_version)
    throw new Error(`unsupported market.json schema version ${version}`)
  }
  const rows = Array.isArray(envelope.entries) ? envelope.entries as Record<string, unknown>[] : []
  if (rows.length === 0) throw new Error('the published market carried no entries')

  const items: MarketPlugin[] = []
  const knownNames = new Set<string>()
  for (const row of rows) {
    const fullName = repositorySlug(row.full_name)
    if (fullName === null || knownNames.has(fullName)) continue
    knownNames.add(fullName)
    const category = text(row.category, 60)
    if (category === '') continue
    const slash = fullName.indexOf('/')
    items.push({
      fullName,
      owner: fullName.slice(0, slash),
      name: fullName.slice(slash + 1),
      url: `https://github.com/${fullName}`,
      description: text(row.description, DESCRIPTION_LIMIT),
      stars: count(row.stargazers_count),
      language: text(row.language, 40),
      license: text(row.license, 40),
      pushedAt: text(row.pushed_at, 30),
      defaultBranch: branchName(row.default_branch),
      category,
      categoryZh: text(row.category_zh, 60) || category,
      categoryEn: text(row.category_en, 60) || category,
    })
  }
  if (items.length === 0) throw new Error('the published market carried no valid entries')

  const cut = items.slice(0, Math.max(1, Math.min(600, marketSize)))
  const categories: MarketCategory[] = []
  for (const item of cut) {
    const known = categories.find(entry => entry.key === item.category)
    if (known === undefined) categories.push({ key: item.category, zh: item.categoryZh, en: item.categoryEn, count: 1 })
    else known.count += 1
  }
  categories.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))

  return {
    items: cut,
    categories,
    fetchedAt: text(envelope.source_fetched_at, 40),
    refreshedAt: new Date().toISOString(),
    scanned: count(envelope.source_repo_count) || rows.length,
  }
}

function parseCatalog(value: unknown): MarketCatalog | null {
  if (typeof value !== 'object' || value === null) return null
  try {
    const candidate = value as MarketCatalog
    if (!Array.isArray(candidate.items) || candidate.items.length === 0) return null
    return deriveMarket({
      schema_version: SCHEMA_VERSION,
      entries: candidate.items.map(item => ({
        full_name: item.fullName,
        description: item.description,
        stargazers_count: item.stars,
        language: item.language,
        license: item.license,
        pushed_at: item.pushedAt,
        default_branch: item.defaultBranch,
        category: item.category,
        category_zh: item.categoryZh,
        category_en: item.categoryEn,
      })),
      source_fetched_at: candidate.fetchedAt,
      source_repo_count: candidate.scanned,
    }, candidate.items.length)
  } catch {
    return null
  }
}

function text(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.replace(/\s+/g, ' ').trim()
  const points = [...trimmed]
  return points.length > limit ? `${points.slice(0, limit - 1).join('')}…` : trimmed
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function repositorySlug(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return REPOSITORY_SLUG.test(value) ? value : null
}

function branchName(value: unknown): string {
  if (typeof value !== 'string') return 'main'
  const trimmed = text(value, 100)
  if (trimmed === '' || !BRANCH_SAFE.test(trimmed) || trimmed.includes('..') || trimmed.includes('//')) return 'main'
  if (trimmed.endsWith('/') || trimmed.endsWith('.')) return 'main'
  const parts = trimmed.split('/')
  if (parts.some(part => part === '.' || part.endsWith('.lock'))) return 'main'
  return trimmed
}

/** Whether a branch name is safe to interpolate into a review prompt. */
export function isSafeBranchName(value: string): boolean {
  return branchName(value) === value
}
