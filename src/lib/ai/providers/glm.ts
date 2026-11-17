import { createCompatibleProvider } from './openai';

/**
 * 智谱 GLM（bigmodel.cn，OpenAI 兼容模式）。
 *
 * 默认走 glm-4.6v-flash：多模态 + 文本同一个模型，看图与问答不必再分两家。
 * 但免费档高峰期会大量返回 429 / 业务码 1305（"访问量过大"），
 * 所以配了降级链：先同模型重试，再换同类模型兜住，别让用户看到"AI 不可用"。
 *
 * 环境变量（都可选）：
 *  - GLM_API_KEY               密钥
 *  - AI_BASE_URL               默认 https://open.bigmodel.cn/api/paas/v4
 *  - AI_MODEL                  文本 + 视觉共用一个模型的快捷写法
 *  - AI_CHAT_MODEL             单独指定文本模型（优先于 AI_MODEL）
 *  - AI_VISION_MODEL           单独指定视觉模型（优先于 AI_MODEL）
 *  - AI_FALLBACK_MODELS        文本降级链，逗号分隔
 *  - AI_VISION_FALLBACK_MODELS 视觉降级链，逗号分隔
 *  - AI_ATTEMPT_TIMEOUT_MS     单个模型单次尝试的超时，默认 12000
 *  - AI_THINKING               思考链开关：disabled（默认）/ enabled / 留空不传参数
 *
 * 为什么默认关思考链：glm-4.5/4.6 默认先输出一大段 reasoning_content，
 * 实测同一句话 17s vs 1.3s，而本项目的输出全是严格 JSON 契约，
 * 需求判断不需要那串自问自答。遇到确实要推理的场景再把 AI_THINKING=enabled 打开。
 */
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_MODEL = 'glm-4.6v-flash';

/** 文本降级链：glm-4.5-flash 便宜稳定；glm-4.5v 多模态，能兜住带图但走文本入口的请求 */
const DEFAULT_FALLBACKS = ['glm-4.5-flash', 'glm-4.5v'];
/** 视觉降级链只能是视觉模型，否则等于让模型"闭眼看图"编答案 */
const DEFAULT_VISION_FALLBACKS = ['glm-4.5v', 'glm-4v-flash'];

function list(value: string | undefined, fallback: string[]): string[] {
  const items = (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number((value ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function createGlmProvider() {
  const shared = process.env.AI_MODEL?.trim() || '';
  // disabled / enabled 才下发；留空表示不干预厂商默认
  const thinking = process.env.AI_THINKING?.trim().toLowerCase();
  const extraBody =
    thinking === 'disabled' || thinking === 'enabled'
      ? ({ thinking: { type: thinking } } as Record<string, unknown>)
      : {};

  return createCompatibleProvider({
    name: 'glm',
    apiKey: process.env.GLM_API_KEY || process.env.AI_API_KEY || '',
    baseUrl: process.env.AI_BASE_URL?.trim() || DEFAULT_BASE_URL,
    chatModel: process.env.AI_CHAT_MODEL?.trim() || shared || DEFAULT_MODEL,
    visionModel: process.env.AI_VISION_MODEL?.trim() || shared || DEFAULT_MODEL,
    embedModel: process.env.AI_EMBED_MODEL?.trim() || 'embedding-3',
    fallbackModels: list(process.env.AI_FALLBACK_MODELS, DEFAULT_FALLBACKS),
    visionFallbackModels: list(process.env.AI_VISION_FALLBACK_MODELS, DEFAULT_VISION_FALLBACKS),
    attemptTimeoutMs: num(process.env.AI_ATTEMPT_TIMEOUT_MS, 12_000),
    extraBody,
  });
}
