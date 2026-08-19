// Author: Zihan Wang
// <wangzh011031@163.com>
/**
 * Profile-installed plugin list / disable / uninstall helpers.
 * Aligns with official `dsh plugin` (pnpm in the profile dir + bundles reconcile).
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'
import {
  PROFILE_PATCH_FILENAME,
  PROFILE_TEMPLATES,
  resolveProfileDir,
} from '@deepseek-ai/dsh-app-boot'

export const PACKAGE_NAME_PATTERN = /^(?:@[A-Za-z0-9~.*()[\]_-]+\/)?[A-Za-z0-9~.*()[\]_-]+$/
export const REPOSITORY_SLUG_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
export const DEFAULT_PROFILE = 'web'
export const PNPM_REMOVE_MS = 180_000
export const PNPM_INSTALL_MS = 300_000
export const PNPM_OUTPUT_LIMIT = 8_192

export interface InstalledEntry {
  id: string
  phase: 'pending' | 'loading' | 'active' | 'failed' | 'disposed' | 'unloading' | 'unknown'
  disabled: boolean
}

export interface InstalledPackage {
  packageName: string
  version: string
  description: string
  enabled: boolean
  unregistered: boolean
  repository?: string
  entries: InstalledEntry[]
  error: string
}

export interface InstalledSnapshot {
  profile: string
  packages: InstalledPackage[]
}

export interface ActionResult {
  ok: boolean
  notice?: string
  snapshot: InstalledSnapshot
}

interface ProfileManifest {
  name?: string
  dependencies?: Record<string, string>
  dsh?: {
    profile?: { bundles?: string[] }
    bundle?: { patch?: string }
  }
  description?: string
  version?: string
  repository?: string | { url?: string; type?: string }
}

/** Bundles shipped with the profile template — never listed or removable here. */
export function shippedBundles(profile: string = DEFAULT_PROFILE): ReadonlySet<string> {
  const template = PROFILE_TEMPLATES[profile as keyof typeof PROFILE_TEMPLATES]
  return new Set(template ?? PROFILE_TEMPLATES.web)
}

/** List user-installed plugins (dependencies / bundles outside the template). */
export function listInstalled(profile: string = DEFAULT_PROFILE): InstalledSnapshot {
  const profileDir = resolveProfileDir(profile)
  const shipped = shippedBundles(profile)
  const manifest = readJson<ProfileManifest>(join(profileDir, 'package.json')) ?? {}
  const dependencies = Object.keys(manifest.dependencies ?? {})
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const names = new Set<string>()
  for (const name of [...dependencies, ...bundles]) {
    if (!PACKAGE_NAME_PATTERN.test(name) || shipped.has(name)) continue
    names.add(name)
  }

  const disabledIds = disabledEntryIds(readPatchFile(join(profileDir, PROFILE_PATCH_FILENAME)))
  const packages: InstalledPackage[] = []
  for (const packageName of [...names].sort((a, b) => a.localeCompare(b))) {
    packages.push(describePackage(profileDir, packageName, bundles, dependencies, disabledIds))
  }
  return { profile, packages }
}

/** Enable or disable one installed package via the profile patch layer. */
export async function setInstalledEnabled(
  packageName: string,
  enabled: boolean,
  profile: string = DEFAULT_PROFILE,
): Promise<ActionResult> {
  if (!PACKAGE_NAME_PATTERN.test(packageName)) {
    return { ok: false, notice: '无效的包名。', snapshot: listInstalled(profile) }
  }
  const snapshot = listInstalled(profile)
  const target = snapshot.packages.find(entry => entry.packageName === packageName)
  if (target === undefined) {
    return { ok: false, notice: '未找到该插件。', snapshot }
  }
  if (shippedBundles(profile).has(packageName)) {
    return { ok: false, notice: '不能停用系统自带层。', snapshot }
  }

  const profileDir = resolveProfileDir(profile)
  const patchPath = join(profileDir, PROFILE_PATCH_FILENAME)
  const entryIds = target.entries.map(entry => entry.id).filter(id => id !== '')
  if (entryIds.length === 0) {
    return { ok: false, notice: '读不到该插件的加载条目，无法停用。', snapshot }
  }
  const next = setPatchDisabled(readPatchFile(patchPath), entryIds, !enabled)
  await writePatchFile(patchPath, next)
  return {
    ok: true,
    notice: enabled
      ? '已启用（写入 profile 补丁；当前会话可能需重启后完全恢复）。'
      : '已停用（写入 profile 补丁层；重启后仍有效）。',
    snapshot: listInstalled(profile),
  }
}

