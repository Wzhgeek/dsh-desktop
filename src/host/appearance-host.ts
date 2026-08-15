/**
 * Appearance host plugin — the desktop appearance preference surface. Serves
 * the appearance preference (font family, font size, accent color, code theme)
 * over `/api/desktop/appearance` and injects the chosen values into the served
 * index.html as CSS variables via `ctx.webServer.tapIndex`. Preferences persist
 * to a JSON file under the resolved DSH home, so a restart re-injects the same
 * variables.
 * @module @deepseek-ai/dsh-desktop/host/appearance
 */

import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: ctx.webServer type augmentation.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Stable Cordis plugin name. */
export const name = 'desktop-appearance'

/** Services required before the appearance surface can mount. */
export const inject = ['webServer']

/** Preference filename written under the resolved DSH home. */
export const APPEARANCE_FILE_NAME = 'dsh-desktop-appearance.json'

/** Smallest/largest accepted body font size, in px. */
export const MIN_FONT_SIZE = 10
/** Largest accepted body font size, in px. */
export const MAX_FONT_SIZE = 24

/** One selectable code highlighting theme. */
export interface CodeThemeDefinition {
  /** Monospace stack applied to code blocks. */
  fontFamily: string
  /** Syntax-token palette applied to Shiki-compatible code spans. */
  syntax: CodeSyntaxColors
}

/** Syntax colors shared by the persisted theme and injected CSS variables. */
export interface CodeSyntaxColors {
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

/** Built-in code highlighting themes. */
export const CODE_THEMES: Record<string, CodeThemeDefinition> = Object.freeze({
  github: Object.freeze({
    fontFamily: '"SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    syntax: Object.freeze({
      constant: '#1c7ed6', string: '#2f9e44', comment: '#868e96', keyword: '#d6336c', parameter: '#e67700',
      function: '#7950f2', stringExpression: '#2f9e44', punctuation: '#adb5bd', link: '#1971c2',
    }),
  }),
  nord: Object.freeze({
    fontFamily: 'Menlo, Monaco, Consolas, monospace',
    syntax: Object.freeze({
      constant: '#81a1c1', string: '#a3be8c', comment: '#616e88', keyword: '#b48ead', parameter: '#d08770',
      function: '#88c0d0', stringExpression: '#8fbcbb', punctuation: '#d8dee9', link: '#5e81ac',
    }),
  }),
  solarized: Object.freeze({
    fontFamily: 'Monaco, Menlo, Consolas, monospace',
    syntax: Object.freeze({
      constant: '#268bd2', string: '#2aa198', comment: '#657b83', keyword: '#859900', parameter: '#cb4b16',
      function: '#b58900', stringExpression: '#2aa198', punctuation: '#93a1a1', link: '#268bd2',
    }),
  }),
  monokai: Object.freeze({
    fontFamily: '"Courier New", Courier, monospace',
    syntax: Object.freeze({
      constant: '#ae81ff', string: '#e6db74', comment: '#75715e', keyword: '#f92672', parameter: '#fd971f',
      function: '#a6e22e', stringExpression: '#e6db74', punctuation: '#f8f8f2', link: '#66d9ef',
    }),
  }),
})

/** Durable appearance preference, also the wire envelope. */
export interface AppearancePrefs {
  /** CSS font-family list for the application body. */
  fontFamily: string
  /** Body font size in px. */
  fontSize: number
  /** Accent color (a CSS color value). */
  accentColor: string
  /** One key of {@link CODE_THEMES}. */
  codeTheme: string
}

/** Defaults applied when the preference file is absent or malformed. */
export const DEFAULT_PREFS: AppearancePrefs = Object.freeze({
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  fontSize: 14,
  accentColor: '#4f46e5',
  codeTheme: 'github',
})

/** CSS custom-property names injected by the index tap. */
export const CSS_VARIABLES = Object.freeze({
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
})

/** One DeepSeek Web typography token expressed relative to the 14px base. */
interface FontTokenDefinition {
  name: string
  size: number
  lineHeight: number
  weight: number
  style?: 'italic'
  code?: true
}

