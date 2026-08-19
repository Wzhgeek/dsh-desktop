// Author: Zihan Wang
// <wangzh011031@163.com>
/** Local “find a plugin in ~30s” matching over the curated catalog. */

export interface FindablePlugin {
  fullName: string
  name: string
  description: string
  category: string
  categoryZh: string
  categoryEn: string
  language: string
  stars: number
}

export interface FindScenario {
  id: string
  label: string
  hint: string
  /** Preferred repos from awesome “精选推荐”; boost when present in catalog. */
  boost: readonly string[]
  /** Extra keywords merged into the query when the chip is selected. */
  keywords: readonly string[]
}

/** Scenario chips mirroring awesome-dsh-plugin’s “从问题出发” grouping. */
export const FIND_SCENARIOS: readonly FindScenario[] = [
  {
    id: 'vision',
    label: '看图 / OCR',
    hint: '给纯文本模型外挂视觉',
    boost: ['liustack/modlens', 'Anionex/dsh-vision-toolkit', 'ysr666/dsh-vision-router'],
    keywords: ['vision', 'ocr', '图片', '视觉', 'image', '截图'],
  },
  {
    id: 'search',
    label: '网页搜索',
    hint: '对话里搜网页并带引用',
    boost: ['liustack/modsearch', 'anysearch-team/anysearch-dsh'],
    keywords: ['search', '搜索', 'web', '引用', 'crawl'],
  },
  {
    id: 'memory',
    label: '跨会话记忆',
    hint: '可审计的长期记忆',
    boost: ['csyangwen/dsh-memory-evolve', 'ZSeven-W/dsh-noema', 'omdsh-dev/dsh-mnemon'],
    keywords: ['memory', '记忆', 'recall', '知识图谱'],
  },
  {
    id: 'ui',
    label: '界面 / 工作台',
    hint: '侧栏、看板、皮肤、用量',
    boost: ['zhu1090093659/dsh-web-ui', 'bowenliang123/dsh-context', 'omdsh-dev/DSH-better-sidebar'],
    keywords: ['sidebar', 'ui', '皮肤', 'theme', '看板', '工作台', 'token'],
  },
  {
    id: 'teams',
    label: '多 Agent 协作',
    hint: '拆任务、子代理、工作流',
    boost: ['NanmiCoder/dsh-agent-teams', 'omdsh-dev/dsh_workflow'],
    keywords: ['team', 'agent', 'workflow', '协作', '子代理', '调度'],
  },
  {
    id: 'automation',
    label: '定时 / 无人值守',
    hint: '自动跑任务、断线续跑、通知',
    boost: ['titanwings/dsh-automation', 'HsiangNianian/dsh-auto-continue', 'omdsh-dev/dsh-notification'],
    keywords: ['schedule', 'automation', '定时', 'continue', '通知', '无人值守'],
  },
  {
    id: 'git',
    label: 'Git / 开发流',
    hint: '版本、权限、导入会话',
    boost: ['Nwflower/dsh-chat-import', 'NanmiCoder/dsh-auto-mode'],
    keywords: ['git', 'import', '权限', '迁移', 'codex', 'claude'],
  },
  {
    id: 'remote',
    label: '远程 / 手机',
    hint: '外设访问、QQ、MCP',
    boost: ['kelai141/dsh-mobile-apk', 'tencent-connect/dsh-qqbot', 'flymysql/dsh-remote'],
    keywords: ['mobile', 'remote', 'qq', 'mcp', '远程', '手机'],
  },
]

export interface RankedPlugin<T extends FindablePlugin = FindablePlugin> {
  item: T
  score: number
  reason: string
}

/**
 * Rank catalog rows for a free-text need and/or a scenario chip.
 * Pure local scoring — no network, no LLM.
 */
export function rankPluginsForNeed<T extends FindablePlugin>(
  items: readonly T[],
  need: string,
  scenario: FindScenario | undefined,
  limit = 8,
): RankedPlugin<T>[] {
  const tokens = tokenize([need, ...(scenario?.keywords ?? [])].join(' '))
  const boost = new Set((scenario?.boost ?? []).map(entry => entry.toLocaleLowerCase()))
  const ranked: RankedPlugin<T>[] = []

  for (const item of items) {
    const haystack = [
      item.fullName,
      item.name,
      item.description,
      item.category,
      item.categoryZh,
      item.categoryEn,
      item.language,
    ].join(' ').toLocaleLowerCase()

    let score = 0
    const hits: string[] = []
    for (const token of tokens) {
      if (!haystack.includes(token)) continue
      score += token.length >= 4 ? 3 : 2
      if (hits.length < 3) hits.push(token)
    }

    const slug = item.fullName.toLocaleLowerCase()
    if (boost.has(slug)) {
      score += 40
      hits.unshift('精选')
    }

    if (score <= 0) continue
    // Light popularity tie-break so equally matched rows still feel ordered.
    score += Math.min(8, Math.log10(item.stars + 1) * 2)
    ranked.push({
      item,
      score,
      reason: hits.length > 0 ? `匹配：${hits.join('、')}` : '相关',
    })
  }

  ranked.sort((a, b) => b.score - a.score || b.item.stars - a.item.stars || a.item.fullName.localeCompare(b.item.fullName))
  return ranked.slice(0, limit)
}

function tokenize(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .split(/[\s,，、/|+.]+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2)
}
