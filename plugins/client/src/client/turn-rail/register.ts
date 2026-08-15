/** Register the session-scoped turn navigator controller. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { TurnRail } from './TurnRail.tsx'

export function register(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'desktop-turn-rail',
    order: 5,
  }, TurnRail))
}
