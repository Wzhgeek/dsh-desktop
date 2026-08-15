/** Register the per-session pinned summary beside the conversation utilities. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { PinnedSummary } from './PinnedSummary.tsx'

export function register(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'pinned-summary',
    order: 10,
  }, PinnedSummary))
}