/** Typography scale used by the current DeepSeek Web bundle. */
const FONT_TOKENS: readonly FontTokenDefinition[] = Object.freeze([
  { name: 'dsw-font-markdown-h1', size: 24, lineHeight: 34, weight: 700 },
  { name: 'dsw-font-markdown-h2', size: 22, lineHeight: 32, weight: 700 },
  { name: 'dsw-font-markdown-h3', size: 20, lineHeight: 30, weight: 700 },
  { name: 'dsw-font-markdown-h4', size: 16, lineHeight: 28, weight: 600 },
  { name: 'dsw-font-markdown-base', size: 16, lineHeight: 28, weight: 400 },
  { name: 'dsw-font-markdown-base-strong', size: 16, lineHeight: 28, weight: 600 },
  { name: 'dsw-font-markdown-base-italic', size: 16, lineHeight: 28, weight: 400, style: 'italic' },
  { name: 'dsw-font-markdown-base-strong-italic', size: 16, lineHeight: 28, weight: 600, style: 'italic' },
  { name: 'dsw-font-markdown-table', size: 15, lineHeight: 25, weight: 400 },
  { name: 'dsw-font-markdown-table-head', size: 15, lineHeight: 25, weight: 500 },
  { name: 'dsw-font-markdown-small', size: 14, lineHeight: 24, weight: 400 },
  { name: 'dsw-font-markdown-small-strong', size: 14, lineHeight: 24, weight: 600 },
  { name: 'dsw-font-markdown-small-italic', size: 14, lineHeight: 24, weight: 400, style: 'italic' },
  { name: 'dsw-font-markdown-small-strong-italic', size: 14, lineHeight: 24, weight: 600, style: 'italic' },
  { name: 'dsw-font-markdown-code', size: 14, lineHeight: 22, weight: 400, code: true },
  { name: 'dsw-font-markdown-code-block', size: 13, lineHeight: 22, weight: 400, code: true },
  { name: 'dsw-font-markdown-code-block-small', size: 12, lineHeight: 18, weight: 400, code: true },
  { name: 'dsw-font-xl-24', size: 24, lineHeight: 32, weight: 600 },
  { name: 'dsw-font-l-20', size: 20, lineHeight: 28, weight: 500 },
  { name: 'dsw-font-m-18', size: 16, lineHeight: 28, weight: 500 },
  { name: 'dsw-font-base-16', size: 16, lineHeight: 24, weight: 400 },
  { name: 'dsw-font-base-strong-16', size: 16, lineHeight: 24, weight: 500 },
  { name: 'dsw-font-s-14', size: 14, lineHeight: 22, weight: 400 },
  { name: 'dsw-font-s-strong-14', size: 14, lineHeight: 22, weight: 500 },
  { name: 'dsw-font-xs-13', size: 13, lineHeight: 20, weight: 400 },
  { name: 'dsw-font-xs-strong-13', size: 13, lineHeight: 20, weight: 500 },
  { name: 'dsw-font-xxs-12', size: 12, lineHeight: 18, weight: 400 },
  { name: 'dsw-font-xxs-strong-12', size: 12, lineHeight: 18, weight: 500 },
  { name: 'dsw-font-xxxs-11', size: 11, lineHeight: 14, weight: 400 },
  { name: 'dsw-font-xxxs-strong-11', size: 11, lineHeight: 14, weight: 500 },
])

/**
 * Mount the appearance host surface: the preference GET/POST endpoint and the
 * index tap that folds the current preference into CSS variables.
 * @param ctx - plugin context carrying the webServer service.
 */
