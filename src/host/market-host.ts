// Author: Zihan Wang
// <wangzh011031@163.com>
/**
 * Plugin market host: opt-in catalog fetch from awesome-dsh-plugin.
 * Never installs packages — the client stages a review prompt for the agent.
 */

import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  DEFAULT_CATALOG_BASE,
  DEFAULT_MARKET_SIZE,
  DEFAULT_PROFILE,
  deriveMarket,
  EMPTY_MARKET,
  GITEE_CATALOG_BASE,
  MARKET_FILE_NAME,
  parseMarketState,
  type MarketCatalog,
  type MarketState,
} from './market.ts'
import {
  installDirect,
  listInstalled,
  setInstalledEnabled,
  uninstallInstalled,
} from './installed.ts'

export const name = 'desktop-market'
export const inject = ['webServer']

const MAX_BODY_BYTES = 8 * 1024
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000
const FETCH_TIMEOUT_MS = 20_000

/** Serve market settings and the curated catalog. */
export function apply(ctx: Context): void {
  const filePath = join(resolveDshHome(), MARKET_FILE_NAME)
  let state = parseMarketState(readStateFile(filePath))
  let persistenceQueue: Promise<void> = Promise.resolve()
  let inFlight: Promise<{ catalog: MarketCatalog | null; stale: boolean; error: string }> | null = null

  const persist = (next: MarketState): Promise<void> => {
    state = next
    const queued = persistenceQueue.then(async () => {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    })
    persistenceQueue = queued.catch(() => {})
    return queued
  }

  const readCatalog = async (force: boolean): Promise<{ catalog: MarketCatalog | null; stale: boolean; error: string }> => {
    if (!state.enabled) return { catalog: null, stale: false, error: 'market disabled' }
    if (!force && fresh(state.catalog) && state.catalog !== null) {
      return { catalog: state.catalog, stale: false, error: '' }
    }
    inFlight ??= (async () => {
      try {
        const catalog = await refreshCatalog(
          () => state,
          async next => { await persist(next) },
        )
        return { catalog, stale: false, error: '' }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (state.catalog !== null) return { catalog: state.catalog, stale: true, error: message }
        return { catalog: null, stale: false, error: message }
      } finally {
        inFlight = null
      }
    })()
    return await inFlight
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/desktop/market',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          writeJson(res, 200, {
            enabled: state.enabled,
            profile: DEFAULT_PROFILE,
            hasCache: state.catalog !== null,
          })
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }
        const body = await readJson(req)
        if (typeof body.enabled !== 'boolean') {
          writeJson(res, 400, { ok: false, error: '无效的市场请求。' })
          return
        }
        await persist({ ...state, enabled: body.enabled })
        writeJson(res, 200, { ok: true, enabled: state.enabled, profile: DEFAULT_PROFILE })
      } catch (error) {
        ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        writeJson(res, 500, { ok: false, error: '无法更新市场设置。' })
      }
    },
  }), 'desktop-market:settings')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/desktop/market/catalog',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      try {
        if (!state.enabled) {
          writeJson(res, 403, { ok: false, error: '市场未启用。', enabled: false })
          return
        }
        const force = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('force') === '1'
        const result = await readCatalog(force)
        writeJson(res, 200, { ok: true, enabled: true, ...result })
      } catch (error) {
        ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        writeJson(res, 500, { ok: false, error: '无法读取插件目录。' })
      }
    },
  }), 'desktop-market:catalog')

  // Installed plugins are local profile facts — available even when the market catalog is off.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/desktop/market/installed',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          writeJson(res, 200, { ok: true, ...listInstalled(DEFAULT_PROFILE) })
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end()
          return
        }
        const body = await readJson(req)
        if (body.action === 'set-enabled'
          && typeof body.packageName === 'string'
          && typeof body.enabled === 'boolean') {
          const result = await setInstalledEnabled(body.packageName, body.enabled, DEFAULT_PROFILE)
          writeJson(res, result.ok ? 200 : 400, result)
          return
        }
        if (body.action === 'uninstall' && typeof body.packageName === 'string') {
          const result = await uninstallInstalled(body.packageName, DEFAULT_PROFILE)
          writeJson(res, result.ok ? 200 : 400, result)
          return
        }
        if (body.action === 'install-direct'
          && (typeof body.fullName === 'string' || typeof body.packageName === 'string')) {
          const result = await installDirect({
            ...(typeof body.fullName === 'string' ? { fullName: body.fullName } : {}),
            ...(typeof body.packageName === 'string' ? { packageName: body.packageName } : {}),
          }, DEFAULT_PROFILE)
          writeJson(res, result.ok ? 200 : 400, result)
          return
        }
        writeJson(res, 400, { ok: false, error: '无效的已安装插件请求。', ...listInstalled(DEFAULT_PROFILE) })
      } catch (error) {
        ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        writeJson(res, 500, { ok: false, error: '无法管理已安装插件。' })
      }
    },
  }), 'desktop-market:installed')
}

function fresh(catalog: MarketCatalog | null): boolean {
  if (catalog === null) return false
  const at = Date.parse(catalog.refreshedAt)
  return Number.isFinite(at) && Date.now() - at < REFRESH_INTERVAL_MS
}

async function refreshCatalog(
  getState: () => MarketState,
  persist: (next: MarketState) => Promise<void>,
): Promise<MarketCatalog> {
  const primary = DEFAULT_CATALOG_BASE
  const chain = [primary, GITEE_CATALOG_BASE]
  const current = getState()
  const ordered = current.activeBase !== '' && chain.includes(current.activeBase)
    ? [current.activeBase, ...chain.filter(base => base !== current.activeBase)]
    : chain
  const failures: string[] = []
  for (const base of ordered) {
    try {
      return await attempt(base, getState, persist, primary)
    } catch (error) {
      failures.push(`${hostLabel(base)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(failures.join('; '))
}

async function attempt(
  base: string,
  getState: () => MarketState,
  persist: (next: MarketState) => Promise<void>,
  primary: string,
): Promise<MarketCatalog> {
  const state = getState()
  const marketUrl = `${base.replace(/\/+$/, '')}/market.json`
  const conditional = state.catalog !== null && state.marketEtag !== ''
    && (state.activeBase === '' ? base === primary : state.activeBase === base)
  const init: RequestInit = conditional
    ? { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'if-none-match': state.marketEtag } }
    : { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  const response = await fetch(marketUrl, init)
  if (response.status === 304) {
    if (state.catalog === null) throw new Error('catalog HTTP 304')
    const catalog = { ...state.catalog, refreshedAt: new Date().toISOString() }
    await persist({ ...getState(), catalog, activeBase: base })
    return catalog
  }
  if (!response.ok) throw new Error(`catalog HTTP ${String(response.status)}`)
  const catalog = deriveMarket(await response.json(), DEFAULT_MARKET_SIZE)
  await persist({
    ...getState(),
    catalog,
    marketEtag: response.headers.get('etag') ?? '',
    activeBase: base,
  })
  return catalog
}

function hostLabel(base: string): string {
  try {
    return new URL(base).host
  } catch {
    return base
  }
}

function readStateFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return EMPTY_MARKET
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  return parsed as Record<string, unknown>
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`, 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
  })
  res.end(payload)
}
