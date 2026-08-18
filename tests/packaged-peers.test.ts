// Author: Zihan Wang
// <wangzh011031@163.com>
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

function readJson(path: string): { name?: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(path, 'utf8')) as {
    name?: string
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }
}

function installedPackageJsons(): string[] {
  const pnpm = join(ROOT, 'node_modules/.pnpm')
  const paths: string[] = []
  for (const dir of readdirSync(pnpm)) {
    const modules = join(pnpm, dir, 'node_modules')
    if (!existsSync(modules)) continue
    for (const entry of readdirSync(modules)) {
      const entryPath = join(modules, entry)
      if (entry.startsWith('@')) {
        if (!existsSync(entryPath)) continue
        for (const name of readdirSync(entryPath)) {
          const pkgPath = join(entryPath, name, 'package.json')
          if (existsSync(pkgPath)) paths.push(pkgPath)
        }
      } else {
        const pkgPath = join(entryPath, 'package.json')
        if (existsSync(pkgPath)) paths.push(pkgPath)
      }
    }
  }
  return paths
}

function missingProductionPeers(): string[] {
  const rootPkg = readJson(join(ROOT, 'package.json'))
  const rootDeps = new Set(Object.keys(rootPkg.dependencies ?? {}))
  const depEdges = new Map<string, Set<string>>()
  const peerEdges = new Map<string, Set<string>>()
  const installed = new Set<string>()

  for (const pkgPath of installedPackageJsons()) {
    const pkg = readJson(pkgPath)
    if (pkg.name === undefined) continue
    installed.add(pkg.name)
    const deps = depEdges.get(pkg.name) ?? new Set<string>()
    for (const name of Object.keys(pkg.dependencies ?? {})) deps.add(name)
    depEdges.set(pkg.name, deps)
    const peers = peerEdges.get(pkg.name) ?? new Set<string>()
    for (const name of Object.keys(pkg.peerDependencies ?? {})) peers.add(name)
    peerEdges.set(pkg.name, peers)
  }

  const reachable = new Set<string>()
  const queue = [...rootDeps]
  while (queue.length > 0) {
    const name = queue.pop()
    if (name === undefined || reachable.has(name)) continue
    reachable.add(name)
    for (const dep of depEdges.get(name) ?? []) {
      if (!reachable.has(dep)) queue.push(dep)
    }
  }

  const missing = new Set<string>()
  for (const name of reachable) {
    for (const peer of peerEdges.get(name) ?? []) {
      if (!peer.startsWith('@deepseek-ai/')) continue
      if (!installed.has(peer)) continue
      if (!reachable.has(peer)) missing.add(peer)
    }
  }
  return [...missing].sort()
}

test('production dependency walk includes every installed Harness peer', () => {
  assert.deepEqual(missingProductionPeers(), [])
  assert.equal(existsSync(join(ROOT, 'node_modules/@deepseek-ai/dsh-timeout/package.json')), true)
})
