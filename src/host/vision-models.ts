// Author: Zihan Wang
// <wangzh011031@163.com>
/**
 * Mark custom OpenAI-compatible models that already see images.
 * dsh-llm-pi-ai defaults `input` to text-only, so GPT/Claude/Gemini on a
 * gateway like zhhc otherwise reject `image_url`.
 */

const VISION_PREFIX = /^(gpt-|o1|o3|o4|claude-|gemini-)/i

/** Models that speak native image input on OpenAI-compatible gateways. */
export function looksNativeVision(modelId: string): boolean {
  return VISION_PREFIX.test(modelId.trim())
}

/**
 * Add `input: [text, image]` to vision model objects that still omit it.
 * Keeps the original YAML shape when possible.
 */
export function patchNativeVisionSettings(text: string): string {
  return text.replace(
    /\{\s*id:\s*["']?([A-Za-z0-9._-]+)["']?([^}]*)\}/g,
    (block, id: string) => {
      if (!looksNativeVision(id) || /\binput\s*:/.test(block)) return block
      const inner = block.slice(1, -1).trim()
      const spacer = inner.endsWith(',') || inner.length === 0 ? ' ' : ', '
      return `{ ${inner}${spacer}input: [text, image] }`
    },
  )
}
