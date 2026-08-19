// Author: Zihan Wang
// <wangzh011031@163.com>
/** Register the 识图 composer switch and the settings page. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ModLensToggle } from './ModLensToggle.tsx'
import { VisionSettings } from './VisionSettings.tsx'
import { installDirectoryMask } from './directory.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.section': { kind: 'list'; scope: 'root'; owner: { close: () => void } }
  }
}

export const SECTION_ID = 'vision'
export const SECTION_ORDER = 17

/** Patch directories first so blank-session restore sees the masked catalog. */
export function register(ctx: ClientContext): void {
  installDirectoryMask(ctx)

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'desktop-modlens',
    order: 40,
    inject: () => ({ ctx }),
  }, ModLensToggle))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    order: SECTION_ORDER,
    label: '识图',
    inject: () => ({ ctx }),
  }, VisionSettings))
}
