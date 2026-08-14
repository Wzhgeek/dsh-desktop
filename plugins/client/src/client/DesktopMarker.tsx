import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Skeleton marker rendered beside Settings at the sidebar foot. Proves the
 * desktop client plugin loads and its bundle mounts into the shell slot
 * system; the feature plugins register their own holes alongside it.
 * @param props - the sidebar foot owner share.
 */
export function DesktopMarker({ wide }: SidebarFooterActionOwnerProps): JSX.Element {
  return <span title="dsh-desktop">{wide ? 'Desktop' : 'D'}</span>
}
