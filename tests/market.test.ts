// Author: Zihan Wang
// <wangzh011031@163.com>
import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyDroppedPath } from '../src/host/drop.ts'
import { REPOSITORY_SLUG_PATTERN } from '../src/host/installed.ts'
import { deriveMarket, parseMarketState } from '../src/host/market.ts'
import { FIND_SCENARIOS, rankPluginsForNeed } from '../plugins/client/src/client/market/find.ts'

test('classifies dropped folders, pdfs, and images', () => {
  assert.deepEqual(classifyDroppedPath('/tmp/project/', true), { path: '/tmp/project', kind: 'directory' })
  assert.deepEqual(classifyDroppedPath('/tmp/paper.PDF', false), { path: '/tmp/paper.PDF', kind: 'pdf' })
  assert.deepEqual(classifyDroppedPath('/tmp/shot.png', false), { path: '/tmp/shot.png', kind: 'image' })
  assert.deepEqual(classifyDroppedPath('/tmp/notes.md', false), { path: '/tmp/notes.md', kind: 'file' })
})

test('parses market settings defaults', () => {
  assert.equal(parseMarketState(null).enabled, false)
  assert.equal(parseMarketState({ enabled: true }).enabled, true)
})

test('derives a truncated catalog from market.json shape', () => {
  const catalog = deriveMarket({
    schema_version: 1,
    source_fetched_at: '2026-08-16T01:27:18Z',
    source_repo_count: 10,
    entries: [
      {
        id: 1,
        full_name: 'acme/alpha',
        description: 'Alpha plugin',
        stargazers_count: 42,
        language: 'TypeScript',
        license: 'MIT',
        pushed_at: '2026-08-14T09:12:33Z',
        default_branch: 'main',
        category: 'agents-workflows',
        category_zh: '代理与工作流',
        category_en: 'Agents & Workflows',
      },
      {
        id: 2,
        full_name: 'bad name',
        description: 'ignored',
        stargazers_count: 1,
        language: '',
        license: '',
        pushed_at: '',
        default_branch: 'main',
        category: 'x',
        category_zh: 'x',
        category_en: 'x',
      },
      {
        id: 3,
        full_name: 'acme/beta',
        description: 'Beta plugin',
        stargazers_count: 7,
        language: 'Go',
        license: 'Apache-2.0',
        pushed_at: '2026-08-10T00:00:00Z',
        default_branch: 'develop',
        category: 'tools',
        category_zh: '工具',
        category_en: 'Tools',
      },
    ],
  }, 10)
  assert.equal(catalog.items.length, 2)
  assert.equal(catalog.items[0]?.url, 'https://github.com/acme/alpha')
  assert.equal(catalog.items[0]?.defaultBranch, 'main')
  assert.equal(catalog.items[1]?.defaultBranch, 'develop')
  assert.equal(catalog.categories.length, 2)
})

test('keeps every validated entry up to the market size', () => {
  const entries = Array.from({ length: 5 }, (_, index) => ({
    id: index + 1,
    full_name: `acme/plugin-${String(index)}`,
    description: `Plugin ${String(index)}`,
    stargazers_count: index,
    language: 'TypeScript',
    license: 'MIT',
    pushed_at: '2026-08-14T09:12:33Z',
    default_branch: 'main',
    category: 'tools',
    category_zh: '工具',
    category_en: 'Tools',
  }))
  const catalog = deriveMarket({
    schema_version: 1,
    source_fetched_at: '2026-08-16T01:27:18Z',
    source_repo_count: 5,
    entries,
  }, 600)
  assert.equal(catalog.items.length, 5)
})

test('rejects unsafe default branches', () => {
  const catalog = deriveMarket({
    schema_version: 1,
    entries: [{
      full_name: 'acme/gamma',
      description: 'Gamma',
      stargazers_count: 1,
      language: '',
      license: '',
      pushed_at: '',
      default_branch: 'main; rm -rf /',
      category: 'tools',
      category_zh: '工具',
      category_en: 'Tools',
    }],
  })
  assert.equal(catalog.items[0]?.defaultBranch, 'main')
})

test('repository slug pattern used by direct install', () => {
  assert.equal(REPOSITORY_SLUG_PATTERN.test('liustack/modlens'), true)
  assert.equal(REPOSITORY_SLUG_PATTERN.test('bad name'), false)
})

test('ranks vision scenarios toward modlens-style plugins', () => {
  const scenario = FIND_SCENARIOS.find(entry => entry.id === 'vision')
  assert.ok(scenario)
  const ranked = rankPluginsForNeed([
    {
      fullName: 'liustack/modlens',
      name: 'modlens',
      description: 'Vision OCR layout semantics for text-only models',
      category: 'vision-multimodal',
      categoryZh: '视觉与多模态',
      categoryEn: 'Vision',
      language: 'TypeScript',
      stars: 2700,
    },
    {
      fullName: 'acme/unrelated',
      name: 'unrelated',
      description: 'Git history viewer',
      category: 'tools',
      categoryZh: '工具',
      categoryEn: 'Tools',
      language: 'Go',
      stars: 9000,
    },
  ], '想看图', scenario, 3)
  assert.equal(ranked[0]?.item.fullName, 'liustack/modlens')
  assert.match(ranked[0]?.reason ?? '', /精选|vision|ocr|图片|视觉/i)
})
