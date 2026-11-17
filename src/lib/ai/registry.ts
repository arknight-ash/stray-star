import type { z } from 'zod';
import { log } from '../logger';
import {
  AIError,
  AIValidationError,
  safeStringify,
  userMsg,
  type AIMessage,
  type AIProvider,
  type AIErrorCode,
  type ChatOptions,
  type ImageInput,
  type VisionOptions,
} from './provider';
import type { AIIntent } from './schemas';
import { createDeepSeekProvider } from './providers/deepseek';
import { createGlmProvider } from './providers/glm';
import { mockProvider } from './providers/mock';
import { createCompatibleProvider } from './providers/openai';
import { createQwenProvider } from './providers/qwen';

export type ProviderName = 'mock' | 'openai' | 'qwen' | 'glm' | 'deepseek';

let cached: AIProvider | null = null;

/** 按 AI_PROVIDER 选择实现；缺 key 时自动回落 mock，保证链路可演示而不是直接报错。 */
export function getProvider(): AIProvider {
  if (cached) return cached;
  cached = buildProvider((process.env.AI_PROVIDER || 'mock').toLowerCase() as ProviderName);
  log.info('ai.provider_ready', { provider: cached.name, models: cached.models });
  return cached;
}

/** 仅供测试 / 单个请求临时切换使用 */
export function setProvider(provider: AIProvider | null): void {
  cached = provider;
}

function hasKey(): boolean {
  return Boolean(
    process.env.AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.QWEN_API_KEY ||
      process.env.GLM_API_KEY ||
      process.env.DEEPSEEK_API_KEY,
  );
}

function buildProvider(name: ProviderName): AIProvider {
  if (name === 'mock') return mockProvider;

  if (!hasKey()) {
    log.warn('ai.no_api_key_fallback_mock', { requested: name });
    return mockProvider;
  }

  switch (name) {
    case 'qwen':
      return createQwenProvider();
    case 'glm':
      return createGlmProvider();
    case 'deepseek':
      return createDeepSeekProvider();
    case 'openai':
    default:
      return createCompatibleProvider({
        name: 'openai',
        apiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '',
        baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
        chatModel: process.env.AI_CHAT_MODEL || 'gpt-4o-mini',
        visionModel: process.env.AI_VISION_MODEL || 'gpt-4o',
        embedModel: process.env.AI_EMBED_MODEL || 'text-embedding-3-small',
      });
  }
}

/* ────────────────── Result 风格出口（不抛异常，供 API 层使用） ────────────────── */

export type StructuredResult<T> =
  | { ok: true; data: T; provider: string }
  | { ok: false; error: AIErrorCode; provider: string; message: string; raw?: string; issues?: Array<{ path: string; message: string }> };

function toFailure<T>(provider: string, err: unknown): StructuredResult<T> {
  if (err instanceof AIError) {
    const base = {
      error: err.code,
      provider,
      message: err.message,
    };
    if (err instanceof AIValidationError) {
      return { ok: false, ...base, raw: err.raw, issues: err.issues };
    }
    return { ok: false, ...base };
  }
  const message = err instanceof Error ? err.message : String(err);
  log.error('ai.unexpected', { provider, message });
  return { ok: false, error: 'AI_UNAVAILABLE', provider, message };
}

/**
 * 面向业务的简化入口：按意图 + 提示词（可带图）取结构化结果。
 * 失败一律返回 Result，绝不把异常抛到 API 层（业务侧再走 lib/safety/fallback 兜底话术）。
 */
export interface IntentRequest {
  intent: AIIntent;
  prompt: string;
  system?: string;
  imageUrl?: string;
  /** 同一现场的其他视角（多模态 Agent 的多图输入），第一张之外的都放这里 */
  extraImageUrls?: string[];
  context?: Record<string, unknown>;
  timeoutMs?: number;
}

export async function runStructured<T>(
  req: IntentRequest,
  schema: z.ZodType<T>,
): Promise<StructuredResult<T>> {
  const provider = getProvider();
  try {
    const opts: ChatOptions & VisionOptions = {
      intent: req.intent,
      system: req.system,
      context: req.context,
      ...(req.extraImageUrls?.length ? { extraImages: req.extraImageUrls } : {}),
      ...(req.timeoutMs ? { timeoutMs: req.timeoutMs } : {}),
    };

    const data = req.imageUrl
      ? await provider.visionAnalyze(req.imageUrl, req.prompt, schema, opts)
      : await provider.chat([userMsg(req.prompt)], schema, opts);

    return { ok: true, data, provider: provider.name };
  } catch (err) {
    return toFailure<T>(provider.name, err);
  }
}

/** 多模态入口 */
export async function runVision<T>(
  image: ImageInput,
  prompt: string,
  schema: z.ZodType<T>,
  opts?: VisionOptions,
): Promise<StructuredResult<T>> {
  const provider = getProvider();
  try {
    const data = await provider.visionAnalyze(image, prompt, schema, opts);
    return { ok: true, data, provider: provider.name };
  } catch (err) {
    return toFailure<T>(provider.name, err);
  }
}

/** 纯文本对话入口（不要求结构化） */
export async function runChatText(
  messages: AIMessage[],
  opts?: ChatOptions,
): Promise<StructuredResult<string>> {
  const provider = getProvider();
  try {
    const data = await provider.chat(messages, opts);
    return { ok: true, data, provider: provider.name };
  } catch (err) {
    return toFailure<string>(provider.name, err);
  }
}

/** 向量入口：失败时抛出前先记录，供 embeddings.ts 决定是否降级 */
export async function runEmbed(text: string): Promise<number[]> {
  const provider = getProvider();
  try {
    return await provider.embed(text);
  } catch (err) {
    log.warn('ai.embed_failed', {
      provider: provider.name,
      error: err instanceof Error ? err.message : safeStringify(err, 300),
    });
    throw err;
  }
}
