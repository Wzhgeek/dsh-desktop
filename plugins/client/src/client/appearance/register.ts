/**
 * Appearance feature — client registration. Registers the Appearance settings
 * page into the `settings.section` slot. The page reads and writes the desktop
 * appearance preference through the host `/api/desktop/appearance` endpoint; the
 * host persists it and re-injects the CSS variables on the next index load.
 *
 * The `settings.section` slot is declared at runtime by ui-settings-general
 * (the settings shell). This package does not depend on that shell, so the slot
 * type is re-declared here as a compile-time mirror of the shared contract
 * (kind `list`, scope `root`, owner `{ close }`).
 * @module @dsh-desktop/client/appearance
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { AppearanceSettings } from './AppearanceSettings.tsx'

/** Owner share the settings shell supplies to a section entry. */
export interface AppearanceSettingsOwnerProps {
  /** Close the settings panel (the shell owns the open state). */
  close: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One settings page per list entry; the shell renders the page inside the
     * Settings panel content column. Mirror of the shared settings.section
     * contract (ui-settings/contract/slots.ts).
     */
    'settings.section': { kind: 'list'; scope: 'root'; owner: AppearanceSettingsOwnerProps }
  }
}

/** Stable section id driving the Settings nav (`only` filtering). */
export const SECTION_ID = 'appearance'

/** Nav position of the Appearance section within the Settings panel. */
export const SECTION_ORDER = 20

/**
 * Register the appearance UI.
 * @param ctx - client root context.
 */
export function register(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    order: SECTION_ORDER,
    label: 'Appearance',
  }, AppearanceSettings))
}
