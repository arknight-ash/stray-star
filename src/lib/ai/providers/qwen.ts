import { createCompatibleProvider } from './openai';

/** 通义千问（DashScope OpenAI 兼容模式）：qwen-plus / qwen-vl-max / text-embedding-v3 */
export function createQwenProvider() {
  return createCompatibleProvider({
    name: 'qwen',
    apiKey: process.env.QWEN_API_KEY || process.env.AI_API_KEY || '',
    baseUrl: process.env.AI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    chatModel: process.env.AI_CHAT_MODEL || 'qwen-plus',
    visionModel: process.env.AI_VISION_MODEL || 'qwen-vl-max-latest',
    embedModel: process.env.AI_EMBED_MODEL || 'text-embedding-v3',
  });
}