/** Uninstall via `pnpm remove` in the profile dir, then drop the bundle name. */
export async function uninstallInstalled(
  packageName: string,
  profile: string = DEFAULT_PROFILE,
): Promise<ActionResult> {
  if (!PACKAGE_NAME_PATTERN.test(packageName)) {
    return { ok: false, notice: '无效的包名。', snapshot: listInstalled(profile) }
  }
  if (shippedBundles(profile).has(packageName)) {
    return { ok: false, notice: '不能卸载系统自带层。', snapshot: listInstalled(profile) }
  }
  const before = listInstalled(profile)
  const target = before.packages.find(entry => entry.packageName === packageName)
  if (target === undefined) {
    return { ok: false, notice: '未找到该插件。', snapshot: before }
  }

  const entryIds = target.entries.map(entry => entry.id).filter(id => id !== '')
  const profileDir = resolveProfileDir(profile)
  const patchPath = join(profileDir, PROFILE_PATCH_FILENAME)

  // Stop for the rest of this session / until remove finishes.
  if (entryIds.length > 0) {
    await writePatchFile(patchPath, setPatchDisabled(readPatchFile(patchPath), entryIds, true))
  }

  const pruned = await spawnPnpmRemove(profileDir, packageName)
  dropBundleName(profileDir, packageName)
  if (entryIds.length > 0) {
    await writePatchFile(patchPath, setPatchDisabled(readPatchFile(patchPath), entryIds, false))
  }

  const snapshot = listInstalled(profile)
  if (!pruned.ok) {
    return {
      ok: false,
      notice: `已从清单移除，但 pnpm remove 失败：${pruned.detail}`,
      snapshot,
    }
  }
  return { ok: true, notice: '已卸载。重启桌面端后完全生效。', snapshot }
}

/**
 * Direct install via official `dsh plugin --profile web add <spec>`.
 * Prefer an npm package name when provided; otherwise `github:owner/name`.
 */
export async function installDirect(
  input: { fullName?: string; packageName?: string },
  profile: string = DEFAULT_PROFILE,
): Promise<ActionResult> {
  const packageName = typeof input.packageName === 'string' ? input.packageName.trim() : ''
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : ''
  let spec = ''
  if (packageName !== '' && PACKAGE_NAME_PATTERN.test(packageName)) {
    spec = packageName
  } else if (fullName !== '' && REPOSITORY_SLUG_PATTERN.test(fullName)) {
    spec = `github:${fullName}`
  } else {
    return { ok: false, notice: '无效的安装目标。', snapshot: listInstalled(profile) }
  }

  const dshBin = resolveDshBin()
  if (dshBin === undefined) {
    return { ok: false, notice: '找不到本机 dsh 命令。', snapshot: listInstalled(profile) }
  }

  const result = await spawnDshPlugin(dshBin, ['--profile', profile, 'add', spec])
  const snapshot = listInstalled(profile)
  if (!result.ok) {
    return {
      ok: false,
      notice: `直接安装失败：${result.detail || 'pnpm/dsh 返回非零'}`,
      snapshot,
    }
  }
  return {
    ok: true,
    notice: `已安装 ${spec}。重启桌面端后完全生效。`,
    snapshot,
  }
}

function resolveDshBin(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    return join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js')
  } catch {
    return undefined
  }
}

function spawnDshPlugin(dshBin: string, args: string[]): Promise<{ ok: boolean; detail: string }> {
  return new Promise(resolve => {
    let settled = false
    const finish = (result: { ok: boolean; detail: string }): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const child = spawn(process.execPath, [dshBin, 'plugin', ...args], {
      env: process.env,
      shell: false,
    })
    let output = ''
    const append = (chunk: Buffer): void => {
      output += chunk.toString('utf8')
      if (output.length > PNPM_OUTPUT_LIMIT) output = output.slice(-PNPM_OUTPUT_LIMIT)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timer = setTimeout(() => {
      child.kill()
      finish({ ok: false, detail: `安装超时（>${String(PNPM_INSTALL_MS / 1000)}s）` })
    }, PNPM_INSTALL_MS)
    child.on('error', error => {
      clearTimeout(timer)
      finish({ ok: false, detail: error.message })
    })
    child.on('close', code => {
      clearTimeout(timer)
      const clipped = output.trim()
      finish({
        ok: code === 0,
        detail: code === 0 ? '' : (clipped !== '' ? clipped : `dsh plugin exited ${String(code)}`),
      })
    })
  })
}

function describePackage(
  profileDir: string,
  packageName: string,
  bundles: string[],
  dependencies: string[],
  disabledIds: Set<string>,
): InstalledPackage {
  const inBundles = bundles.includes(packageName)
  const inDeps = dependencies.includes(packageName)
  const pkgDir = join(profileDir, 'node_modules', ...packageName.split('/'))
  let version = ''
  let description = ''
  let repository: string | undefined
  let error = ''
  let entries: InstalledEntry[] = []

  try {
    const pkg = readJson<ProfileManifest>(join(pkgDir, 'package.json'))
    if (pkg === undefined) throw new Error('package.json missing')
    version = typeof pkg.version === 'string' ? pkg.version : ''
    description = typeof pkg.description === 'string' ? pkg.description.slice(0, 300) : ''
    repository = repositorySlug(pkg.repository)
    const patchRel = pkg.dsh?.bundle?.patch
    if (typeof patchRel === 'string' && patchRel !== '') {
      entries = entryIdsFromBundlePatch(join(pkgDir, patchRel)).map(id => ({
        id,
        phase: 'unknown' as const,
        disabled: disabledIds.has(id),
      }))
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }

  const enabled = entries.length === 0
    ? inBundles
    : inBundles && entries.every(entry => !entry.disabled)

  return {
    packageName,
    version,
    description,
    enabled,
    unregistered: inDeps && !inBundles,
    ...(repository === undefined ? {} : { repository }),
    entries,
    error,
  }
}

export function entryIdsFromBundlePatch(path: string): string[] {
  const doc = readPatchFile(path)
  const ids: string[] = []
  for (const row of doc) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) continue
    const insert = (row as { insert?: unknown }).insert
    if (!Array.isArray(insert)) continue
    for (const entry of insert) {
      if (typeof entry !== 'object' || entry === null) continue
      const id = (entry as { id?: unknown }).id
      if (typeof id === 'string' && id.trim() !== '') ids.push(id.trim())
    }
  }
  return ids
}

