// Author: Zihan Wang
// <wangzh011031@163.com>
/** Register the plugin market settings page. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { MarketSettings } from './MarketSettings.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.section': { kind: 'list'; scope: 'root'; owner: { close: () => void } }
  }
}

export const SECTION_ID = 'plugin-market'
export const SECTION_ORDER = 18

export function register(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    order: SECTION_ORDER,
    label: '插件市场',
    inject: () => ({ ctx }),
  }, MarketSettings))
}
