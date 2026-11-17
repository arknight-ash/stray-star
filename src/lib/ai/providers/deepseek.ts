import { createCompatibleProvider } from './openai';

/**
 * DeepSeek（OpenAI 兼容）。DeepSeek 目前无视觉模型，
 * visionModel 回落为 deepseek-chat：管道仍会走完整的校验流程，
 * 只是图片信息不会被真正理解 —— 由 confidence 与「不确定」提示兜底。
 */
export function createDeepSeekProvider() {
  return createCompatibleProvider({
    name: 'deepseek',
    apiKey: process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY || '',
    baseUrl: process.env.AI_BASE_URL || 'https://api.deepseek.com/v1',
    chatModel: process.env.AI_CHAT_MODEL || 'deepseek-chat',
    visionModel: process.env.AI_VISION_MODEL || 'deepseek-chat',
    embedModel: process.env.AI_EMBED_MODEL || 'deepseek-chat',
    strictJson: false,
  });
}
