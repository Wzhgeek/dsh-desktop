export interface MentionMatch {
  start: number
  end: number
  query: string
}

/** Resolve an @ file token ending exactly at the current composer caret. */
export function mentionAt(draft: string, caret: number): MentionMatch | undefined {
  const before = draft.slice(0, Math.max(0, Math.min(caret, draft.length)))
  const found = before.match(/(?:^|\s)@([^\s@]*)$/)
  if (found === null || found.index === undefined) return undefined
  const prefix = found[0].startsWith('@') ? 0 : 1
  const start = found.index + prefix
  return { start, end: before.length, query: found[1] ?? '' }
}
