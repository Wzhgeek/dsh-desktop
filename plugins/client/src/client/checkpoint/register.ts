/** Register non-destructive session checkpoint restoration. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { CheckpointPanel } from './CheckpointPanel.tsx'

export function register(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'desktop-checkpoints',
    order: 9,
    inject: () => ({ ctx }),
  }, CheckpointPanel))
}
