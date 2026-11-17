import { EMBEDDING_DIM } from '../../constants';
import { log } from '../../logger';
import {
  defineProvider,
  imagePart,
  pickText,
  textPart,
  type AIProvider,
  type RawProvider,
} from '../provider';

/**
 * OpenAI 兼容 Provider。
 * GPT-4o / 通义千问 VL / GLM-4V / DeepSeek 都走 /chat/completions + /embeddings，
 * 因此这里只实现一份，各家通过 baseUrl + 模型名区分（见 qwen.ts / glm.ts / deepseek.ts）。
 *
 * 兼容性处理：
 *  - 部分厂商不支持 response_format=json_object → 400 时自动去掉该字段重试
 *  - 部分厂商不支持 dimensions 参数 → 400 时自动去掉并做维度归一
 *  - 输出可能是 JSON 字符串 / 带 ```json 代码块 → 由 provider 管道的 coerceJson 兜底
 */

export interface CompatibleConfig {
  name: string;
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  visionModel: string;
  embedModel: string;
  /** 是否强制 response_format=json_object（不支持的厂商设为 false） */
  strictJson?: boolean;
  extraHeaders?: Record<string, string>;
  /** 主模型过载/限流时按顺序降级的备选（文本链路） */
  fallbackModels?: string[];
  /** 视觉链路单独的降级链：不能降到纯文本模型，否则等于让模型"闭眼看图" */
  visionFallbackModels?: string[];
  /** 厂商扩展参数，原样并入每次请求体（如智谱的 thinking） */
  extraBody?: Record<string, unknown>;
  /**
   * 单个模型单次尝试的超时预算（毫秒）。
   *
   * 必须比外层总预算小：外层的 timeout 是**整条降级链共用**的，主模型一旦"卡住但不断开"
   * （不返 429、也不返 200，就是慢），总预算会被一家吃光，备选模型一次都轮不到，
   * 用户看到的就是转 30 秒然后"认不出来"。给每次尝试独立预算，主模型超时就换下一家。
   */
  attemptTimeoutMs?: number;
}

/** 上游返回非 2xx。保留 status + 原始 body，供是否重试的判断使用 */
class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
/**
 * 有些厂商把"过载"写在业务码里而不是 HTTP 状态上（智谱 1305「访问量过大」）。
 * 免费档模型尤其常见，这类错误重试或换备选模型就能过。
 */
const OVERLOAD_HINT = /"code"\s*:\s*"?1305|访问量过大|overloaded|too many requests|rate.?limit/i;

const MAX_ATTEMPTS_PER_MODEL = 2;
const RETRY_BACKOFF_MS = 300;
/** 单模型单次尝试的默认预算：够 4.5v 看图（实测 6s+），又不至于把总预算耗死在一家 */
const DEFAULT_ATTEMPT_TIMEOUT_MS = 12_000;

function shouldRetry(err: unknown): boolean {
  if (!(err instanceof UpstreamError)) return false;
  return RETRYABLE_STATUS.has(err.status) || OVERLOAD_HINT.test(err.body);
}

/** fetch 被中断：可能是单次尝试超时，也可能是外层总预算耗尽，调用方需区分 */
function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

/**
 * 给单次尝试拼一个独立超时信号。
 * 外层 signal（总预算 / 用户取消）仍然生效，两者谁先触发就中断谁。
 */
