/** Pure turn-rail projection from the durable conversation window. */

import type {
  ChatNodeStore,
  ConversationNode,
  UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'

/** One visible navigation stop, anchored to its rendered user-message row. */
export interface TurnRailItem {
  key: string
  number: number
  summary: string
  contentLength: number
  expandedWidth: number
}

interface MutableTurn {
  key: string
  number: number | undefined
  summary: string
  contentLength: number
}

/** Width ladder centered on the selected or temporarily hovered turn. */
export function turnRailMarkWidth(index: number, centerIndex: number): number {
  if (centerIndex < 0) return 10
  const distance = Math.abs(index - centerIndex)
  if (distance === 0) return 24
  if (distance === 1) return 18
  if (distance === 2) return 14
  return 10
}

/** Build loaded turn stops without duplicating the conversation's grouping logic. */
export function deriveTurnRailItems(
  nodes: readonly ConversationNode[],
  order: readonly string[],
  nodeStore: ChatNodeStore,
): TurnRailItem[] {
  const anchors = new Map<number, { key: string; turn?: number }>()
  for (const key of order) {
    const node = nodeStore.get(key)
    if (node?.kind !== 'user' || !isRecord(node.data) || typeof node.data.seq !== 'number') continue
    const location = node.location
    const turn = location.kind === 'turn' || location.kind === 'step' ? location.turn.turn : undefined
    anchors.set(node.data.seq, { key, ...(turn === undefined ? {} : { turn }) })
  }

  const turns: MutableTurn[] = []
  let current: MutableTurn | undefined
  for (const node of nodes) {
    if (node.kind === 'user') {
      const anchor = anchors.get(node.seq)
      current = anchor === undefined ? undefined : {
        key: anchor.key,
        number: anchor.turn,
        summary: summarizeUser(node),
        contentLength: nodeLength(node),
      }
      if (current !== undefined) turns.push(current)
      continue
    }
    if (current === undefined) continue
    current.contentLength += nodeLength(node)
    if (current.number === undefined && 'turn' in node && typeof node.turn === 'number') current.number = node.turn
  }

  return turns.map((turn, index) => {
    const contentLength = Math.max(1, turn.contentLength)
    return {
      key: turn.key,
      number: turn.number ?? index + 1,
      summary: turn.summary,
      contentLength,
      expandedWidth: Math.min(24, 14 + Math.round(Math.log2(contentLength + 1) * 1.2)),
    }
  })
}

function summarizeUser(node: UserMessageNode): string {
  const text = contentText(node.content)
  if (text === '') return '图片或附件消息'
  return shorten(text, 88)
}

function nodeLength(node: ConversationNode): number {
  switch (node.kind) {
    case 'user':
    case 'steering':
    case 'context':
    case 'tool-result':
      return contentText(node.content).length
    case 'assistant':
      return node.blocks.reduce((total, block) => (
        total + (block.kind === 'text' || block.kind === 'reasoning' ? block.text.length : block.kind === 'tool-call' ? block.argsRaw.length : 24)
      ), 0)
    case 'compaction':
      return node.summary?.length ?? 0
    case 'turn-error':
      return node.message.length
    case 'command':
      return (node.name?.length ?? 0) + (node.args?.length ?? 0) + (node.outcome?.text?.length ?? 0)
    case 'model-retry':
    case 'turn-max-tokens':
      return 24
    case 'unknown':
      return 48
  }
}

function contentText(content: readonly unknown[]): string {
  return normalizeText(content.map((block) => {
    if (!isRecord(block)) return ''
    if (block.type === 'text' && typeof block.text === 'string') return block.text
    if (block.type === 'image') return '[图片]'
    return ''
  }).filter(Boolean).join('\n'))
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, ' ').trim()
}

function shorten(value: string, length: number): string {
  const normalized = normalizeText(value)
  return normalized.length <= length ? normalized : `${normalized.slice(0, length - 1).trimEnd()}…`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
