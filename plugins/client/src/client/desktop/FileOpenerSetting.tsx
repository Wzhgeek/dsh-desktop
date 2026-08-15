/** General-settings row for the preferred local file application. */

import ExternalLink from 'lucide-react/dist/esm/icons/external-link.mjs'
import { useEffect, useState } from 'react'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  DESKTOP_FILE_OPENERS,
  FILE_OPENER_CHANGE_EVENT,
  getPreferredFileOpener,
  normalizeFileOpener,
  setPreferredFileOpener,
} from './file-openers.ts'

export type FileOpenerSettingProps = PropsRuntime<'settings.general.item'> & PropsRenderSlots<never>

/** Render a compact setting that stays synchronized with inline path menus. */
export function FileOpenerSetting(_props: FileOpenerSettingProps): JSX.Element {
  const [opener, setOpener] = useState(getPreferredFileOpener)

  useEffect(() => {
    const sync = (event: Event): void => {
      if (event instanceof CustomEvent) setOpener(normalizeFileOpener(event.detail))
    }
    window.addEventListener(FILE_OPENER_CHANGE_EVENT, sync)
    return () => { window.removeEventListener(FILE_OPENER_CHANGE_EVENT, sync) }
  }, [])

  return (
    <div className="dsh-file-opener-setting">
      <style>{FILE_OPENER_SETTING_CSS}</style>
      <span className="dsh-file-opener-setting-icon"><ExternalLink size={15} aria-hidden="true" /></span>
      <label htmlFor="dsh-file-opener-select">文件打开方式</label>
      <select
        id="dsh-file-opener-select"
        value={opener}
        onChange={event => {
          const next = normalizeFileOpener(event.currentTarget.value)
          setOpener(next)
          setPreferredFileOpener(next)
        }}
      >
        {DESKTOP_FILE_OPENERS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  )
}

const FILE_OPENER_SETTING_CSS = `
.dsh-file-opener-setting { min-height: 36px; display: grid; grid-template-columns: 22px minmax(0,1fr) minmax(150px,220px); align-items: center; gap: 10px; color: var(--dsw-alias-label-primary); }
.dsh-file-opener-setting-icon { width: 22px; height: 22px; display: grid; place-items: center; color: var(--dsw-alias-label-tertiary); }
.dsh-file-opener-setting label { font-size: 13px; line-height: 20px; }
.dsh-file-opener-setting select { box-sizing: border-box; width: 100%; height: 32px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; outline: none; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); font: 12px/18px inherit; }
.dsh-file-opener-setting select:focus-visible { border-color: var(--dsh-desktop-accent, var(--dsw-alias-state-business-primary)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsh-desktop-accent, #4f8cff) 18%, transparent); }
@media (max-width: 560px) { .dsh-file-opener-setting { grid-template-columns: 22px minmax(0,1fr); } .dsh-file-opener-setting select { grid-column: 2; } }
`