export function setPatchDisabled(doc: unknown[], entryIds: string[], disabled: boolean): unknown[] {
  const wanted = new Set(entryIds)
  const next = doc.filter(row => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return true
    const candidate = row as { id?: unknown; disabled?: unknown }
    if (typeof candidate.id !== 'string' || !wanted.has(candidate.id)) return true
    return candidate.disabled !== true
  })
  if (disabled) {
    for (const id of entryIds) next.push({ id, disabled: true })
  }
  return next
}

function disabledEntryIds(doc: unknown[]): Set<string> {
  const ids = new Set<string>()
  for (const row of doc) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) continue
    const candidate = row as { id?: unknown; disabled?: unknown }
    if (typeof candidate.id === 'string' && candidate.disabled === true) ids.add(candidate.id)
  }
  return ids
}

function dropBundleName(profileDir: string, packageName: string): void {
  const path = join(profileDir, 'package.json')
  const current = readJson<ProfileManifest>(path)
  if (current === undefined) return
  const bundles = current.dsh?.profile?.bundles ?? []
  if (!bundles.includes(packageName) && current.dependencies?.[packageName] === undefined) return
  const deps = { ...(current.dependencies ?? {}) }
  delete deps[packageName]
  current.dependencies = deps
  current.dsh = {
    ...current.dsh,
    profile: {
      ...current.dsh?.profile,
      bundles: bundles.filter(name => name !== packageName),
    },
  }
  writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
}

export function spawnPnpmRemove(profileDir: string, packageName: string): Promise<{ ok: boolean; detail: string }> {
  if (!PACKAGE_NAME_PATTERN.test(packageName)) {
    return Promise.resolve({ ok: false, detail: 'refusing to spawn pnpm with an invalid package name' })
  }
  return new Promise(resolve => {
    let settled = false
    const finish = (result: { ok: boolean; detail: string }): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const child = spawn('pnpm', ['remove', packageName], {
      cwd: profileDir,
      env: process.env,
      shell: process.platform === 'win32',
    })
    let output = ''
    const append = (chunk: Buffer): void => {
      output += chunk.toString('utf8')
      if (output.length > PNPM_OUTPUT_LIMIT) output = output.slice(-PNPM_OUTPUT_LIMIT)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timer = setTimeout(() => {
      child.kill()
      finish({ ok: false, detail: `pnpm remove timed out after ${String(PNPM_REMOVE_MS / 1000)}s` })
    }, PNPM_REMOVE_MS)
    child.on('error', error => {
      clearTimeout(timer)
      finish({ ok: false, detail: error.message })
    })
    child.on('close', code => {
      clearTimeout(timer)
      const clipped = output.trim()
      finish({
        ok: code === 0,
        detail: code === 0 ? '' : (clipped !== '' ? clipped : `pnpm remove exited ${String(code)}`),
      })
    })
  })
}

function readPatchFile(path: string): unknown[] {
  try {
    if (!existsSync(path)) return []
    const parsed: unknown = yaml.load(readFileSync(path, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writePatchFile(path: string, doc: unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const header = '# Your patch layer for this dsh profile, applied after every bundle layer:\n'
    + '# a top-level YAML array of loader patch entries (id-targeted config\n'
    + '# overrides, disables, and insert lists; `!!js` expressions allowed).\n'
  const body = yaml.dump(doc, { lineWidth: 120, noRefs: true })
  await writeFile(path, `${header}${body}`, 'utf8')
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

function repositorySlug(value: ProfileManifest['repository']): string | undefined {
  if (typeof value === 'string') return githubSlugFromUrl(value)
  if (typeof value === 'object' && value !== null && typeof value.url === 'string') return githubSlugFromUrl(value.url)
  return undefined
}

function githubSlugFromUrl(url: string): string | undefined {
  const match = /github\.com[:/](?<owner>[A-Za-z0-9._-]+)\/(?<repo>[A-Za-z0-9._-]+?)(?:\.git)?$/i.exec(url.trim())
  if (match?.groups?.owner === undefined || match.groups.repo === undefined) return undefined
  return `${match.groups.owner}/${match.groups.repo}`
}
