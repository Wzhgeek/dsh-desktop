// Author: Zihan Wang
// <wangzh011031@163.com>
/** Geometry helpers so a bottom terminal sits under the conversation column. */

export interface Rect {
  left: number
  right: number
}

/** Distance from the frame edges to the conversation column. */
export function dockBottomInsets(frame: Rect, conversation: Rect): { left: number; right: number } {
  return {
    left: Math.max(0, Math.round(conversation.left - frame.left)),
    right: Math.max(0, Math.round(frame.right - conversation.right)),
  }
}
