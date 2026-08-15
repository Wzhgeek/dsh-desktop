/**
 * Appearance settings page: font family, font size, accent color, and code
 * highlighting theme. Reads the desktop appearance preference from the host
 * endpoint on mount and writes it back on every change; the host persists the
 * preference while this component updates the live CSS variables immediately.
 * @module @dsh-desktop/client/appearance/AppearanceSettings
 */

import { useEffect, useRef, useState } from 'react'
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
  { value: '"Trebuchet MS", "Avenir Next", sans-serif', label: 'Humanist' },
  { value: 'ui-serif, Georgia, "Times New Roman", serif', label: 'Serif' },
  { value: '"SF Mono", ui-monospace, Menlo, Consolas, monospace', label: 'Mono' },
]

/** Selectable body font sizes in px. */
const FONT_SIZES: readonly number[] = [12, 13, 14, 15, 16, 18, 20]

/** Quick accent-color swatches plus the native color picker. */
const ACCENT_PRESETS: readonly string[] = [
  '#4f46e5', '#2563eb', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6',
]

/** Selectable code highlighting themes (host CODE_THEMES keys), with the monospace stack each injects. */
const CODE_THEMES: readonly { value: string; label: string; fontFamily: string; syntax: CodeSyntaxColors }[] = [
  { value: 'github', label: 'GitHub', fontFamily: '"SF Mono", Menlo, Consolas, "Liberation Mono", monospace', syntax: { constant: '#1c7ed6', string: '#2f9e44', comment: '#868e96', keyword: '#d6336c', parameter: '#e67700', function: '#7950f2', stringExpression: '#2f9e44', punctuation: '#adb5bd', link: '#1971c2' } },
  { value: 'nord', label: 'Nord', fontFamily: 'Menlo, Monaco, Consolas, monospace', syntax: { constant: '#81a1c1', string: '#a3be8c', comment: '#616e88', keyword: '#b48ead', parameter: '#d08770', function: '#88c0d0', stringExpression: '#8fbcbb', punctuation: '#d8dee9', link: '#5e81ac' } },
  { value: 'solarized', label: 'Solarized', fontFamily: 'Monaco, Menlo, Consolas, monospace', syntax: { constant: '#268bd2', string: '#2aa198', comment: '#657b83', keyword: '#859900', parameter: '#cb4b16', function: '#b58900', stringExpression: '#2aa198', punctuation: '#93a1a1', link: '#268bd2' } },
  { value: 'monokai', label: 'Monokai', fontFamily: '"Courier New", Courier, monospace', syntax: { constant: '#ae81ff', string: '#e6db74', comment: '#75715e', keyword: '#f92672', parameter: '#fd971f', function: '#a6e22e', stringExpression: '#e6db74', punctuation: '#f8f8f2', link: '#66d9ef' } },
]

interface CodeSyntaxColors {
  constant: string
  string: string
  comment: string
  keyword: string
  parameter: string
  function: string
  stringExpression: string
  punctuation: string
  link: string
}

/** CSS custom-property names the host index tap also injects; kept in step here. */
const CSS_VARIABLES = {
  font: '--dsh-desktop-font',
  size: '--dsh-desktop-size',
  accent: '--dsh-desktop-accent',
  codeFont: '--dsh-desktop-code-font',
  codeConstant: '--dsh-desktop-code-constant',
  codeString: '--dsh-desktop-code-string',
  codeComment: '--dsh-desktop-code-comment',
  codeKeyword: '--dsh-desktop-code-keyword',
  codeParameter: '--dsh-desktop-code-parameter',
  codeFunction: '--dsh-desktop-code-function',
  codeStringExpression: '--dsh-desktop-code-string-expression',
  codePunctuation: '--dsh-desktop-code-punctuation',
  codeLink: '--dsh-desktop-code-link',
} as const

/**
 * Apply the preference to the live document by setting the CSS variables on
 * `:root`. The host's index tap defines the consuming rules and the restart
 * default; setting the variables here makes a change visible immediately,
 * without a reload.
 * @param prefs - the preference to apply.
 */
