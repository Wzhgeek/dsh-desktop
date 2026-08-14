/**
 * Git feature — client registration: contributes the Git panel as a
 * `conversation.view` tab and fetches status/diff from the desktop host
 * endpoints.
 * @module @dsh-desktop/client/git
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Value import pulls GitPanel's local SlotMap augmentation into the program.
import { GitPanel } from './GitPanel.tsx'

/**
 * Register the git view tab.
 * @param ctx - client root context.
 */
export function register(ctx: ClientContext): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'git',
    order: 30,
    label: () => 'Git',
  }, GitPanel))
}
