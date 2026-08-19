// Author: Zihan Wang
// <wangzh011031@163.com>
/** Register the desktop drag-and-drop overlay. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { DesktopDropLayer } from './DesktopDropLayer.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}

export function register(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'desktop-drop',
    order: 3,
    inject: () => ({ ctx }),
  }, DesktopDropLayer))
}
