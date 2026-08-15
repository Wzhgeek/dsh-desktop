/** Readable, full-window conversation export helpers. */

import type {
  ClientContext,
  ConversationNode,
  ConversationSnapshot,
  SessionFace,
  SessionId,
  SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'

export type SessionExportFormat = 'markdown' | 'text'

/** Load older windows until the client owns the complete durable conversation. */
export async function loadCompleteConversation(session: SessionFace): Promise<ConversationSnapshot> {
  for (let page = 0; page < 200; page += 1) {
    const before = session.getSnapshot()
    if (!before.hasMore) return before
    const beforeFirst = before.nodes[0]?.seq
    const beforeLength = before.nodes.length
    await session.loadOlder()
    const after = session.getSnapshot()
    if (!after.hasMore) return after
    if (after.nodes.length === beforeLength && after.nodes[0]?.seq === beforeFirst) {
      throw new Error(after.openError?.message ?? '无法加载更早的会话记录。')
    }
  }
  throw new Error('会话记录过长，导出已停止。')
}

/** Export one addressed session and trigger a browser download. */
export async function exportSession(
  ctx: ClientContext,
  sessionId: SessionId,
  format: SessionExportFormat,
): Promise<void> {
  const scope = ctx.sessions.scope(sessionId)
  const session = scope === undefined ? undefined : ctx.sessions.sessionOf(scope)
  if (session === undefined) throw new Error('当前会话不可用。')
  const summary = ctx.sessions.list.getSnapshot().byId[sessionId]
  const snapshot = await loadCompleteConversation(session)
  const content = serializeConversation(snapshot, summary, format)
  const extension = format === 'markdown' ? 'md' : 'txt'
  downloadText(content, `${safeFilename(summary?.displayTitle ?? 'session')}.${extension}`, format)
}

/** Export the selected session, used by the global command palette. */
export async function exportCurrentSession(ctx: ClientContext, format: SessionExportFormat): Promise<void> {
  const current = ctx.sessions.list.getSnapshot().current
  if (current === undefined) throw new Error('请先打开一个会话。')
  await exportSession(ctx, current, format)
}

/** Serialize the readable transcript without leaking the raw JSONL envelope. */
export function serializeConversation(
  snapshot: ConversationSnapshot,
  summary: SessionSummary | undefined,
  format: SessionExportFormat,
): string {
  const title = summary?.displayTitle ?? 'Session'
  const created = firstTimestamp(snapshot.nodes)
  const header = format === 'markdown'
    ? [
        `# ${escapeMarkdown(title)}`,
        '',
        `- Session: \`${snapshot.sessionId}\``,
        ...(summary?.cwd === undefined ? [] : [`- Workspace: \`${summary.cwd}\``]),
        ...(created === undefined ? [] : [`- Started: ${formatTimestamp(created)}`]),
        `- Exported: ${formatTimestamp(Date.now())}`,
      ].join('\n')
    : [
        title,
        `Session: ${snapshot.sessionId}`,
        ...(summary?.cwd === undefined ? [] : [`Workspace: ${summary.cwd}`]),
        ...(created === undefined ? [] : [`Started: ${formatTimestamp(created)}`]),
        `Exported: ${formatTimestamp(Date.now())}`,
      ].join('\n')
  const nodes = snapshot.nodes.flatMap(node => serializeNode(node, format))
  return `${header}\n\n${nodes.join(format === 'markdown' ? '\n\n---\n\n' : '\n\n' + '-'.repeat(72) + '\n\n')}\n`
}

function serializeNode(node: ConversationNode, format: SessionExportFormat): string[] {
  const at = formatTimestamp(node.time)
  switch (node.kind) {
    case 'user':
      return [section('User', at, contentText(node.content), format)]
    case 'steering':
      return [section('User · Steering', at, contentText(node.content), format)]
    case 'assistant': {
      const body = node.blocks.map(block => {
        if (block.kind === 'text') return block.text
        if (block.kind === 'reasoning') return format === 'markdown'
          ? `<details>\n<summary>Reasoning</summary>\n\n${block.text}\n\n</details>`
          : `[Reasoning]\n${block.text}`
        if (block.kind === 'image') return '[Image attachment]'
        if (block.kind === 'tool-call') return format === 'markdown'
          ? `<details>\n<summary>Tool · ${escapeHtml(block.name)}</summary>\n\n\`\`\`json\n${block.argsRaw}\n\`\`\`\n</details>`
          : `[Tool · ${block.name}]\n${block.argsRaw}`
        return `[Unsupported content: ${safeJson(block.block)}]`
      }).filter(Boolean).join('\n\n')
      return [section(node.interrupted === true ? 'Assistant · Stopped' : 'Assistant', at, body, format)]
    }
    case 'tool-result': {
      const name = node.call?.name ?? node.callId
      const body = contentText(node.content)
      return [format === 'markdown'
        ? `<details>\n<summary>${node.isError ? 'Tool error' : 'Tool result'} · ${escapeHtml(name)}</summary>\n\n${body}\n\n</details>`
        : `[${node.isError ? 'Tool error' : 'Tool result'} · ${name}] ${at}\n${body}`]
    }
    case 'context':
      return [format === 'markdown'
        ? `<details>\n<summary>Context · ${escapeHtml(node.provenance.label ?? node.provenance.role)}</summary>\n\n${contentText(node.content)}\n\n</details>`
        : `[Context] ${at}\n${contentText(node.content)}`]
    case 'compaction':
      return node.summary === null ? [] : [section('Compaction summary', at, node.summary, format)]
    case 'turn-error':
      return [section('Turn error', at, `${node.message}${node.code === undefined ? '' : ` (${node.code})`}`, format)]
    case 'turn-max-tokens':
      return [section('Notice', at, 'The response reached its output-token limit.', format)]
    case 'model-retry':
      return [section('Model retry', at, safeJson(node), format)]
    case 'command': {
      const command = `/${node.name ?? 'command'}${node.args ?? ''}`
      const outcome = node.outcome?.text
      return [section('Command', at, outcome === undefined ? command : `${command}\n\n${outcome}`, format)]
    }
    case 'unknown':
      return [section(node.type, at, safeJson(node.data), format)]
  }
}

function section(role: string, at: string, body: string, format: SessionExportFormat): string {
  if (format === 'markdown') return `## ${role}\n\n<sub>${at}</sub>\n\n${body || '_No text content_'} `
  return `${role.toUpperCase()} · ${at}\n${body || '[No text content]'}`
}

function contentText(content: readonly unknown[]): string {
  return content.map(block => {
    if (typeof block !== 'object' || block === null) return safeJson(block)
    const value = block as Record<string, unknown>
    if ((value.type === 'text' || value.type === 'reasoning') && typeof value.text === 'string') return value.text
    if (value.type === 'image') return '[Image attachment]'
    if (value.type === 'tool-call') return `[Tool call · ${String(value.name ?? '')}]\n${String(value.arguments ?? '')}`
    if (value.type === 'tool-result' && Array.isArray(value.content)) return contentText(value.content)
    return safeJson(value)
  }).filter(Boolean).join('\n\n')
}

function firstTimestamp(nodes: readonly ConversationNode[]): number | undefined {
  return nodes.find(node => Number.isFinite(node.time))?.time
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value))
}

function safeFilename(value: string): string {
  const cleaned = value.trim().replace(/[\\/:*?\"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').slice(0, 100)
  return cleaned === '' ? 'session' : cleaned
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]<>()#+.!|-])/g, '\\$1')
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}

function downloadText(content: string, filename: string, format: SessionExportFormat): void {
  const blob = new Blob([content], { type: format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => { URL.revokeObjectURL(url) }, 1_000)
}