export function apply(ctx: Context): void {
  const server = ctx.webServer
  const filePath = join(resolveDshHome(), APPEARANCE_FILE_NAME)
  let prefs: AppearancePrefs = { ...DEFAULT_PREFS, ...readPrefs(filePath) }
  let persistenceQueue: Promise<void> = Promise.resolve()
  const persist = (next: AppearancePrefs): Promise<void> => {
    const queued = persistenceQueue.then(async () => {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    })
    persistenceQueue = queued.catch(() => {})
    return queued
  }

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/desktop/appearance',
    handler: (req: IncomingMessage, res: ServerResponse): void | Promise<void> => {
      if (req.method === 'GET') {
        writeJson(res, 200, prefs)
        return
      }
      if (req.method === 'POST') {
        return handlePost(ctx, req, res, (next) => { prefs = next }, persist)
      }
      res.writeHead(405)
      res.end()
    },
  }), 'desktop-appearance:route')

  ctx.effect(() => server.tapIndex((html) => html.replace(
    '</head>',
    `${buildStyleTag(prefs)}</head>`,
  )), 'desktop-appearance:index-tap')
}

/** Read and validate the persisted preference, falling back to defaults. */
function readPrefs(filePath: string): Partial<AppearancePrefs> {
  try {
    const parsed = parsePrefs(JSON.parse(readFileSync(filePath, 'utf8')) as unknown)
    return parsed ?? {}
  } catch {
    return {}
  }
}

/** Handle a POST body: validate, persist, and publish the new preference. */
async function handlePost(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
  publish: (next: AppearancePrefs) => void,
  persist: (next: AppearancePrefs) => Promise<void>,
): Promise<void> {
  const body = await readBody(req)
  let value: unknown
  try {
    value = JSON.parse(body) as unknown
  } catch {
    writeJson(res, 400, { error: 'body is not JSON' })
    return
  }
  const parsed = parsePrefs(value)
  if (parsed === undefined) {
    writeJson(res, 400, { error: 'invalid appearance preference' })
    return
  }
  publish(parsed)
  try {
    await persist(parsed)
  } catch (error) {
    ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
  }
  writeJson(res, 200, parsed)
}

/** Collect the request body as a UTF-8 string. */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Validate and clamp an unknown wire value into a persistable preference.
 * @param value - the parsed POST body or on-disk document.
 * @returns the narrowed preference, or undefined when the value is not an object.
 */
export function parsePrefs(value: unknown): AppearancePrefs | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const fontFamily = sanitizeFontFamily(record.fontFamily)
  const fontSize = sanitizeFontSize(record.fontSize)
  const accentColor = sanitizeAccentColor(record.accentColor)
  const codeTheme = sanitizeCodeTheme(record.codeTheme)
  return { fontFamily, fontSize, accentColor, codeTheme }
}

/** Narrow a wire font-family to a CSS-safe list. */
function sanitizeFontFamily(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_PREFS.fontFamily
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 200) return DEFAULT_PREFS.fontFamily
  // Only letters, digits, spaces, quotes, commas, dots, underscores, and
  // hyphens may cross into the injected <style> — anything else is rejected.
  if (!/^[\w .'",-]+$/u.test(trimmed)) return DEFAULT_PREFS.fontFamily
  return trimmed
}

/** Narrow a wire font size to the accepted integer range. */
function sanitizeFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PREFS.fontSize
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)))
}

/** Narrow a wire accent color to a hex CSS color. */
function sanitizeAccentColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value)
    ? value
    : DEFAULT_PREFS.accentColor
}

/** Narrow a wire code theme to a built-in key. */
function sanitizeCodeTheme(value: unknown): string {
  return typeof value === 'string' && value in CODE_THEMES ? value : DEFAULT_PREFS.codeTheme
}

