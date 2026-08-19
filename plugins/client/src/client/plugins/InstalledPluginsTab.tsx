// Author: Zihan Wang
// <wangzh011031@163.com>
/**
 * Plugins settings tab: list / enable / disable / uninstall user-installed
 * packages for the web profile. Lives under the official 「插件」 section —
 * the market page only browses and installs.
 */

import ExternalLink from 'lucide-react/dist/esm/icons/external-link.mjs'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
import Store from 'lucide-react/dist/esm/icons/store.mjs'
import { useCallback, useEffect, useState } from 'react'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

export type InstalledPluginsTabProps = PropsRuntime<'settings.plugins.tab'> & PropsRenderSlots<never>

interface InstalledPackage {
  packageName: string
  version: string
  description: string
  enabled: boolean
  unregistered: boolean
  repository?: string
  entries: { id: string; disabled: boolean }[]
  error: string
}

export function InstalledPluginsTab(_props: InstalledPluginsTabProps): JSX.Element {
  const [installed, setInstalled] = useState<InstalledPackage[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadInstalled = useCallback(async (): Promise<void> => {
    const response = await fetch('/api/desktop/market/installed')
    const value = await response.json() as { ok?: boolean; packages?: InstalledPackage[]; error?: string }
    if (!response.ok || value.ok === false) throw new Error(value.error ?? '无法读取已安装插件')
    setInstalled(value.packages ?? [])
  }, [])

  useEffect(() => {
    void loadInstalled().catch(error => {
      setNotice(error instanceof Error ? error.message : String(error))
    })
  }, [loadInstalled])

  const mutate = async (body: Record<string, unknown>): Promise<void> => {
    const packageName = typeof body.packageName === 'string' ? body.packageName : ''
    setBusy(packageName)
    setNotice(null)
    try {
      const response = await fetch('/api/desktop/market/installed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const value = await response.json() as {
        ok?: boolean
        notice?: string
        packages?: InstalledPackage[]
        snapshot?: { packages?: InstalledPackage[] }
        error?: string
      }
      const packages = value.snapshot?.packages ?? value.packages
      if (packages !== undefined) setInstalled(packages)
      if (!response.ok || value.ok === false) throw new Error(value.notice ?? value.error ?? '操作失败')
      setNotice(value.notice ?? '完成。停用/卸载后请重启桌面端使其完全生效。')
      await loadInstalled()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="dsh-installed-plugins">
      <style>{INSTALLED_CSS}</style>
      <div className="dsh-installed-plugins-head">
        <Store size={16} aria-hidden="true" />
        <div>
          <strong>已安装</strong>
          <span>当前 web profile 通过 `dsh plugin add` 装入的插件（不含系统自带层）。可在此启用、停用或卸载。</span>
        </div>
        <button
          type="button"
          className="dsh-installed-ghost"
          disabled={busy !== null}
          onClick={() => {
            void loadInstalled().catch(error => setNotice(error instanceof Error ? error.message : String(error)))
          }}
        >
          <RefreshCw size={14} aria-hidden="true" />
          刷新
        </button>
      </div>
      {notice !== null ? <p className="dsh-installed-notice">{notice}</p> : null}
      {installed.length === 0 ? (
        <p className="dsh-installed-empty">还没有用户插件。可到「插件市场」浏览并安装。</p>
      ) : (
        <ul className="dsh-installed-list">
          {installed.map(item => (
            <li key={item.packageName}>
              <div className="dsh-installed-card-head">
                <strong>{item.packageName}</strong>
                <span>
                  {item.version !== '' ? `v${item.version}` : ''}
                  {item.enabled ? ' · 已启用' : ' · 已停用'}
                  {item.unregistered ? ' · 未入 bundles' : ''}
                </span>
              </div>
              <p>{item.description || '（无简介）'}</p>
              {item.error !== '' ? <p className="dsh-installed-error">{item.error}</p> : null}
              <div className="dsh-installed-actions">
                {item.repository !== undefined ? (
                  <a href={`https://github.com/${item.repository}`} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} aria-hidden="true" />
                    GitHub
                  </a>
                ) : null}
                <button
                  type="button"
                  className="dsh-installed-secondary"
                  disabled={busy === item.packageName || item.unregistered}
                  onClick={() => {
                    void mutate({
                      action: 'set-enabled',
                      packageName: item.packageName,
                      enabled: !item.enabled,
                    })
                  }}
                >
                  {busy === item.packageName ? '处理中…' : item.enabled ? '停用' : '启用'}
                </button>
                <button
                  type="button"
                  className="dsh-installed-danger"
                  disabled={busy === item.packageName}
                  onClick={() => {
                    if (!window.confirm(`卸载 ${item.packageName}？\n会在 profile 目录执行 pnpm remove，并需重启后完全生效。`)) return
                    void mutate({ action: 'uninstall', packageName: item.packageName })
                  }}
                >
                  卸载
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const INSTALLED_CSS = `
.dsh-installed-plugins { display: grid; gap: 12px; padding: 4px 2px 12px; color: var(--dsw-alias-label-primary, #f2f2f3); }
.dsh-installed-plugins-head { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px; }
.dsh-installed-plugins-head > div { flex: 1; min-width: 180px; display: grid; gap: 4px; }
.dsh-installed-plugins-head strong { font-size: 13px; }
.dsh-installed-plugins-head span { color: var(--dsw-alias-label-secondary, #999); font-size: 11px; line-height: 1.45; }
.dsh-installed-ghost { margin-left: auto; height: 32px; padding: 0 10px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.24)); border-radius: 8px; color: inherit; background: transparent; cursor: pointer; }
.dsh-installed-ghost:disabled { opacity: .55; cursor: default; }
.dsh-installed-notice, .dsh-installed-empty { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary, #999); }
.dsh-installed-error { margin: 0; font-size: 12px; color: #f87171; }
.dsh-installed-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.dsh-installed-list li { padding: 12px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, #171719); display: grid; gap: 8px; }
.dsh-installed-card-head { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
.dsh-installed-card-head strong { font-size: 13px; }
.dsh-installed-card-head span { color: var(--dsw-alias-label-secondary, #999); font-size: 11px; }
.dsh-installed-list p { margin: 0; color: var(--dsw-alias-label-secondary, #bbb); font-size: 12px; line-height: 1.45; }
.dsh-installed-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.dsh-installed-actions a, .dsh-installed-actions button { min-height: 30px; padding: 0 10px; display: inline-flex; align-items: center; gap: 6px; border-radius: 7px; font: inherit; font-size: 12px; cursor: pointer; }
.dsh-installed-actions a { color: inherit; text-decoration: none; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.24)); }
.dsh-installed-actions button { border: 0; color: #fff; background: var(--dsh-desktop-accent, #4f8cff); }
.dsh-installed-actions button:disabled { opacity: .55; cursor: default; }
.dsh-installed-secondary { background: transparent !important; color: inherit !important; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.24)) !important; }
.dsh-installed-danger { background: color-mix(in srgb, #ef4444 82%, #000) !important; }
`
