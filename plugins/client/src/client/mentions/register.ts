/** Register composer @ file completion. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { FileMentionMenu } from './FileMentionMenu.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'shell.overlay': {
      kind: 'list'
      scope: 'root'
    }
  }
}

export function register(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'desktop-file-mentions',
    order: 5,
  }, FileMentionMenu))
}
