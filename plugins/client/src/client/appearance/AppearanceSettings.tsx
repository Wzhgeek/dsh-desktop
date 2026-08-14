/**
 * Appearance settings page: font family, font size, accent color, and code
 * highlighting theme. Reads the desktop appearance preference from the host
 * endpoint on mount and writes it back on every change; the host persists the
 * preference and re-injects the CSS variables on the next index load.
 * @module @dsh-desktop/client/appearance/AppearanceSettings
 */

import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Composed section props: the settings owner share plus the global seat. */
export type AppearanceSettingsProps = PropsRuntime<'settings.section'> & PropsRenderSlots<never>

/** Wire envelope mirrored from the host appearance preference. */
export interface AppearancePrefs {
  /** CSS font-family list for the application body. */
  fontFamily: string
  /** Body font size in px. */
  fontSize: number
  /** Accent color (a hex CSS color). */
  accentColor: string
  /** One key of the host code-theme presets. */
  codeTheme: string
}

/** Defaults shown while the host preference is still loading. */
const DEFAULT_PREFS: AppearancePrefs = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  fontSize: 14,
  accentColor: '#4f46e5',
  codeTheme: 'github',
}

/** Selectable font-family lists (values are CSS-safe, matching the host sanitizer). */
const FONT_FAMILIES: readonly { value: string; label: string }[] = [
  { value: 'system-ui, -apple-system, "Segoe UI", sans-serif', label: 'System UI' },
  { value: 'Inter, system-ui, sans-serif', label: 'Inter' },
  { value: 'ui-serif, Georgia, "Times New Roman", serif', label: 'Serif' },
  { value: '"SF Mono", ui-monospace, Menlo, Consolas, monospace', label: 'Mono' },
]

/** Selectable body font sizes in px. */
const FONT_SIZES: readonly number[] = [12, 13, 14, 15, 16, 18, 20]

/** Quick accent-color swatches plus the native color picker. */
const ACCENT_PRESETS: readonly string[] = [
  '#4f46e5', '#2563eb', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6',
]

/** Selectable code highlighting themes (host CODE_THEMES keys). */
const CODE_THEMES: readonly { value: string; label: string }[] = [
  { value: 'github', label: 'GitHub' },
  { value: 'nord', label: 'Nord' },
  { value: 'solarized', label: 'Solarized' },
  { value: 'monokai', label: 'Monokai' },
]

/** Narrow a loaded preference to the selectable option sets. */
function normalize(prefs: AppearancePrefs): AppearancePrefs {
  const fontFamily = FONT_FAMILIES.some(f => f.value === prefs.fontFamily)
    ? prefs.fontFamily
    : DEFAULT_PREFS.fontFamily
  const fontSize = FONT_SIZES.includes(prefs.fontSize) ? prefs.fontSize : DEFAULT_PREFS.fontSize
  const accentColor = /^#[0-9a-f]{3,8}$/i.test(prefs.accentColor) ? prefs.accentColor : DEFAULT_PREFS.accentColor
  const codeTheme = CODE_THEMES.some(t => t.value === prefs.codeTheme) ? prefs.codeTheme : DEFAULT_PREFS.codeTheme
  return { fontFamily, fontSize, accentColor, codeTheme }
}

/** One labelled row: a select with a heading. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: '6px' }}>
      <div style={{ fontWeight: 500 }}>{label}</div>
      {children}
    </div>
  )
}

const selectStyle: CSSProperties = {
  padding: '6px 8px',
  borderRadius: '6px',
  border: '1px solid var(--dsw-alias-border-l1, #d0d0d0)',
  background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
  color: 'var(--dsw-alias-label-primary, #1f1f1f)',
}

/**
 * Render the Appearance section content column.
 * @param props - composed section props (close + global seat; the empty child
 * dispatch seat is unused by a leaf section).
 * @returns the section element tree.
 */
export function AppearanceSettings(_props: AppearanceSettingsProps): JSX.Element {
  const [prefs, setPrefs] = useState<AppearancePrefs>(DEFAULT_PREFS)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  useEffect(() => {
    let cancelled = false
    fetch('/api/desktop/appearance')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((value: AppearancePrefs) => {
        if (!cancelled) setPrefs(normalize({ ...DEFAULT_PREFS, ...value }))
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => { cancelled = true }
  }, [])

  const save = (next: AppearancePrefs): void => {
    setPrefs(next)
    setStatus('saving')
    fetch('/api/desktop/appearance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    })
      .then(res => (res.ok ? Promise.resolve() : Promise.reject(new Error(String(res.status)))))
      .then(() => setStatus('saved'))
      .catch(() => setStatus('error'))
  }

  const setField = <K extends keyof AppearancePrefs>(key: K, value: AppearancePrefs[K]): void => {
    save({ ...prefs, [key]: value })
  }

  return (
    <div style={{ display: 'grid', gap: '18px', maxWidth: '560px' }}>
      <Row label="Font family">
        <select
          style={selectStyle}
          value={prefs.fontFamily}
          onChange={event => setField('fontFamily', event.target.value)}
        >
          {FONT_FAMILIES.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}
        </select>
      </Row>

      <Row label="Font size">
        <select
          style={selectStyle}
          value={prefs.fontSize}
          onChange={event => setField('fontSize', Number(event.target.value))}
        >
          {FONT_SIZES.map(size => <option key={size} value={size}>{String(size)}px</option>)}
        </select>
      </Row>

      <Row label="Accent color">
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {ACCENT_PRESETS.map(color => (
            <button
              key={color}
              type="button"
              aria-label={`Accent ${color}`}
              title={color}
              onClick={() => setField('accentColor', color)}
              style={{
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                background: color,
                border: prefs.accentColor === color
                  ? '2px solid var(--dsw-alias-label-primary, #1f1f1f)'
                  : '1px solid var(--dsw-alias-border-l1, #d0d0d0)',
                cursor: 'pointer',
              }}
            />
          ))}
          <input
            type="color"
            aria-label="Custom accent color"
            value={prefs.accentColor}
            onChange={event => setField('accentColor', event.target.value)}
            style={{ width: '28px', height: '28px', border: 'none', background: 'transparent', cursor: 'pointer' }}
          />
          <span style={{ font: '12px/1 ui-monospace, Menlo, monospace', opacity: 0.7 }}>{prefs.accentColor}</span>
        </div>
      </Row>

      <Row label="Code highlighting theme">
        <select
          style={selectStyle}
          value={prefs.codeTheme}
          onChange={event => setField('codeTheme', event.target.value)}
        >
          {CODE_THEMES.map(theme => <option key={theme.value} value={theme.value}>{theme.label}</option>)}
        </select>
      </Row>

      <div style={{ font: '12px/1.4 system-ui, sans-serif', opacity: 0.7 }}>
        {status === 'saving' && 'Saving…'}
        {status === 'saved' && 'Saved. Reload the app to apply the new look.'}
        {status === 'error' && 'Failed to save the appearance preference.'}
      </div>
    </div>
  )
}
