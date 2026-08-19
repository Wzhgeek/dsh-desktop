// Author: Zihan Wang
// <wangzh011031@163.com>
/** Host client for the desktop vision-engine settings page. */

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

export async function fetchVisionEngine(): Promise<VisionEnginePublic> {
  const response = await fetch('/api/desktop/vision-engine')
  const value = await response.json() as VisionEnginePublic & { ok?: boolean; error?: string }
  if (!response.ok || value.ok === false) throw new Error(value.error ?? '无法读取识图配置')
  return value
}

export async function saveVisionEngine(patch: VisionEnginePatch): Promise<VisionEnginePublic> {
  const response = await fetch('/api/desktop/vision-engine', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const value = await response.json() as VisionEnginePublic & { ok?: boolean; error?: string }
  if (!response.ok || value.ok === false) throw new Error(value.error ?? '无法保存识图配置')
  return value
}
