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
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { Context } from '@deepseek-ai/cordis'
import {
  boot,
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

/** Diagnostic prefix on load-failure errors. */
const NAME = 'dsh-desktop'

/** This app's package.json, the first anchor bundle and preset resolution walks. */
const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

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
  // Desktop overlay: the client plugin row lets client-modules discover and
  // serve @dsh-desktop/client's browser bundle into the shell slot system.
  patches.push({ insert: [{ id: 'desktop-client', name: '@dsh-desktop/client' }] })
  const rootConfig = join(profile.dir, PROFILE_ROOT_FILENAME)
  const ctx = await boot(NAME, rootConfig, patches, (hostCtx) => {
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, loadLayeredEnv(NAME))
    hostCtx.plugin(desktopHost)
    hostCtx.plugin(appearanceHost)
    hostCtx.plugin(usageHost)
    hostCtx.plugin(gitHost)
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
