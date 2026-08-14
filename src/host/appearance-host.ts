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
}

/** Built-in code highlighting themes. */
export const CODE_THEMES: Record<string, CodeThemeDefinition> = Object.freeze({
  github: Object.freeze({ fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace' }),
  nord: Object.freeze({ fontFamily: '"Fira Code", "Cascadia Code", Consolas, monospace' }),
  solarized: Object.freeze({ fontFamily: 'Menlo, Consolas, "DejaVu Sans Mono", monospace' }),
  monokai: Object.freeze({ fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace' }),
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
})

/**
 * Mount the appearance host surface: the preference GET/POST endpoint and the
 * index tap that folds the current preference into CSS variables.
 * @param ctx - plugin context carrying the webServer service.
 */
export function apply(ctx: Context): void {
  const server = ctx.webServer
  const filePath = join(resolveDshHome(), APPEARANCE_FILE_NAME)
  let prefs: AppearancePrefs = { ...DEFAULT_PREFS, ...readPrefs(filePath) }

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/api/desktop/appearance',
    handler: (req: IncomingMessage, res: ServerResponse): void | Promise<void> => {
      if (req.method === 'GET') {
        writeJson(res, 200, prefs)
        return
      }
      if (req.method === 'POST') {
        return handlePost(ctx, filePath, req, res, (next) => { prefs = next })
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
  filePath: string,
  req: IncomingMessage,
  res: ServerResponse,
  publish: (next: AppearancePrefs) => void,
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
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
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
  const codeFont = CODE_THEMES[prefs.codeTheme]?.fontFamily ?? CODE_THEMES.github?.fontFamily
  const v = CSS_VARIABLES
  return `<style id="dsh-desktop-appearance">
:root{
${v.font}:${prefs.fontFamily};
${v.size}:${String(prefs.fontSize)}px;
${v.accent}:${prefs.accentColor};
${v.codeFont}:${codeFont};
}
body,body[data-ds-dark-theme]{--dsw-alias-brand-primary:var(${v.accent});}
body{font-family:var(${v.font});font-size:var(${v.size});}
pre,code{font-family:var(${v.codeFont});}
</style>`
}