/** Write a JSON response body. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Build the <style> fragment folding the preference into CSS variables. */
export function buildStyleTag(prefs: AppearancePrefs): string {
  const codeTheme = CODE_THEMES[prefs.codeTheme] ?? CODE_THEMES.github
  const codeFont = codeTheme?.fontFamily ?? 'monospace'
  const syntax = codeTheme?.syntax ?? CODE_THEMES.github?.syntax
  const v = CSS_VARIABLES
  return `<style id="dsh-desktop-appearance">
:root{
${v.font}:${prefs.fontFamily};
${v.size}:${String(prefs.fontSize)}px;
${v.accent}:${prefs.accentColor};
${v.codeFont}:${codeFont};
${v.codeConstant}:${syntax?.constant ?? '#1c7ed6'};
${v.codeString}:${syntax?.string ?? '#2f9e44'};
${v.codeComment}:${syntax?.comment ?? '#868e96'};
${v.codeKeyword}:${syntax?.keyword ?? '#d6336c'};
${v.codeParameter}:${syntax?.parameter ?? '#e67700'};
${v.codeFunction}:${syntax?.function ?? '#7950f2'};
${v.codeStringExpression}:${syntax?.stringExpression ?? '#2f9e44'};
${v.codePunctuation}:${syntax?.punctuation ?? '#adb5bd'};
${v.codeLink}:${syntax?.link ?? '#1971c2'};
--dsw-font-family:var(${v.font});
--ds-font-family-code:var(${v.codeFont});
--shiki-token-constant:var(${v.codeConstant});
--shiki-token-string:var(${v.codeString});
--shiki-token-comment:var(${v.codeComment});
--shiki-token-keyword:var(${v.codeKeyword});
--shiki-token-parameter:var(${v.codeParameter});
--shiki-token-function:var(${v.codeFunction});
--shiki-token-string-expression:var(${v.codeStringExpression});
--shiki-token-punctuation:var(${v.codePunctuation});
--shiki-token-link:var(${v.codeLink});
}
body,body[data-ds-dark-theme]{
--dsw-alias-brand-primary:var(${v.accent});
--dsw-alias-brand-text:var(${v.accent});
--dsw-alias-state-business-primary:var(${v.accent});
--dsw-alias-state-business-tertiary:color-mix(in srgb,var(${v.accent}) 18%,transparent);
--dsw-alias-button-info-fill:var(${v.accent});
--dsw-alias-button-info-hover:color-mix(in srgb,var(${v.accent}) 84%,black);
--dsw-alias-button-primary-fill:var(${v.accent});
--dsw-alias-button-primary-hover:var(${v.accent});
--dsw-alias-button-primary-dimmed:color-mix(in srgb,var(${v.accent}) 30%,transparent);
--dsw-alias-button-ghost-active-border:color-mix(in srgb,var(${v.accent}) 55%,transparent);
--dsw-alias-button-ghost-active-fill:color-mix(in srgb,var(${v.accent}) 18%,transparent);
--dsw-alias-button-ghost-active-hover:color-mix(in srgb,var(${v.accent}) 24%,transparent);
--dsw-alias-interactive-bg-active:color-mix(in srgb,var(${v.accent}) 14%,transparent);
--dsw-alias-interactive-bg-hover-accent:color-mix(in srgb,var(${v.accent}) 18%,transparent);
--dsw-specific-sidebar-nav-item-active-accent:color-mix(in srgb,var(${v.accent}) 18%,transparent);
${buildFontTokenOverrides(v)}
}
body{font-family:var(${v.font});font-size:var(${v.size});}
pre,code{font-family:var(${v.codeFont});}
</style>`
}

/** Build one length relative to the user-selected 14px base size. */
function relativeFontLength(base: number, sizeVariable: string): string {
  const offset = base - DEFAULT_PREFS.fontSize
  if (offset === 0) return `var(${sizeVariable})`
  return `calc(var(${sizeVariable}) ${offset > 0 ? '+' : '-'} ${String(Math.abs(offset))}px)`
}

/** Override DeepSeek Web's typography scale without targeting hashed classes. */
function buildFontTokenOverrides(variables: typeof CSS_VARIABLES): string {
  return FONT_TOKENS.map((token) => {
    const family = token.code === true ? variables.codeFont : variables.font
    const size = relativeFontLength(token.size, variables.size)
    const lineHeight = relativeFontLength(token.lineHeight, variables.size)
    const style = token.style ?? 'normal'
    return [
      `--${token.name}:${style} ${String(token.weight)} ${size}/${lineHeight} var(${family});`,
      `--${token.name}-font-family:var(${family});`,
      `--${token.name}-font-weight:${String(token.weight)};`,
      `--${token.name}-line-height:${lineHeight};`,
      `--${token.name}-font-size:${size};`,
      `--${token.name}-font-style:${style};`,
    ].join('\n')
  }).join('\n')
}
