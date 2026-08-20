/** General-settings row for GitHub Release based application updates. */

import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check-big.mjs'
import Download from 'lucide-react/dist/esm/icons/download.mjs'
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.mjs'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.mjs'
import { useCallback, useEffect, useState } from 'react'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { BROWSER_UPDATE_STATE } from './update-api.ts'
import type { DesktopUpdateState } from './update-api.ts'

export type UpdateSettingProps = PropsRuntime<'settings.general.item'> & PropsRenderSlots<never>

export function UpdateSetting(_props: UpdateSettingProps): JSX.Element {
  const [state, setState] = useState<DesktopUpdateState>(BROWSER_UPDATE_STATE)
  const [actionError, setActionError] = useState<string | null>(null)
  const api = window.dshDesktop

  useEffect(() => {
    if (api === undefined) return
    let active = true
    const dispose = api.onUpdateState(next => {
      if (active) {
        setState(next)
        setActionError(null)
      }
    })
    void api.getUpdateState().then(next => {
      if (active) setState(next)
    }).catch(error => {
      if (active) setActionError(errorText(error))
    })
    return () => {
      active = false
      dispose()
    }
  }, [api])

  const run = useCallback(async (action: 'check' | 'download' | 'releases'): Promise<void> => {
    if (api === undefined) return
    setActionError(null)
    const result = action === 'check'
      ? await api.checkForUpdates()
      : action === 'download'
        ? await api.downloadUpdate()
        : await api.openReleasePage()
    if (!result.ok) setActionError(result.error)
  }, [api])

  const action = primaryAction(state)
  const busy = state.phase === 'checking' || state.phase === 'downloading'
  return (
    <div className="dsh-update-setting">
      <style>{UPDATE_SETTING_CSS}</style>
      <span className={`dsh-update-setting-icon is-${state.phase}`}>{statusIcon(state)}</span>
      <span className="dsh-update-setting-copy">
        <strong>应用更新</strong>
        <small>{actionError ?? statusText(state)}</small>
        {state.phase === 'downloading' ? (
          <span className="dsh-update-progress" aria-label={`下载进度 ${String(Math.round(state.progressPercent ?? 0))}%`}>
            <i style={{ width: `${String(state.progressPercent ?? 0)}%` }} />
          </span>
        ) : null}
      </span>
      <span className="dsh-update-setting-actions">
        {action.kind === 'install' ? (
          <button type="button" onClick={() => { api?.installUpdate() }}><RotateCcw size={13} />{action.label}</button>
        ) : action.kind === 'disabled' ? (
          <button type="button" disabled>{action.label}</button>
        ) : (
          <button type="button" disabled={busy || api === undefined} onClick={() => { void run(action.kind) }}>
            {action.kind === 'download' ? <Download size={13} /> : action.kind === 'releases' ? <ExternalLink size={13} /> : <RefreshCw size={13} className={busy ? 'is-spinning' : undefined} />}
            {action.label}
          </button>
        )}
        {state.phase === 'error' && api !== undefined ? (
          <button type="button" className="is-icon" aria-label="打开 GitHub Releases" title="GitHub Releases" onClick={() => { void run('releases') }}>
            <ExternalLink size={14} />
          </button>
        ) : null}
      </span>
    </div>
  )
}

type UpdateAction =
  | { kind: 'check' | 'download' | 'releases'; label: string }
  | { kind: 'install'; label: string }
  | { kind: 'disabled'; label: string }

export function primaryAction(state: DesktopUpdateState): UpdateAction {
  if (state.phase === 'unsupported') return { kind: 'releases', label: '下载安装包' }
  if (state.phase === 'available') return { kind: 'download', label: '下载更新' }
  if (state.phase === 'downloaded') return { kind: 'install', label: '重启并安装' }
  if (state.phase === 'checking') return { kind: 'disabled', label: '检查中…' }
  if (state.phase === 'downloading') return { kind: 'disabled', label: `${String(Math.round(state.progressPercent ?? 0))}%` }
  return { kind: 'check', label: '检查更新' }
}

