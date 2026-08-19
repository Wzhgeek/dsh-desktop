// Author: Zihan Wang
// <wangzh011031@163.com>
/** General-settings row for the global show-window shortcut. */

import Keyboard from 'lucide-react/dist/esm/icons/keyboard.mjs'
import { useEffect, useState } from 'react'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { EMPTY_SHELL_STATE } from './shell-api.ts'
import type { DesktopShellState } from './shell-api.ts'
import { acceleratorFromKeyboardEvent } from './accelerators.ts'

export type ShortcutSettingProps = PropsRuntime<'settings.general.item'> & PropsRenderSlots<never>

/** Capture a new global shortcut without leaving the General settings page. */
export function ShortcutSetting(_props: ShortcutSettingProps): JSX.Element {
  const [shell, setShell] = useState<DesktopShellState>(EMPTY_SHELL_STATE)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const api = window.dshDesktop

  useEffect(() => {
    if (api === undefined) return
    let active = true
    const dispose = api.onShellState(next => {
      if (active) {
        setShell(next)
        setError(null)
      }
    })
    void api.getShellState().then(next => {
      if (active) setShell(next)
    }).catch(caught => {
      if (active) setError(caught instanceof Error ? caught.message : String(caught))
    })
    return () => {
      active = false
      dispose()
    }
  }, [api])

  useEffect(() => {
    if (!recording) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setRecording(false)
        return
      }
      const accelerator = acceleratorFromKeyboardEvent(event)
      if (accelerator === undefined) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      setRecording(false)
      if (api === undefined) {
        setError('请在桌面应用中设置快捷键。')
        return
      }
      void api.setShowWindowAccelerator(accelerator).then(result => {
        if (!result.ok) setError(result.error)
      }).catch(caught => {
        setError(caught instanceof Error ? caught.message : String(caught))
      })
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [api, recording])

  return (
    <div className="dsh-shortcut-setting">
      <style>{SHORTCUT_SETTING_CSS}</style>
      <span className="dsh-shortcut-setting-icon"><Keyboard size={15} aria-hidden="true" /></span>
      <div className="dsh-shortcut-setting-copy">
        <span>唤出窗口快捷键</span>
        {error === null ? null : <small>{error}</small>}
      </div>
      <button
        type="button"
        className={recording ? 'is-recording' : undefined}
        aria-pressed={recording}
        onClick={() => {
          setError(null)
          setRecording(value => !value)
        }}
      >
        {recording ? '按下组合键…' : shell.acceleratorLabel}
      </button>
    </div>
  )
}

const SHORTCUT_SETTING_CSS = `
.dsh-shortcut-setting { min-height: 36px; display: grid; grid-template-columns: 22px minmax(0,1fr) minmax(150px,220px); align-items: center; gap: 10px; color: var(--dsw-alias-label-primary); }
.dsh-shortcut-setting-icon { width: 22px; height: 22px; display: grid; place-items: center; color: var(--dsw-alias-label-tertiary); }
.dsh-shortcut-setting-copy { min-width: 0; display: grid; gap: 2px; }
.dsh-shortcut-setting-copy span { font-size: 13px; line-height: 20px; }
.dsh-shortcut-setting-copy small { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
.dsh-shortcut-setting button { box-sizing: border-box; width: 100%; height: 32px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); font: 12px/18px inherit; cursor: pointer; }
.dsh-shortcut-setting button.is-recording { border-color: var(--dsh-desktop-accent, var(--dsw-alias-state-business-primary)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsh-desktop-accent, #4f8cff) 18%, transparent); }
.dsh-shortcut-setting button:focus-visible { border-color: var(--dsh-desktop-accent, var(--dsw-alias-state-business-primary)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsh-desktop-accent, #4f8cff) 18%, transparent); }
@media (max-width: 560px) { .dsh-shortcut-setting { grid-template-columns: 22px minmax(0,1fr); } .dsh-shortcut-setting button { grid-column: 2; } }
`