function applyImmediate(prefs: AppearancePrefs): void {
  const codeTheme = CODE_THEMES.find(theme => theme.value === prefs.codeTheme)
  const root = document.documentElement
  root.style.setProperty(CSS_VARIABLES.font, prefs.fontFamily)
  root.style.setProperty(CSS_VARIABLES.size, `${String(prefs.fontSize)}px`)
  root.style.setProperty(CSS_VARIABLES.accent, prefs.accentColor)
  root.style.setProperty(CSS_VARIABLES.codeFont, codeTheme?.fontFamily ?? CODE_THEMES[0]?.fontFamily ?? 'monospace')
  const syntax = codeTheme?.syntax ?? CODE_THEMES[0]?.syntax
  if (syntax !== undefined) {
    root.style.setProperty(CSS_VARIABLES.codeConstant, syntax.constant)
    root.style.setProperty(CSS_VARIABLES.codeString, syntax.string)
    root.style.setProperty(CSS_VARIABLES.codeComment, syntax.comment)
    root.style.setProperty(CSS_VARIABLES.codeKeyword, syntax.keyword)
    root.style.setProperty(CSS_VARIABLES.codeParameter, syntax.parameter)
    root.style.setProperty(CSS_VARIABLES.codeFunction, syntax.function)
    root.style.setProperty(CSS_VARIABLES.codeStringExpression, syntax.stringExpression)
    root.style.setProperty(CSS_VARIABLES.codePunctuation, syntax.punctuation)
    root.style.setProperty(CSS_VARIABLES.codeLink, syntax.link)
  }
}

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
  fontSize: 'inherit',
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
  // Set once a save succeeds, so a slow in-flight load never clobbers a newer choice.
  const saveDoneRef = useRef(false)
  const prefsRef = useRef<AppearancePrefs>(DEFAULT_PREFS)
  const saveVersionRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/desktop/appearance')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((value: AppearancePrefs) => {
        if (cancelled || saveDoneRef.current) return
        const normalized = normalize({ ...DEFAULT_PREFS, ...value })
        prefsRef.current = normalized
        setPrefs(normalized)
        applyImmediate(normalized)
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => { cancelled = true }
  }, [])

  const save = (next: AppearancePrefs): void => {
    const previous = prefsRef.current
    const version = saveVersionRef.current + 1
    saveVersionRef.current = version
    prefsRef.current = next
    setPrefs(next)
    setStatus('saving')
    applyImmediate(next)
    fetch('/api/desktop/appearance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((value: AppearancePrefs) => {
        if (version !== saveVersionRef.current) return
        const normalized = normalize({ ...next, ...value })
        prefsRef.current = normalized
        saveDoneRef.current = true
        setPrefs(normalized)
        applyImmediate(normalized)
        setStatus('saved')
      })
      .catch(() => {
        if (version !== saveVersionRef.current) return
        prefsRef.current = previous
        setPrefs(previous)
        applyImmediate(previous)
        setStatus('error')
      })
  }

  const setField = <K extends keyof AppearancePrefs>(key: K, value: AppearancePrefs[K]): void => {
    save({ ...prefsRef.current, [key]: value })
  }

  return (
    <div style={{ display: 'grid', gap: '18px', maxWidth: '560px', fontFamily: `var(${CSS_VARIABLES.font})`, fontSize: `var(${CSS_VARIABLES.size})` }}>
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
        <pre
          aria-label="Code theme preview"
          style={{
            margin: 0,
            padding: '10px 12px',
            border: '1px solid var(--dsw-alias-border-l1, #d0d0d0)',
            borderRadius: 4,
            background: 'var(--dsw-alias-markdown-code-block, rgba(127,127,127,0.08))',
            font: `13px/20px var(${CSS_VARIABLES.codeFont})`,
            overflowX: 'auto',
          }}
        >
          <span style={{ color: `var(${CSS_VARIABLES.codeKeyword})` }}>const</span>{' '}
          <span style={{ color: `var(${CSS_VARIABLES.codeFunction})` }}>accent</span>{' '}
          <span style={{ color: `var(${CSS_VARIABLES.codePunctuation})` }}>=</span>{' '}
          <span style={{ color: `var(${CSS_VARIABLES.codeString})` }}>&quot;{prefs.accentColor}&quot;</span>
          <span style={{ color: `var(${CSS_VARIABLES.codePunctuation})` }}>;</span>
        </pre>
      </Row>

      <div style={{ font: '12px/1.4 system-ui, sans-serif', opacity: 0.8, color: status === 'saved' ? `var(${CSS_VARIABLES.accent})` : undefined }}>
        {status === 'saving' && 'Saving…'}
        {status === 'saved' && 'Saved.'}
        {status === 'error' && 'Failed to save the appearance preference.'}
      </div>
    </div>
  )
}
