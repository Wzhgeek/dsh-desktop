/** Register the session schedule panel. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { SchedulePanel } from './SchedulePanel.tsx'

export function register(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'desktop-schedules',
    order: 8,
  }, SchedulePanel))
}
