/** Register the session-scoped project workspace. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { ProjectPanel } from './ProjectPanel.tsx'

export function register(ctx: ClientContext): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'project',
    order: 25,
    label: () => '项目',
  }, ProjectPanel))
}

