/**
 * Headless smoke for the embedded web tree: boot it, confirm the SPA answers
 * 200 at the loopback URL, then dispose. Run with `tsx src/smoke.ts` after a
 * repository build (needs the built packages and apps/web dist).
 * @module @deepseek-ai/dsh-desktop/smoke
 */

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootDesktopTree } from './boot.ts'

const previousDshHome = process.env.DSH_HOME
const previousGitRoot = process.env.DSH_DESKTOP_GIT_ROOT
const smokeHome = await mkdtemp(join(tmpdir(), 'dsh-desktop-smoke-'))
process.env.DSH_HOME = smokeHome
try {
  const repositoryRoot = join(smokeHome, 'repository')
  const trackedFile = join(repositoryRoot, 'example.txt')
  await mkdir(repositoryRoot)
  const runSmokeGit = (args: string[]): string => execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
  runSmokeGit(['init'])
  runSmokeGit(['branch', '-M', 'main'])
  runSmokeGit(['config', 'user.name', 'Desktop Smoke'])
  runSmokeGit(['config', 'user.email', 'desktop-smoke@example.invalid'])
  const initialLines = Array.from({ length: 16 }, (_, index) => index === 0 ? 'version one' : `line ${String(index + 1)}`)
  const secondLines = [...initialLines]
  secondLines[0] = 'version two'
  const initialText = `${initialLines.join('\n')}\n`
  const secondText = `${secondLines.join('\n')}\n`
  await writeFile(trackedFile, initialText, 'utf8')
  runSmokeGit(['add', 'example.txt'])
  runSmokeGit(['commit', '-m', 'Initial version'])
  const initialCommit = runSmokeGit(['rev-parse', 'HEAD']).trim()
  await writeFile(trackedFile, secondText, 'utf8')
  runSmokeGit(['add', 'example.txt'])
  runSmokeGit(['commit', '-m', 'Second version'])
  const remoteRoot = join(smokeHome, 'remote.git')
  runSmokeGit(['init', '--bare', remoteRoot])
  runSmokeGit(['remote', 'add', 'origin', remoteRoot])
  runSmokeGit(['push', '--set-upstream', 'origin', 'main'])
  runSmokeGit(['branch', 'alternate'])
  process.env.DSH_DESKTOP_GIT_ROOT = repositoryRoot

  const { ctx, url } = await bootDesktopTree()
  try {
    const res = await fetch(url)
    const body = await res.text()
    if (res.status !== 200) throw new Error(`SPA answered ${res.status}`)
    if (!body.includes('<title>DeepSeek Harness</title>')) throw new Error('SPA index does not look like the dsh web shell')
    if (!body.includes('<script type="module"')) throw new Error('SPA index carries no module entry')
    if (!body.includes('desktop-host')) throw new Error('host index tap did not run')
    if (!body.includes('--dsw-alias-state-business-primary')) throw new Error('appearance accent aliases were not injected')
    if (!body.includes('--dsw-font-family:var(--dsh-desktop-font)')) throw new Error('appearance typography aliases were not injected')
    if (!body.includes('--shiki-token-keyword:var(--dsh-desktop-code-keyword)')) throw new Error('appearance code theme aliases were not injected')
    const ping = await fetch(`${url}/api/desktop/ping`)
    const pingBody = await ping.text()
    if (ping.status !== 200 || pingBody !== '{"ok":true}') throw new Error(`desktop ping route answered ${ping.status} ${pingBody}`)
    const fileSearch = await fetch(`${url}/api/desktop/files/search?${new URLSearchParams({ cwd: repositoryRoot, q: 'example' }).toString()}`)
    const fileSearchBody = await fileSearch.json() as { items?: { relativePath?: unknown }[] }
    if (fileSearch.status !== 200 || fileSearchBody.items?.[0]?.relativePath !== 'example.txt') throw new Error('workspace file search failed')
    const mentionSearch = await fetch(`${url}/api/desktop/files/search?${new URLSearchParams({ cwd: repositoryRoot, q: '', mention: '1' }).toString()}`)
    const mentionSearchBody = await mentionSearch.json() as { items?: { relativePath?: unknown }[] }
    if (mentionSearch.status !== 200 || mentionSearchBody.items?.some(item => item.relativePath === 'example.txt') !== true) throw new Error('blank @ file completion failed')
    const contentSearch = await fetch(`${url}/api/desktop/workspace/search-content?${new URLSearchParams({ cwd: repositoryRoot, q: 'version' }).toString()}`)
    const contentSearchBody = await contentSearch.json() as { ok?: unknown; items?: { relativePath?: unknown; line?: unknown }[] }
    if (contentSearch.status !== 200 || contentSearchBody.ok !== true
      || contentSearchBody.items?.some(item => item.relativePath === 'example.txt' && item.line === 1) !== true) {
      throw new Error('workspace content search failed')
    }
    const projectRuns = await fetch(`${url}/api/desktop/project/runs?${new URLSearchParams({ cwd: repositoryRoot }).toString()}`)
    const projectRunsBody = await projectRuns.json() as { ok?: unknown; commands?: unknown[] }
    if (projectRuns.status !== 200 || projectRunsBody.ok !== true || !Array.isArray(projectRunsBody.commands)) throw new Error('project command detection route failed')
    const schedule = await fetch(`${url}/api/desktop/schedules?sessionId=missing-session`)
    const scheduleBody = await schedule.json() as { ok?: unknown }
    if (schedule.status !== 404 || scheduleBody.ok !== false) throw new Error('schedule route failed')
    const appearance = await fetch(`${url}/api/desktop/appearance`)
    const appearanceBody = await appearance.json() as { fontSize?: unknown }
    if (appearance.status !== 200 || typeof appearanceBody.fontSize !== 'number') throw new Error('appearance GET failed')
    const appearancePost = await fetch(`${url}/api/desktop/appearance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fontFamily: 'system-ui', fontSize: 14, accentColor: '#ff0000', codeTheme: 'github' }),
    })
    const appearancePostBody = await appearancePost.json() as { accentColor?: unknown }
    if (appearancePost.status !== 200 || appearancePostBody.accentColor !== '#ff0000') throw new Error('appearance POST failed')
    const pricing = await fetch(`${url}/api/desktop/usage/pricing`)
    const pricingBody = await pricing.json() as { defaultModel?: unknown }
    if (pricing.status !== 200 || typeof pricingBody.defaultModel !== 'string') throw new Error('pricing route failed')
    const budget = await fetch(`${url}/api/desktop/usage/budget`)
    const budgetBody = await budget.json() as { enabled?: unknown; limitUsd?: unknown }
    if (budget.status !== 200 || typeof budgetBody.enabled !== 'boolean' || typeof budgetBody.limitUsd !== 'number') throw new Error('usage budget GET failed')
    const budgetPost = await fetch(`${url}/api/desktop/usage/budget`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, period: 'monthly', limitUsd: 12, notifyAtPercent: 75 }),
    })
    const budgetPostBody = await budgetPost.json() as { limitUsd?: unknown; notifyAtPercent?: unknown }
    if (budgetPost.status !== 200 || budgetPostBody.limitUsd !== 12 || budgetPostBody.notifyAtPercent !== 75) throw new Error('usage budget POST failed')
    const budgetCheck = await fetch(`${url}/api/desktop/usage/budget/check`, { method: 'POST' })
    const budgetCheckBody = await budgetCheck.json() as { notify?: unknown; status?: { periodKey?: unknown } }
    if (budgetCheck.status !== 200 || budgetCheckBody.notify !== false || typeof budgetCheckBody.status?.periodKey !== 'string') throw new Error('usage budget check failed')
    const git = await fetch(`${url}/api/desktop/git/status`)
    const gitBody = await git.json() as {
      ok?: unknown
      repository?: unknown
      history?: { hash?: unknown; subject?: unknown }[]
      meta?: { head?: unknown }
      branches?: { name?: unknown; current?: unknown }[]
    }
    if (git.status !== 200 || gitBody.ok !== true || gitBody.repository !== true || gitBody.history?.length !== 2 || typeof gitBody.meta?.head !== 'string' || gitBody.branches?.length !== 2) {
      throw new Error('git repository history route failed')
    }
    const commitDetail = await fetch(`${url}/api/desktop/git/commit?commit=${initialCommit}`)
    const commitDetailBody = await commitDetail.json() as {
      ok?: unknown
      commit?: { hash?: unknown; changedFiles?: unknown[] }
    }
    if (commitDetail.status !== 200 || commitDetailBody.ok !== true || commitDetailBody.commit?.hash !== initialCommit || commitDetailBody.commit.changedFiles?.length !== 1) {
      throw new Error('git commit detail route failed')
    }
    const commitFile = await fetch(`${url}/api/desktop/git/commit-file?commit=${initialCommit}&path=example.txt`)
    const commitFileBody = await commitFile.json() as { ok?: unknown; file?: { path?: unknown; patch?: unknown } }
    if (commitFile.status !== 200 || commitFileBody.ok !== true || commitFileBody.file?.path !== 'example.txt'
      || typeof commitFileBody.file.patch !== 'string' || !commitFileBody.file.patch.includes('+version one')) {
      throw new Error('git commit file patch route failed')
    }
    for (const action of ['fetch', 'pull'] as const) {
      const sync = await fetch(`${url}/api/desktop/git/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const syncBody = await sync.json() as { ok?: unknown }
      if (sync.status !== 200 || syncBody.ok !== true) throw new Error(`git ${action} route failed`)
    }

    const partiallyChangedLines = [...secondLines]
    partiallyChangedLines[1] = 'line 2 changed'
    partiallyChangedLines[14] = 'line 15 changed'
    await writeFile(trackedFile, `${partiallyChangedLines.join('\n')}\n`, 'utf8')
    const hunkStatus = await fetch(`${url}/api/desktop/git/status`)
    const hunkBody = await hunkStatus.json() as {
      ok?: unknown
      hunks?: { staged?: { id: string }[]; worktree?: { id: string }[] }
    }
    if (hunkBody.ok !== true || hunkBody.hunks?.staged?.length !== 0 || hunkBody.hunks.worktree?.length !== 2) {
      throw new Error('git hunk parsing failed')
    }
    const firstWorktreeHunk = hunkBody.hunks.worktree[0]
    if (firstWorktreeHunk === undefined) throw new Error('git first worktree hunk missing')
    const stageHunk = await fetch(`${url}/api/desktop/git/hunks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'stage', hunkIds: [firstWorktreeHunk.id] }),
    })
    const stageHunkBody = await stageHunk.json() as { ok?: unknown }
    if (stageHunk.status !== 200 || stageHunkBody.ok !== true) throw new Error('git selected hunk stage failed')
    const partiallyStaged = await fetch(`${url}/api/desktop/git/status`)
    const partiallyStagedBody = await partiallyStaged.json() as {
      hunks?: { staged?: { id: string }[]; worktree?: { id: string }[] }
    }
    if (partiallyStagedBody.hunks?.staged?.length !== 1 || partiallyStagedBody.hunks.worktree?.length !== 1) {
      throw new Error('git partial staging did not preserve the unselected hunk')
    }
    const stagedHunk = partiallyStagedBody.hunks.staged[0]
    if (stagedHunk === undefined) throw new Error('git staged hunk missing')
    const unstageHunk = await fetch(`${url}/api/desktop/git/hunks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'unstage', hunkIds: [stagedHunk.id] }),
    })
    const unstageHunkBody = await unstageHunk.json() as { ok?: unknown }
    if (unstageHunk.status !== 200 || unstageHunkBody.ok !== true) throw new Error('git selected hunk unstage failed')
    const unstagedAgain = await fetch(`${url}/api/desktop/git/status`)
    const unstagedAgainBody = await unstagedAgain.json() as { hunks?: { staged?: unknown[]; worktree?: { id: string }[] } }
    if (unstagedAgainBody.hunks?.staged?.length !== 0 || unstagedAgainBody.hunks.worktree?.length !== 2) {
      throw new Error('git partial unstage did not restore both worktree hunks')
    }
    const stageAll = await fetch(`${url}/api/desktop/git/hunks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'stage-all' }),
    })
    if ((await stageAll.json() as { ok?: unknown }).ok !== true) throw new Error('git stage-all route failed')
    const unstageAll = await fetch(`${url}/api/desktop/git/hunks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'unstage-all' }),
    })
    if ((await unstageAll.json() as { ok?: unknown }).ok !== true) throw new Error('git unstage-all route failed')
    const afterUnstageAll = await fetch(`${url}/api/desktop/git/status`)
    const afterUnstageAllBody = await afterUnstageAll.json() as { hunks?: { staged?: unknown[]; worktree?: { id: string }[] } }
    if (afterUnstageAllBody.hunks?.staged?.length !== 0 || afterUnstageAllBody.hunks.worktree?.length !== 2) {
      throw new Error('git unstage-all did not restore worktree hunks')
    }
    const restagedHunk = afterUnstageAllBody.hunks.worktree[0]
    if (restagedHunk === undefined) throw new Error('git restaged hunk missing')
    const restage = await fetch(`${url}/api/desktop/git/hunks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'stage', hunkIds: [restagedHunk.id] }),
    })
    if ((await restage.json() as { ok?: unknown }).ok !== true) throw new Error('git selected hunk restage failed')
    const dirtySwitch = await fetch(`${url}/api/desktop/git/branch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'switch', branch: 'alternate' }),
    })
    const dirtySwitchBody = await dirtySwitch.json() as { ok?: unknown; code?: unknown }
    if (dirtySwitchBody.ok !== false || dirtySwitchBody.code !== 'dirty-worktree') throw new Error('git dirty branch-switch guard failed')
    const partialCommit = await fetch(`${url}/api/desktop/git/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Partial hunk' }),
    })
    const partialCommitBody = await partialCommit.json() as { ok?: unknown }
    if (partialCommit.status !== 200 || partialCommitBody.ok !== true) throw new Error('git partial commit failed')
    const afterPartialCommit = runSmokeGit(['status', '--porcelain']).trim()
    if (afterPartialCommit === '') throw new Error('git partial commit consumed the unselected hunk')
    runSmokeGit(['restore', '--', 'example.txt'])
    const push = await fetch(`${url}/api/desktop/git/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'push' }),
    })
    if ((await push.json() as { ok?: unknown }).ok !== true) throw new Error('git push route failed')
    if (runSmokeGit(['rev-parse', 'HEAD']).trim() !== runSmokeGit(['--git-dir', remoteRoot, 'rev-parse', 'refs/heads/main']).trim()) {
      throw new Error('git push did not update the remote')
    }
    const restore = await fetch(`${url}/api/desktop/git/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commit: initialCommit }),
    })
    const restoreBody = await restore.json() as { ok?: unknown; head?: unknown }
    if (restore.status !== 200 || restoreBody.ok !== true || typeof restoreBody.head !== 'string') throw new Error('git restore route failed')
    if (await readFile(trackedFile, 'utf8') !== initialText) throw new Error('git restore did not restore the selected tree')
    if (runSmokeGit(['status', '--porcelain']).trim() !== '') throw new Error('git restore left the worktree dirty')
    if (Number(runSmokeGit(['rev-list', '--count', 'HEAD']).trim()) !== 4) throw new Error('git restore did not preserve history in a new commit')
    const createBranch = await fetch(`${url}/api/desktop/git/branch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create', branch: 'smoke-feature' }),
    })
    if ((await createBranch.json() as { ok?: unknown }).ok !== true || runSmokeGit(['branch', '--show-current']).trim() !== 'smoke-feature') {
      throw new Error('git branch create route failed')
    }
    const switchBranch = await fetch(`${url}/api/desktop/git/branch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'switch', branch: 'main' }),
    })
    if ((await switchBranch.json() as { ok?: unknown }).ok !== true || runSmokeGit(['branch', '--show-current']).trim() !== 'main') {
      throw new Error('git branch switch route failed')
    }
    await writeFile(trackedFile, 'dirty change\n', 'utf8')
    const dirtyRestore = await fetch(`${url}/api/desktop/git/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commit: initialCommit }),
    })
    const dirtyRestoreBody = await dirtyRestore.json() as { ok?: unknown; code?: unknown }
    if (dirtyRestore.status !== 200 || dirtyRestoreBody.ok !== false || dirtyRestoreBody.code !== 'dirty-worktree') {
      throw new Error('git restore dirty-worktree guard failed')
    }
    const dirtyPull = await fetch(`${url}/api/desktop/git/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'pull' }),
    })
    const dirtyPullBody = await dirtyPull.json() as { ok?: unknown; code?: unknown }
    if (dirtyPullBody.ok !== false || dirtyPullBody.code !== 'dirty-worktree') throw new Error('git dirty pull guard failed')
    await writeFile(trackedFile, initialText, 'utf8')
    const memory = '# Project memory\n\n- Keep smoke tests deterministic.\n'
    const memoryWrite = await fetch(`${url}/api/desktop/project/memory?${new URLSearchParams({ cwd: repositoryRoot }).toString()}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: memory }),
    })
    if ((await memoryWrite.json() as { ok?: unknown }).ok !== true) throw new Error('project memory write failed')
    const memoryRead = await fetch(`${url}/api/desktop/project/memory?${new URLSearchParams({ cwd: repositoryRoot }).toString()}`)
    const memoryReadBody = await memoryRead.json() as { ok?: unknown; content?: unknown; sources?: unknown[] }
    if (memoryReadBody.ok !== true || memoryReadBody.content !== memory || memoryReadBody.sources?.includes('AGENTS.local.md') !== true) {
      throw new Error('project memory read failed')
    }
    const nonRepositoryRoot = join(smokeHome, 'not-a-repository')
    await mkdir(nonRepositoryRoot)
    process.env.DSH_DESKTOP_GIT_ROOT = nonRepositoryRoot
    const nonRepository = await fetch(`${url}/api/desktop/git/status`)
    const nonRepositoryBody = await nonRepository.json() as { ok?: unknown; repository?: unknown; root?: unknown }
    if (nonRepository.status !== 200 || nonRepositoryBody.ok !== true || nonRepositoryBody.repository !== false || nonRepositoryBody.root !== nonRepositoryRoot) {
      throw new Error('git non-repository status route failed')
    }
    const presetService = ctx.get('agentPresets') as { list?: () => Promise<readonly { id: string }[]> } | undefined
    const presets = await presetService?.list?.()
    if (presets?.some((preset) => preset.id === 'standard') !== true) throw new Error('shipped standard agent preset is unavailable')
    console.log(`OK: ${url} -> ${res.status} (${body.length} bytes), ping ${pingBody}; appearance and Git history/detail/restore, branch/sync/hunk states, and standard preset up`)
  } finally {
    await ctx.fiber.dispose()
  }
} finally {
  if (previousDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousDshHome
  if (previousGitRoot === undefined) delete process.env.DSH_DESKTOP_GIT_ROOT
  else process.env.DSH_DESKTOP_GIT_ROOT = previousGitRoot
  await rm(smokeHome, { recursive: true, force: true })
}
