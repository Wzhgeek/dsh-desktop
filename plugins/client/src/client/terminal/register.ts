// Author: Zihan Wang
// <wangzh011031@163.com>
/** Register the dockable in-app terminal that occupies shell layout space. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { TerminalDock } from './TerminalDock.tsx'
import { TerminalHeader } from './TerminalHeader.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}

export function register(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'desktop-terminal',
    order: 6,
    inject: () => ({ ctx }),
  }, TerminalDock))

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'desktop-terminal',
    order: 18,
  }, TerminalHeader))
}
