/** Global command-palette overlay registration. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { CommandPalette } from './CommandPalette.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Additive full-frame overlay seat declared by ui-layout. */
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}

export function register(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'desktop-command-palette',
    order: 10,
    inject: () => ({ ctx }),
  }, CommandPalette))
}
