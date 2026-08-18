// Author: Zihan Wang
// <wangzh011031@163.com>
/**
 * Decide whether a packaged desktop install can talk to GitHub Releases.
 * electron-updater reads `Contents/Resources/app-update.yml`, which
 * electron-builder only writes for DMG/ZIP/NSIS/AppImage artifacts — not for
 * `electron-builder --dir` copies dropped into /Applications.
 * @module @deepseek-ai/dsh-desktop/desktop-update
 */

export function packagedUpdateUnavailableReason(input: {
  packaged: boolean
  platform: NodeJS.Platform
  appImage: boolean
  hasUpdateConfig: boolean
}): string | undefined {
  if (!input.packaged) return '开发版本不连接发布更新源。'
  if (input.platform === 'linux' && !input.appImage) {
    return 'Linux 自动安装仅支持 AppImage；请从 Releases 更新当前安装包。'
  }
  if (!input.hasUpdateConfig) {
    return '当前安装包没有更新配置（不是 GitHub Release 产物）。请从 Releases 安装 DMG 或 ZIP。'
  }
  return undefined
}