function statusIcon(state: DesktopUpdateState): JSX.Element {
  if (state.phase === 'available' || state.phase === 'downloading') return <Download size={15} aria-hidden="true" />
  if (state.phase === 'downloaded' || state.phase === 'not-available') return <CheckCircle2 size={15} aria-hidden="true" />
  return <RefreshCw size={15} className={state.phase === 'checking' ? 'is-spinning' : undefined} aria-hidden="true" />
}

function statusText(state: DesktopUpdateState): string {
  const current = `当前 ${versionLabel(state.currentVersion)}`
  if (state.phase === 'unsupported') return state.message ?? current
  if (state.phase === 'idle') return current
  if (state.phase === 'checking') return `正在检查更新 · ${current}`
  if (state.phase === 'available') return `发现 ${versionLabel(state.availableVersion ?? '')} · ${current}`
  if (state.phase === 'not-available') return `${current}，已是最新版本`
  if (state.phase === 'downloading') return `正在下载 ${versionLabel(state.availableVersion ?? '')}`
  if (state.phase === 'downloaded') return `${versionLabel(state.availableVersion ?? '')} 已准备好`
  return state.message ?? '检查更新失败'
}

function versionLabel(value: string): string {
  if (value === '' || value === '开发预览') return value
  return value.startsWith('v') ? value : `v${value}`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const UPDATE_SETTING_CSS = `
.dsh-update-setting { min-height: 48px; display: grid; grid-template-columns: 22px minmax(0,1fr) auto; align-items: center; gap: 10px; color: var(--dsw-alias-label-primary); }
.dsh-update-setting-icon { width: 22px; height: 22px; display: grid; place-items: center; color: var(--dsw-alias-label-tertiary); }
.dsh-update-setting-icon.is-available, .dsh-update-setting-icon.is-downloading { color: var(--dsh-desktop-accent,var(--dsw-alias-state-business-primary)); }
.dsh-update-setting-icon.is-downloaded, .dsh-update-setting-icon.is-not-available { color: #43c880; }
.dsh-update-setting-icon.is-error { color: #ef7772; }
.dsh-update-setting-copy { min-width: 0; display: grid; gap: 2px; }
.dsh-update-setting-copy strong { font-size: 13px; line-height: 18px; font-weight: 500; letter-spacing: 0; }
.dsh-update-setting-copy small { overflow: hidden; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
.dsh-update-setting-actions { display: inline-flex; align-items: center; gap: 5px; }
.dsh-update-setting-actions button { min-width: 90px; height: 30px; padding: 0 10px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); font: 11px/16px inherit; cursor: pointer; white-space: nowrap; }
.dsh-update-setting-actions button:hover:not(:disabled), .dsh-update-setting-actions button:focus-visible { border-color: color-mix(in srgb,var(--dsh-desktop-accent,#4f8cff) 48%,var(--dsw-alias-border-l2)); outline: none; background: var(--dsw-alias-interactive-bg-hover); }
.dsh-update-setting-actions button:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.dsh-update-setting-actions button.is-icon { min-width: 30px; width: 30px; padding: 0; }
.dsh-update-progress { width: min(280px,100%); height: 2px; overflow: hidden; border-radius: 1px; background: var(--dsw-alias-fill-tertiary,rgba(127,127,127,.18)); }
.dsh-update-progress i { height: 100%; display: block; background: var(--dsh-desktop-accent,var(--dsw-alias-state-business-primary)); transition: width .18s ease; }
.dsh-update-setting .is-spinning { animation: dsh-update-spin .8s linear infinite; }
@keyframes dsh-update-spin { to { transform: rotate(360deg); } }
@media (max-width: 560px) { .dsh-update-setting { grid-template-columns: 22px minmax(0,1fr); } .dsh-update-setting-actions { grid-column: 2; justify-self: start; } .dsh-update-setting-copy small { white-space: normal; } }
@media (prefers-reduced-motion: reduce) { .dsh-update-setting .is-spinning { animation: none; } .dsh-update-progress i { transition: none; } }
`