function attemptSignal(outer: AbortSignal | undefined, ms: number): AbortSignal {
  const own = AbortSignal.timeout(ms);
  if (!outer) return own;
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([outer, own]) : own;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createCompatibleProvider(cfg: CompatibleConfig): AIProvider {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
    ...(cfg.extraHeaders ?? {}),
  };

  async function request(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const send = async (payload: Record<string, unknown>) => {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        ...(signal ? { signal } : {}),
      });
      return { res, text: await res.text() };
    };

    let { res, text } = await send(body);

    // 降级 1：不支持 response_format
    if (
      !res.ok &&
      res.status === 400 &&
      'response_format' in body &&
      /response_format|json_object|unsupported/i.test(text)
    ) {
      log.warn('ai.response_format_unsupported', { provider: cfg.name });
      const retry = { ...body };
      delete retry.response_format;
      ({ res, text } = await send(retry));
    }

    // 降级 2：不支持 dimensions
    if (
      !res.ok &&
      res.status === 400 &&
      'dimensions' in body &&
      /dimensions|unsupported/i.test(text)
    ) {
      log.warn('ai.dimensions_unsupported', { provider: cfg.name });
      const retry = { ...body };
      delete retry.dimensions;
      ({ res, text } = await send(retry));
    }

    // 降级 3：不支持 thinking / reasoning_effort 这类扩展参数（老模型常见）
    if (
      !res.ok &&
      res.status === 400 &&
      ('thinking' in body || 'reasoning_effort' in body) &&
      /thinking|reasoning_effort|unrecognized|unknown|invalid.*(param|argument)/i.test(text)
    ) {
      log.warn('ai.thinking_unsupported', { provider: cfg.name });
      const retry = { ...body };
      delete retry.thinking;
      delete retry.reasoning_effort;
      ({ res, text } = await send(retry));
    }

    if (!res.ok) {
      throw new UpstreamError(
        res.status,
        text,
        `${cfg.name} ${path} 返回 ${res.status}: ${text.slice(0, 300)}`,
      );
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new UpstreamError(
        res.status,
        text,
        `${cfg.name} ${path} 返回非 JSON 内容: ${text.slice(0, 200)}`,
      );
    }
  }

  /**
   * 调 /chat/completions，主模型过载时按 fallback 链降级。
   *
   * 为什么要这一层：glm-4.6v-flash 这类免费视觉模型高峰期大量返回 429 + 1305，
   * 直接抛错会让用户看到"AI 不可用"，但它其实只是这一刻排队。先原模型重试一次，
   * 再换同类备选模型，比把错误抛到前端有用得多。
   */
  async function chatOnce(
    primary: string,
    fallbacks: string[],
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const chain = [primary, ...fallbacks].filter((m, i, arr) => m && arr.indexOf(m) === i);
    const perAttempt = cfg.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
    let last: unknown = null;

    for (let mi = 0; mi < chain.length; mi += 1) {
      const model = chain[mi]!;
      for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt += 1) {
        if (signal?.aborted) throw last ?? new Error(`${cfg.name} 请求已取消`);
        try {
          const data = (await request(
            '/chat/completions',
            { ...body, model },
            attemptSignal(signal, perAttempt),
          )) as {
            choices?: Array<{ message?: { content?: unknown }; text?: string }>;
            error?: { code?: string | number; message?: string };
          };

          // 少数厂商在 HTTP 200 里塞 error 体：必须显式判掉，否则会被当成"空回答"
          if (data.error) {
            throw new UpstreamError(
              200,
              JSON.stringify(data.error),
              `${cfg.name} 业务错误 ${data.error.code ?? ''}: ${data.error.message ?? ''}`,
            );
          }

          if (mi > 0) log.warn('ai.model_fallback', { provider: cfg.name, primary, used: model });

          const raw = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '';
          return typeof raw === 'string' ? raw : pickText(raw);
        } catch (err) {
          last = err;

          // 外层总预算已耗尽（或用户取消）：再换模型也没有时间，直接把错误抛出去
          if (signal?.aborted) throw err;

          // 单次尝试超时：同一模型再试一次多半还是慢，直接让位给备选模型
          if (isAbort(err)) {
            log.warn('ai.attempt_timeout', {
              provider: cfg.name,
              model,
              attemptTimeoutMs: perAttempt,
            });
            break;
          }

          if (!shouldRetry(err)) throw err;
          if (attempt + 1 < MAX_ATTEMPTS_PER_MODEL) await sleep(RETRY_BACKOFF_MS * (attempt + 1));
        }
      }

      if (mi + 1 < chain.length) {
        log.warn('ai.model_overloaded_next', {
          provider: cfg.name,
          model,
          next: chain[mi + 1],
          reason: isAbort(last) ? 'timeout' : 'upstream',
        });
      }
    }

    throw last instanceof Error ? last : new Error(`${cfg.name} 所有模型均不可用`);
  }

  const impl: RawProvider = {
    name: cfg.name,
    models: { chat: cfg.chatModel, vision: cfg.visionModel, embed: cfg.embedModel },

    async rawVision(req) {
      return chatOnce(
        cfg.visionModel,
        cfg.visionFallbackModels ?? cfg.fallbackModels ?? [],
        {
          temperature: req.temperature,
          ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
          ...(cfg.extraBody ?? {}),
          ...(cfg.strictJson === false ? {} : { response_format: { type: 'json_object' } }),
          messages: [
            { role: 'system', content: req.system },
            {
              role: 'user',
              content: [
                textPart(req.prompt),
                imagePart(req.imageUrl, req.detail),
                // 多角度照片：同一轮里排在主图后面，模型看到的是「同一个体的不同视角」而不是几张无关图片
                ...(req.extraImageUrls ?? []).map((url) => imagePart(url, 'auto')),
              ],
            },
          ],
        },
        req.signal,
      );
    },

    async rawChat(req) {
      return chatOnce(
        cfg.chatModel,
        cfg.fallbackModels ?? [],
        {
          temperature: req.temperature,
          ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
          ...(cfg.extraBody ?? {}),
          ...(req.json && cfg.strictJson !== false
            ? { response_format: { type: 'json_object' } }
            : {}),
          messages: [{ role: 'system', content: req.system }, ...req.messages],
        },
        req.signal,
      );
    },

    async rawEmbed(text, signal) {
      const data = (await request(
        '/embeddings',
        { model: cfg.embedModel, input: text, dimensions: EMBEDDING_DIM },
        signal,
      )) as { data?: Array<{ embedding?: number[] }> };
      const vec = data.data?.[0]?.embedding;
      if (!vec?.length) throw new Error(`${cfg.name} 未返回 embedding`);
      return vec;
    },
  };

  return defineProvider(impl);
}
