// Author: Zihan Wang
// <wangzh011031@163.com>
/**
 * Decide whether a packaged desktop install can talk to GitHub Releases.
 * electron-updater reads `Contents/Resources/app-update.yml`, which
 * electron-builder only writes for DMG/ZIP/NSIS/AppImage artifacts — not for
 * `electron-builder --dir` copies dropped into /Applications.
 * @module @deepseek-ai/dsh-desktop/desktop-update
 */

import { spawnSync } from 'node:child_process'

export function packagedUpdateUnavailableReason(input: {
  packaged: boolean
  platform: NodeJS.Platform
  appImage: boolean
  hasUpdateConfig: boolean
  properlySigned?: boolean
}): string | undefined {
  if (!input.packaged) return '开发版本不连接发布更新源。'
  if (input.platform === 'linux' && !input.appImage) {
    return 'Linux 自动安装仅支持 AppImage；请从 Releases 更新当前安装包。'
  }
  if (!input.hasUpdateConfig) {
    return '当前安装包没有更新配置（不是 GitHub Release 产物）。请从 Releases 安装 DMG 或 ZIP。'
  }
  if (input.platform === 'darwin' && input.properlySigned === false) {
    return '当前安装包未使用 Developer ID 签名，macOS 无法应用内安装更新。请从 Releases 下载 DMG 手动安装。'
  }
  return undefined
}

/** Squirrel.Mac only replaces properly signed /Applications installs. */
export function macAppProperlySigned(execPath: string): boolean {
  const result = spawnSync('codesign', ['-dv', execPath], { encoding: 'utf8' })
  const detail = `${result.stdout}\n${result.stderr}`
  if (/Signature=adhoc/.test(detail)) return false
  if (/TeamIdentifier=not set/.test(detail)) return false
  return /Identifier=/.test(detail)
}
