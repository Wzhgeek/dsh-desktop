/**
 * Usage feature — client registration. Registers the per-session usage readout
 * and the cross-session Usage settings page.
 * @module @dsh-desktop/client/usage
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { UsageReadout } from './UsageReadout.tsx'
import { UsageDashboard } from './UsageDashboard.tsx'

/**
 * Owner share of the conversation session header's action row: the render site
 * passes nothing; a control derives its state from the framework session kit.
 * Mirror of ui-conversation's ConversationHeaderActionOwnerProps.
 */
export interface ConversationHeaderActionOwnerProps {}

// The conversation slot table lives in @deepseek-ai/dsh-client-ui-conversation,
// which is not a resolvable dependency of this plugin, so the one slot this
// feature contributes is re-declared here as a type-only mirror. The runtime
// declaration (kind/scope/owner contract) is owned by ui-conversation; this
// merge only gives the typed register() call a SlotMap key to name.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One per-session control in the session header's action row. */
    'conversation.session.header.actions': {
      kind: 'list'
      scope: 'session'
      owner: ConversationHeaderActionOwnerProps
    }
    /** One per-session utility aligned at the right edge of the session header. */
    'conversation.session.header.utilities': {
      kind: 'list'
      scope: 'session'
      owner: ConversationHeaderActionOwnerProps
    }
  }
}

/**
 * Register the usage readout into the session header.
 * @param ctx - client root context.
 */
export function register(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'usage',
    // Negative order keeps the static readout ahead of interactive actions.
    order: -10,
  }, UsageReadout))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage',
    order: 15,
    label: 'Usage',
  }, UsageDashboard))
}
