// Author: Zihan Wang
// <wangzh011031@163.com>
/** Register the Installed tab under the official Plugins settings section. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { InstalledPluginsTab } from './InstalledPluginsTab.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.plugins.tab': { kind: 'list'; scope: 'root'; owner: { children?: never } }
  }
}

export const TAB_ID = 'installed'
export const TAB_ORDER = 5

export function register(ctx: ClientContext): void {
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: TAB_ID,
    order: TAB_ORDER,
    label: '已安装',
  }, InstalledPluginsTab))
}
