/** Session-export slot registration. */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { SessionExportButton } from './SessionExportButton.tsx'
import { installUpstreamSessionLogButtonHider } from './session-log-bridge.ts'

export function register(ctx: ClientContext): void {
  ctx.effect(installUpstreamSessionLogButtonHider, 'desktop-export:hide-upstream-session-log-action')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'desktop-export',
    order: 20,
    inject: (_sessionId: SessionId) => ({ ctx }),
  }, SessionExportButton))
}
