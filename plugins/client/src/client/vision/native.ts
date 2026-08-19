// Author: Zihan Wang
// <wangzh011031@163.com>
/** Models that already accept images without a ModLens twin. */

const VISION_PREFIX = /^(gpt-|o1|o3|o4|claude-|gemini-)/i

/** GPT / Claude / Gemini and o-series on OpenAI-compatible gateways. */
export function looksNativeVision(modelId: string): boolean {
  return VISION_PREFIX.test(modelId.trim())
}
