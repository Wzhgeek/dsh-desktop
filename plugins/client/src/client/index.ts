/**
 * dsh-desktop client plugin — browser half. Registers the desktop surface
 * extensions into the shared UI slots. This file is the client bundle entry.
 * @module @dsh-desktop/client
 */

// Type-only: pulls the SlotMap merge (ctx.slots) and the sidebar foot hole.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { DesktopMarker } from './DesktopMarker.tsx'
import { register as registerAppearance } from './appearance/register.ts'
import { register as registerDesktop } from './desktop/register.ts'
import { register as registerUsage } from './usage/register.ts'
import { register as registerGit } from './git/register.ts'
import { register as registerProject } from './project/register.ts'
import { register as registerExport } from './export/register.ts'
import { register as registerPalette } from './palette/register.ts'
import { register as registerSummary } from './summary/register.ts'
import { register as registerTurnRail } from './turn-rail/register.ts'
import { register as registerMentions } from './mentions/register.ts'
import { register as registerSchedule } from './schedule/register.ts'

/** Required client services: the slot registry and locale copy. */
export const inject = ['slots', 'locale', 'sessions', 'workspaces']

/**
 * Register the desktop extension points.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'desktop',
    order: 50,
  }, DesktopMarker))

  registerAppearance(ctx)
  registerDesktop(ctx)
  registerExport(ctx)
  registerPalette(ctx)
  registerMentions(ctx)
  registerSchedule(ctx)
  registerTurnRail(ctx)
  registerSummary(ctx)
  registerUsage(ctx)
  registerProject(ctx)
  registerGit(ctx)
}
