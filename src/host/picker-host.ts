/**
 * Electron directory-picker backend — the desktop replacement for the
 * osascript/Zenity native backend. Opens Electron's own directory dialog,
 * which is reliable under Electron and needs no macOS Automation permission
 * (unlike the AppleScript `choose folder` the shipped native backend drives).
 * `electron` is imported lazily inside pick so the pure-node smoke path (no
 * Electron runtime) can still load this module.
 * @module @deepseek-ai/dsh-desktop/host/picker
 */

import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import type { DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker'

/** The `ctx.directoryPicker` native implementation backed by Electron's dialog. */
export default class ElectronDirectoryPicker extends DirectoryPicker {
  private readonly nativeCapability: DirectoryPickerCapability = {
    kind: 'native',
    /* v8 ignore next -- opens a real OS chooser; the pure-node smoke never calls it. */
    pick: async (signal: AbortSignal) => {
      const { dialog } = await import('electron')
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Workspace Directory',
      })
      return result.canceled || result.filePaths.length === 0 ? null : (result.filePaths[0] ?? null)
    },
  }

  /**
   * The native interaction capability.
   * @returns the stable `native` capability object.
   */
  capability(): DirectoryPickerCapability {
    return this.nativeCapability
  }
}
