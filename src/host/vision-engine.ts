// Author: Zihan Wang
// <wangzh011031@163.com>
/**
 * ModLens engine config (~/.modlens/config.json). Desktop settings read a
 * redacted view and write keys without echoing them back.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

export const MODLENS_DIR_NAME = '.modlens'
export const MODLENS_CONFIG_NAME = 'config.json'
export const MAX_SECRET_LENGTH = 512
export const MIN_SECRET_LENGTH = 8
export const MAX_URL_LENGTH = 512
export const MAX_MODEL_LENGTH = 128

export type VisionEngineId = 'gemini-api' | 'openai'

export interface VisionEnginePublic {
  provider: VisionEngineId
  geminiConfigured: boolean
  geminiHint: string
  openaiConfigured: boolean
  openaiHint: string
  openaiBaseUrl: string
  openaiModel: string
}

export interface VisionEnginePatch {
  provider?: VisionEngineId
  geminiApiKey?: string
  openaiApiKey?: string
  openaiBaseUrl?: string
  openaiModel?: string
}

export function modlensConfigPath(home = homedir()): string {
  return join(home, MODLENS_DIR_NAME, MODLENS_CONFIG_NAME)
}

export function parseModlensFile(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown
    return asRecord(value) ?? {}
  } catch {
    return {}
  }
}

export function parseVisionPatch(value: unknown): VisionEnginePatch | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const patch: VisionEnginePatch = {}
  if (record.provider !== undefined) {
    const provider = asEngineId(record.provider)
    if (provider === undefined) return undefined
    patch.provider = provider
  }
  const geminiApiKey = optionalSecret(record.geminiApiKey)
  if (geminiApiKey === 'invalid') return undefined
  if (geminiApiKey !== undefined) patch.geminiApiKey = geminiApiKey
  const openaiApiKey = optionalSecret(record.openaiApiKey)
  if (openaiApiKey === 'invalid') return undefined
  if (openaiApiKey !== undefined) patch.openaiApiKey = openaiApiKey
  const openaiBaseUrl = optionalUrl(record.openaiBaseUrl)
  if (openaiBaseUrl === 'invalid') return undefined
  if (openaiBaseUrl !== undefined) patch.openaiBaseUrl = openaiBaseUrl
  const openaiModel = optionalModel(record.openaiModel)
  if (openaiModel === 'invalid') return undefined
  if (openaiModel !== undefined) patch.openaiModel = openaiModel
  if (patch.provider === undefined
    && patch.geminiApiKey === undefined
    && patch.openaiApiKey === undefined
    && patch.openaiBaseUrl === undefined
    && patch.openaiModel === undefined) return undefined
  return patch
}

export function applyVisionPatch(
  config: Record<string, unknown>,
  patch: VisionEnginePatch,
): Record<string, unknown> {
  const next = { ...config }
  if (patch.provider !== undefined) next.provider = patch.provider
  if (patch.geminiApiKey !== undefined) setProviderField(next, 'gemini-api', 'apiKey', patch.geminiApiKey)
  if (patch.openaiApiKey !== undefined) setProviderField(next, 'openai', 'apiKey', patch.openaiApiKey)
  if (patch.openaiBaseUrl !== undefined) setProviderField(next, 'openai', 'baseUrl', patch.openaiBaseUrl)
  if (patch.openaiModel !== undefined) setProviderField(next, 'openai', 'model', patch.openaiModel)
  return next
}

export function toPublicView(config: Record<string, unknown>): VisionEnginePublic {
  const gemini = providerEntry(config, 'gemini-api') ?? providerEntry(config, 'gemini')
  const openai = providerEntry(config, 'openai')
  const geminiKey = asString(gemini?.apiKey)
  const openaiKey = asString(openai?.apiKey)
  return {
    provider: resolveProvider(config),
    geminiConfigured: geminiKey !== undefined,
    geminiHint: keyHint(geminiKey),
    openaiConfigured: openaiKey !== undefined,
    openaiHint: keyHint(openaiKey),
    openaiBaseUrl: asString(openai?.baseUrl) ?? '',
    openaiModel: asString(openai?.model) ?? '',
  }
}

export function resolveProvider(config: Record<string, unknown>): VisionEngineId {
  const raw = asString(config.provider)
  if (raw === 'gemini-api' || raw === 'gemini') return 'gemini-api'
  if (raw === 'openai' || raw === 'openai-compat') return 'openai'
  return 'gemini-api'
}

export function keyHint(key: string | undefined): string {
  if (key === undefined || key.length === 0) return ''
  if (key.length <= 8) return '已配置'
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}

function setProviderField(
  config: Record<string, unknown>,
  name: string,
  field: string,
  value: string,
): void {
  const providers = { ...(asRecord(config.providers) ?? {}) }
  const entry = { ...(asRecord(providers[name]) ?? {}) }
  entry[field] = value
  providers[name] = entry
  config.providers = providers
}

function providerEntry(config: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  return asRecord(asRecord(config.providers)?.[name])
}

function asEngineId(value: unknown): VisionEngineId | undefined {
  return value === 'gemini-api' || value === 'openai' ? value : undefined
}

function optionalSecret(value: unknown): string | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return 'invalid'
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  if (trimmed.length < MIN_SECRET_LENGTH || trimmed.length > MAX_SECRET_LENGTH) return 'invalid'
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return 'invalid'
  return trimmed
}

function optionalUrl(value: unknown): string | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return 'invalid'
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  if (trimmed.length > MAX_URL_LENGTH) return 'invalid'
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'invalid'
  } catch {
    return 'invalid'
  }
  return trimmed
}

function optionalModel(value: unknown): string | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return 'invalid'
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  if (trimmed.length > MAX_MODEL_LENGTH || !/^[A-Za-z0-9._:/-]+$/.test(trimmed)) return 'invalid'
  return trimmed
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}
