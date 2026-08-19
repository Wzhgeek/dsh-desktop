// Author: Zihan Wang
// <wangzh011031@163.com>
/** Platform `react-dom` is provided by the desktop module table, not this package. */

declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react'

  export function createPortal(
    children: ReactNode,
    container: Element | DocumentFragment,
    key?: string | null,
  ): ReactPortal
}
