// Author: Zihan Wang
// <wangzh011031@163.com>
/**
 * Embed a dsh `web` tree in-process and return its loopback URL.
 *
 * Shared by the Electron main process and by headless smoke verification; the
 * caller owns teardown (`ctx.fiber.dispose()`). Boots the shared `web` profile
 * over the user's Harness home (so sessions and settings persist across
 * `dsh web` and the desktop app), lets the OS assign the listen port, and
 * serves the SPA over plain HTTP. Loading the frontend from the resulting
 * loopback URL keeps the browser origin equal to the request Host, so the
 * existing browser-trust fence accepts every call unchanged.
 * @module @deepseek-ai/dsh-desktop/boot
 */

import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { Context } from '@deepseek-ai/cordis'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  loadLayeredEnv,
  loadOptionalPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import * as desktopHost from './host/desktop-host.ts'
import * as appearanceHost from './host/appearance-host.ts'
import * as usageHost from './host/usage-host.ts'
import * as gitHost from './host/git-host.ts'
import * as githubHost from './host/github-host.ts'
import * as projectHost from './host/project-host.ts'
import * as scheduleHost from './host/schedule-host.ts'
import ElectronDirectoryPicker from './host/picker-host.ts'

/** Diagnostic prefix on load-failure errors. */
const NAME = 'dsh-desktop'

/** This app's package.json, the first anchor bundle and preset resolution walks. */
const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/** Official presets shipped with the dsh CLI package, matching `dsh web`. */
const SHIPPED_PRESET_ROOT = join(
  dirname(createRequire(INSTALL_ANCHOR).resolve('@deepseek-ai/dsh/package.json')),
  'config',
  'agent-presets',
)

/** The profile root config filename (the include root the Loader anchors on). */
const PROFILE_ROOT_FILENAME = 'cordis.yml'

/** Empty entry list: like every dsh profile, the tree is composed as patches. */
const PROFILE_ROOT_CONFIG = '# dsh-desktop profile root — an empty entry list; the tree is composed as patches.\n[]\n'

/** A booted tree plus the canonical loopback URL of its embedded Web GUI. */
export interface BootedTree {
  /** The settled root context; dispose it to tear the tree down. */
  ctx: Context
  /** The loopback URL to load the SPA from. */
  url: string
}

export function applyDesktopPatchOverrides(patches: PatchOptions[], composedEntries: Array<{ id?: string; config?: unknown }>): void {
  const agentPresets = composedEntries.find((entry) => entry.id === 'agent-presets')
  if (agentPresets !== undefined) {
    patches.push({
      id: 'agent-presets',
      config: {
        ...agentPresets.config as object,
        roots: [{ path: SHIPPED_PRESET_ROOT, trust: 'system' }],
      },
    })
  }
  // The shared web profile disables workspace instruction rendering in some
  // deployments, but desktop's Project memory UI depends on AGENTS.local.md
  // being injected into every session as workspace instructions.
  patches.push({ id: 'agent-instructions', disabled: false })
}

/**
 * Compose and boot the `web` profile in-process: bundle layers, the profile's
 * user layer, and the home-level user layer, with `--port 0` so the OS assigns
 * an unused port.
 * @param onExit - requested-process-exit hook wired to `ctx.appExit`; the
 * Electron host routes it to application shutdown, headless smokes ignore it.
 * @returns the settled context and the canonical loopback URL.
 */
export async function bootDesktopTree(onExit: (code: number) => void = () => {}): Promise<BootedTree> {
  healProfilesModuleFallback(INSTALL_ANCHOR)
  const profile = loadProfile(NAME, 'web', INSTALL_ANCHOR)
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  const homePatches = loadOptionalPatches(NAME, join(resolveDshHome(), PROFILE_PATCH_FILENAME)) ?? []
  const bundlePatches = profile.layers.flatMap((layer) => layer.patches)
  const patches: PatchOptions[] = structuredClone([...bundlePatches, ...profile.patches, ...homePatches])
  // The web bundle declares the roster service, while the installed app owns
  // the path to its shipped presets. Mirror the official dsh launcher overlay
  // so a selected workspace can create its initial `standard` session.
  const composedEntries = composeEntries([patches])
  applyDesktopPatchOverrides(patches, composedEntries)
  // The shared web profile leaves FTS disabled for deployments that only need
  // title search. Desktop's global palette promises message-content search, so
  // defer opening the derived SQLite index until the first actual query.
  const sessionQuery = composedEntries.find((entry) => entry.id === 'session-query-sqlite')
  if (sessionQuery !== undefined) {
    patches.push({
      id: 'session-query-sqlite',
      config: { ...sessionQuery.config, openAt: 'first-search' },
    })
  }
  // Desktop overlay: the client plugin row lets client-modules discover and
  // serve @dsh-desktop/client's browser bundle into the shell slot system.
  patches.push({ insert: [{ id: 'desktop-client', name: '@dsh-desktop/client' }] })
  // Under Electron the shipped osascript/Zenity native picker is unreliable
  // (macOS Automation permission); replace the adaptive backend with the
  // Electron directory dialog instead.
  if (process.versions.electron !== undefined) {
    patches.push({ id: 'directory-picker', disabled: true })
  }
  const rootConfig = join(profile.dir, PROFILE_ROOT_FILENAME)
  const ctx = await boot(NAME, rootConfig, patches, async (hostCtx) => {
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, loadLayeredEnv(NAME))
    hostCtx.plugin(desktopHost)
    hostCtx.plugin(appearanceHost)
    hostCtx.plugin(usageHost)
    hostCtx.plugin(gitHost)
    hostCtx.plugin(githubHost)
    hostCtx.plugin(projectHost)
    hostCtx.plugin(scheduleHost)
    if (process.versions.electron !== undefined) {
      hostCtx.plugin(ElectronDirectoryPicker)
      // The auto row was disabled above; it normally mounts both faces of the
      // interaction. Re-mount only the native client surface here so
      // WorkspacePicker's picking affordance stays available while the
      // ElectronDirectoryPicker serves the backend capability.
      await hostCtx.loader.create({ name: '@deepseek-ai/dsh-client-ui-directory-picker-native' })
    }
    provideCmdline(hostCtx, {
      // OS-assigned port; the SPA is loaded from the resulting loopback URL.
      args: ['--port', '0'],
      exit: onExit,
    })
  })
  const port = ctx.get('webServer')?.port
  if (port === undefined) throw new Error(`${NAME}: webServer service unavailable after boot`)
  return { ctx, url: `http://127.0.0.1:${String(port)}` }
}
