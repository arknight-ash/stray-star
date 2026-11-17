import type { z } from 'zod';
import { z as zod } from 'zod';
import { EMBEDDING_DIM } from '../constants';
import { log } from '../logger';
import { moderateText } from '../safety/moderation';
import { JSON_ONLY_SUFFIX, systemFor } from './prompts';
import { normalizeModelKeys } from './normalize-keys';
import type { AIIntent } from './schemas';

/**
 * ============================================================
 * AI Provider 抽象层（第 1 阶段）
 * ============================================================
 *
 * 三个能力，签名固定：
 *   visionAnalyze(image, prompt, schema) → 结构化对象（多模态）
 *   chat(messages, schema?)             → 传 schema 得对象，不传得字符串
 *   embed(text)                         → number[]（维度统一 EMBEDDING_DIM）
 *
 * 分层：
 *   RawProvider   —— 各厂商只需实现这一层，吐原始值（unknown / string / number[]）
 *   defineProvider—— 统一管道：输入过滤 → 调用 → 输出过滤 → Zod 校验 → 失败抛 AIValidationError
 *
 * 因此 mock / openai / qwen / glm / deepseek 在调用方看来行为完全一致，
 * 换 Provider 不需要改任何业务代码。
 */

/* ────────────────── 消息与输入模型 ────────────────── */

export type AIRole = 'system' | 'user' | 'assistant';

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImageUrlPart {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export type ContentPart = TextPart | ImageUrlPart;

export interface AIMessage {
  role: AIRole;
  content: string | ContentPart[];
}

export interface UrlImage {
  kind: 'url';
  url: string;
  detail?: 'auto' | 'low' | 'high';
}

export interface Base64Image {
  kind: 'base64';
  /** 纯 base64 或完整 data URL 都可以 */
  data: string;
  mimeType?: string;
  detail?: 'auto' | 'low' | 'high';
}

export type ImageInput = UrlImage | Base64Image | string;

export interface ModelSet {
  chat: string;
  vision: string;
  embed: string;
}

export interface VisionOptions {
  system?: string;
  intent?: AIIntent;
  /** 附加上下文（档案片段 / 知识片段 / 工具结果），会被拼进 system */
  context?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /**
   * 同一现场的多张照片（2026-10-28，多模态 Agent）。
   *
   * 第一张仍然是"主图"（档案封面 / 观察记录图），这里只放**额外**的视角：
   * 伤口特写 + 全身姿态、左腿 + 右腿。多角度对健康判断的价值远大于重复拍摄，
   * 所以只在这些场景传，不限流地传 10 张只会烧 token 而不增加信息。
   * 上限由调用方控制（Agent 入口最多 3 张）。
   */
  extraImages?: string[];
}

export interface ChatOptions extends VisionOptions {
  /** 无 schema 时是否仍要求 JSON（默认 true 时加 JSON_ONLY 指令但不强制解析） */
  json?: boolean;
}

export interface EmbedOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/* ────────────────── 错误类型 ────────────────── */

export type AIErrorCode =
  | 'AI_VALIDATION_ERROR'
  | 'AI_MODERATION_BLOCKED'
  | 'AI_UNAVAILABLE'
  | 'AI_TIMEOUT';

export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly provider: string;

  constructor(code: AIErrorCode, message: string, provider: string) {
    super(message);
    this.name = 'AIError';
    this.code = code;
    this.provider = provider;
  }
}

/** 模型返回不符合 Zod 契约。raw 保留原始输出（截断），便于排查 prompt 与模型漂移。 */
export class AIValidationError extends AIError {
  readonly raw: string;
  readonly issues: Array<{ path: string; message: string }>;
  readonly intent?: string;
  readonly stage: 'vision' | 'chat' | 'embed';

  constructor(params: {
    provider: string;
    stage: 'vision' | 'chat' | 'embed';
    intent?: string;
    raw: unknown;
    issues: Array<{ path: string; message: string }>;
  }) {
    super(
      'AI_VALIDATION_ERROR',
      `AI 输出未通过结构校验（${params.provider}/${params.stage}）：${params.issues
        .slice(0, 3)
        .map((i) => `${i.path || '(root)'} ${i.message}`)
        .join('; ')}`,
      params.provider,
    );
    this.name = 'AIValidationError';
    this.raw = safeStringify(params.raw, 4000);
    this.issues = params.issues;
    this.intent = params.intent;
    this.stage = params.stage;
  }
}

/** 输入或输出命中阻断级敏感规则 */
export class AIModerationError extends AIError {
  readonly stage: 'input' | 'output';
  readonly reasons: string[];

  constructor(params: { provider: string; stage: 'input' | 'output'; reasons: string[] }) {
    super(
      'AI_MODERATION_BLOCKED',
      `内容在${params.stage === 'input' ? '输入' : '输出'}侧被安全策略拦截：${params.reasons.join('、')}`,
      params.provider,
    );
    this.name = 'AIModerationError';
    this.stage = params.stage;
    this.reasons = params.reasons;
  }
}

/** 网络 / 鉴权 / 限流等 Provider 侧故障 */
export class AIProviderError extends AIError {
  readonly cause?: unknown;

  constructor(provider: string, message: string, cause?: unknown) {
    super('AI_UNAVAILABLE', `AI 服务不可用（${provider}）：${message}`, provider);
    this.name = 'AIProviderError';
    this.cause = cause;
  }
}

export class AITimeoutError extends AIError {
  constructor(provider: string, ms: number) {
    super('AI_TIMEOUT', `AI 调用超时（${provider}，${ms}ms）`, provider);
    this.name = 'AITimeoutError';
  }
}

/* ────────────────── Provider 接口 ────────────────── */

export interface AIProvider {
  readonly name: string;
  readonly models: ModelSet;

  visionAnalyze<T>(
    image: ImageInput,
    prompt: string,
    schema: z.ZodType<T>,
    opts?: VisionOptions,
  ): Promise<T>;

  chat(messages: AIMessage[], opts?: ChatOptions): Promise<string>;
  chat<T>(messages: AIMessage[], schema: z.ZodType<T>, opts?: ChatOptions): Promise<T>;

  embed(text: string, opts?: EmbedOptions): Promise<number[]>;
  embedMany(texts: string[], opts?: EmbedOptions): Promise<number[][]>;
}

/* ────────────────── RawProvider：厂商只需实现这一层 ────────────────── */

export interface RawVisionRequest {
  imageUrl: string;
  /** 同一现场的其他视角（已是 data URL 或公网可达地址），按顺序排在主图之后 */
  extraImageUrls?: string[];
  detail: 'auto' | 'low' | 'high';
  prompt: string;
  system: string;
  intent?: AIIntent;
  /** 结构化上下文：档案片段 / 知识片段 / 工具结果 */
  context?: Record<string, unknown>;
  temperature: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface RawChatRequest {
  messages: AIMessage[];
  system: string;
  intent?: AIIntent;
  /** 结构化上下文：档案片段 / 知识片段 / 工具结果 */
  context?: Record<string, unknown>;
  /** 是否要求模型输出 JSON（用于 response_format 或提示词约束） */
  json: boolean;
  temperature: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface RawProvider {
  readonly name: string;
  readonly models: ModelSet;
  rawVision(req: RawVisionRequest): Promise<unknown>;
  rawChat(req: RawChatRequest): Promise<unknown>;
  /** signal 由管道统一注入，用于超时中断；本地实现可忽略，联网实现必须透传给 fetch */
  rawEmbed(text: string, signal?: AbortSignal): Promise<number[]>;
}

/* ────────────────── 工具函数 ────────────────── */

export function textPart(text: string): TextPart {
  return { type: 'text', text };
}

export function imagePart(url: string, detail: 'auto' | 'low' | 'high' = 'auto'): ImageUrlPart {
  return { type: 'image_url', image_url: { url, detail } };
}

export function systemMsg(text: string): AIMessage {
  return { role: 'system', content: text };
}

export function userMsg(text: string): AIMessage {
  return { role: 'user', content: text };
}

export function assistantMsg(text: string): AIMessage {
  return { role: 'assistant', content: text };
}

/** 取出一条消息里的纯文本（多模态消息只取文字部分） */
export function textOf(message: AIMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

export function lastUserText(messages: AIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return textOf(messages[i]);
  }
  return '';
}

export function allText(messages: AIMessage[]): string {
  return messages.map(textOf).join('\n');
}

/** 把 ImageInput 归一成可直接发给模型的 URL（相对路径按站点地址补全） */
export function imageToUrl(image: ImageInput): string {
  const input = typeof image === 'string' ? ({ kind: 'url', url: image } as UrlImage) : image;
  if (input.kind === 'url') return resolvePublicUrl(input.url);
  const data = input.data.includes(',') ? input.data.slice(input.data.indexOf(',') + 1) : input.data;
  return `data:${input.mimeType ?? 'image/jpeg'};base64,${data}`;
}

export function resolvePublicUrl(url: string): string {
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:')) return url;
  const base =
    process.env.AI_PUBLIC_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    '';
  if (!base) return url;
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function isZodSchema(value: unknown): value is z.ZodType<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === 'function'
  );
}

export function safeStringify(value: unknown, limit = 2000): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text == null) return '';
  return text.length > limit ? `${text.slice(0, limit)}…[truncated ${text.length - limit} chars]` : text;
}

function defaultTimeoutMs(): number {
  const raw = Number(process.env.AI_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 20_000;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  if (signal) return signal;
  return typeof AbortSignal?.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : (undefined as unknown as AbortSignal);
}

/* ────────────────── 敏感内容过滤 ────────────────── */

export interface GuardResult<T> {
  value: T;
  reasons: string[];
  blocked: boolean;
}

/**
 * 输入侧过滤：阻断级命中 → 调用方应直接拒绝；其余做脱敏后继续。
 * 这是全站唯一的 AI 输入闸门，API 层与 Provider 层共用。
 */
export function guardInput(text: string): GuardResult<string> {
  const result = moderateText(text ?? '');
  return { value: result.sanitized, reasons: result.reasons, blocked: !result.safe };
}

/** 输出侧过滤：递归遍历对象里的所有字符串字段，阻断级命中标记 blocked。 */
export function guardOutput<T>(value: T): GuardResult<T> {
  const reasons: string[] = [];
  let blocked = false;

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const r = moderateText(node);
      if (r.reasons.length) reasons.push(...r.reasons);
      if (!r.safe) blocked = true;
      return r.sanitized;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = walk(v);
      return out;
    }
    return node;
  };

  return { value: walk(value) as T, reasons: [...new Set(reasons)], blocked };
}

/** 把一组消息整体脱敏（用于 chat 的输入侧） */
export function sanitizeMessages(messages: AIMessage[]): GuardResult<AIMessage[]> {
  const reasons: string[] = [];
  let blocked = false;

  const out = messages.map((m) => {
    if (typeof m.content === 'string') {
      const r = guardInput(m.content);
      if (r.reasons.length) reasons.push(...r.reasons);
      if (r.blocked) blocked = true;
      return { ...m, content: r.value };
    }
    const parts = m.content.map((p) => {
      if (p.type !== 'text') return p;
      const r = guardInput(p.text);
      if (r.reasons.length) reasons.push(...r.reasons);
      if (r.blocked) blocked = true;
      return { ...p, text: r.value };
    });
    return { ...m, content: parts };
  });

  return { value: out, reasons: [...new Set(reasons)], blocked };
}

/* ────────────────── Zod 校验 ────────────────── */

export const EmbedVectorSchema = zod
  .array(zod.number().finite())
  .length(EMBEDDING_DIM, `embedding 维度必须为 ${EMBEDDING_DIM}`);

/**
 * 唯一校验出口：通过返回值，失败抛 AIValidationError（含原始输出）。
 * 调用方若不想抛异常，用 registry 的 runStructured / safeRun。
 *
 * 校验前先过一遍 `normalizeModelKeys`：把模型偶发的「中文键名 + 中文档位」
 * 折回契约要求的英文（见 normalize-keys.ts 里的一次真实事故）。
 * 这一步只修「格式跑偏」，不放宽任何语义校验 —— superRefine 的交叉约束照旧生效。
 */
export function validateOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  ctx: { provider: string; stage: 'vision' | 'chat' | 'embed'; intent?: string },
): T {
  const normalized = normalizeModelKeys(value);
  const parsed = schema.safeParse(normalized);
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues.slice(0, 8).map((i) => ({
    path: i.path.join('.'),
    message: i.message,
  }));

  log.error('ai.validation_failed', {
    provider: ctx.provider,
    stage: ctx.stage,
    intent: ctx.intent,
    issues,
    raw: safeStringify(value, 1200),
    // 归一化动过手才记，避免日志里出现两份一模一样的 payload
    ...(normalized !== value ? { normalized: safeStringify(normalized, 1200) } : {}),
  });

  throw new AIValidationError({
    provider: ctx.provider,
    stage: ctx.stage,
    intent: ctx.intent,
    raw: value,
    issues,
  });
}

/** 非抛版本，供需要 Result 风格的调用点使用 */
export function validateSafe<T>(
  schema: z.ZodType<T>,
  value: unknown,
): { ok: true; data: T } | { ok: false; issues: Array<{ path: string; message: string }> } {
  const parsed = schema.safeParse(normalizeModelKeys(value));
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.slice(0, 8).map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}

/** 模型输出可能是 JSON 字符串、带 ```json 代码块的字符串，或已经是对象 —— 统一成对象 */
export function coerceJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        /* fallthrough */
      }
    }
    const braces = text.match(/\{[\s\S]*\}/);
    if (braces) {
      try {
        return JSON.parse(braces[0]);
      } catch {
        /* fallthrough */
      }
    }
    return raw;
  }
}

/** 从 chat 的原始返回里取出文本（兼容字符串 / {content} / {text} / OpenAI 结构） */
export function pickText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.map(pickText).join('\n');
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.content === 'string') return obj.content;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.answer === 'string') return obj.answer;
    if (Array.isArray(obj.content)) return obj.content.map(pickText).join('\n');
  }
  return '';
}

/** 维度归一：不足补零、过长截断，避免不同厂商维度差异污染 pgvector 列 */
export function normalizeVector(vec: number[], provider: string): number[] {
  if (!Array.isArray(vec)) return vec;
  if (vec.length === EMBEDDING_DIM) return vec;
  log.warn('ai.embedding_dim_mismatch', { provider, got: vec.length, expect: EMBEDDING_DIM });
  if (vec.length > EMBEDDING_DIM) return vec.slice(0, EMBEDDING_DIM);
  return [...vec, ...new Array<number>(EMBEDDING_DIM - vec.length).fill(0)];
}

/* ────────────────── 管道：defineProvider ────────────────── */

/**
 * 上下文写进 system 时的字符上限。
 *
 * 默认 3000 对识别/健康/问答足够（上下文只有几段档案或知识片段）。
 * 但 **Agent 的决策上下文必须放宽**（2026-10-28 实测踩坑）：
 * 9 个工具的 JSON Schema 摘要单独就有 ~3150 字符，正好把 3000 的预算吃干，
 * 排在 tools 之后的 `plan` / `doneTools` 被整段截掉 —— 模型看不见"这一步已完成"，
 * 于是把同一个工具同一组参数又调一遍，一路撞到重复上限收尾，
 * 星轨上只亮一颗星、任务停在"评估完档案没写"的半途。
 * 这类"上下文被静默截断"最难查：提示词和编排都对，坏在序列化。
 */
function contextLimit(intent?: AIIntent): number {
  return intent === 'AGENT_PLAN' || intent === 'AGENT_NEXT_STEP' ? 9000 : 3000;
}

function buildSystem(
  intent: AIIntent | undefined,
  explicit: string | undefined,
  context: Record<string, unknown> | undefined,
  json: boolean,
): string {
  let system = explicit ?? systemFor(intent);
  if (context && Object.keys(context).length) {
    system += `\n\n参考上下文（JSON，只作为依据，不要照抄）：${safeStringify(
      context,
      contextLimit(intent),
    )}`;
  }
  if (json) system += JSON_ONLY_SUFFIX;
  return system;
}

/**
 * 把 RawProvider 包成带完整安全与校验管道的 AIProvider。
 * 管道顺序：输入过滤 → 超时/中断 → 调用 → 输出过滤 → Zod 校验 → 返回。
 */
export function defineProvider(impl: RawProvider): AIProvider {
  const name = impl.name;

  function toAIError(err: unknown, stage: string, timeoutMs: number): AIError {
    if (err instanceof AIError) return err;
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      log.error('ai.timeout', { provider: name, stage, timeoutMs });
      return new AITimeoutError(name, timeoutMs);
    }
    const message = err instanceof Error ? err.message : String(err);
    log.error('ai.provider_failed', { provider: name, stage, message });
    return new AIProviderError(name, message, err);
  }

  async function visionAnalyze<T>(
    image: ImageInput,
    prompt: string,
    schema: z.ZodType<T>,
    opts: VisionOptions = {},
  ): Promise<T> {
    const input = typeof image === 'string' ? ({ kind: 'url', url: image } as UrlImage) : image;
    const guarded = guardInput(prompt ?? '');
    if (guarded.blocked) {
      log.warn('ai.input_blocked', { provider: name, stage: 'vision', reasons: guarded.reasons });
      throw new AIModerationError({ provider: name, stage: 'input', reasons: guarded.reasons });
    }
    if (guarded.reasons.length) {
      log.info('ai.input_sanitized', { provider: name, stage: 'vision', reasons: guarded.reasons });
    }

    const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs();
    try {
      const extras = (opts.extraImages ?? [])
        .filter((u) => typeof u === 'string' && u.length > 0)
        .slice(0, 3)
        .map((u) => imageToUrl(u));
      const raw = await impl.rawVision({
        imageUrl: imageToUrl(input),
        ...(extras.length ? { extraImageUrls: extras } : {}),
        detail: input.kind === 'base64' ? 'auto' : ((input as UrlImage).detail ?? 'auto'),
        prompt: guarded.value,
        system: buildSystem(opts.intent, opts.system, opts.context, true),
        intent: opts.intent,
        context: opts.context,
        temperature: opts.temperature ?? 0.2,
        maxTokens: opts.maxTokens,
        signal: withTimeout(opts.signal, timeoutMs),
      });

      const value = guardOutput<unknown>(coerceJson(raw));
      if (value.blocked) {
        log.warn('ai.output_blocked', { provider: name, stage: 'vision', reasons: value.reasons });
        throw new AIModerationError({ provider: name, stage: 'output', reasons: value.reasons });
      }
      return validateOrThrow(schema, value.value, { provider: name, stage: 'vision', intent: opts.intent });
    } catch (err) {
      throw toAIError(err, 'vision', timeoutMs);
    }
  }

  async function chat(
    messages: AIMessage[],
    schemaOrOpts?: z.ZodType<unknown> | ChatOptions,
    maybeOpts?: ChatOptions,
  ): Promise<unknown> {
    const hasSchema = isZodSchema(schemaOrOpts);
    const schema = hasSchema ? (schemaOrOpts as z.ZodType<unknown>) : undefined;
    // 注意：调用方可能写成 chat(msgs, undefined, opts)——schema 动态可选时很常见。
    // 此时 hasSchema 为 false，若只看第二位就会把第三位的 opts 整个丢掉：
    // timeoutMs / system / context 被静默忽略，超时保护随之失效。故兜一层 maybeOpts。
    const opts: ChatOptions =
      (hasSchema ? maybeOpts : (schemaOrOpts as ChatOptions | undefined)) ?? maybeOpts ?? {};

    const guarded = sanitizeMessages(messages ?? []);
    if (guarded.blocked) {
      log.warn('ai.input_blocked', { provider: name, stage: 'chat', reasons: guarded.reasons });
      throw new AIModerationError({ provider: name, stage: 'input', reasons: guarded.reasons });
    }
    if (guarded.reasons.length) {
      log.info('ai.input_sanitized', { provider: name, stage: 'chat', reasons: guarded.reasons });
    }

    const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs();
    const wantsJson = schema ? true : (opts.json ?? false);

    try {
      const raw = await impl.rawChat({
        messages: guarded.value,
        system: buildSystem(opts.intent, opts.system, opts.context, wantsJson),
        intent: opts.intent,
        context: opts.context,
        json: wantsJson,
        temperature: opts.temperature ?? 0.2,
        maxTokens: opts.maxTokens,
        signal: withTimeout(opts.signal, timeoutMs),
      });

      // 无 schema：返回文本，仅做脱敏
      if (!schema) {
        const cleaned = guardOutput<string>(pickText(raw));
        if (cleaned.blocked) {
          log.warn('ai.output_blocked', { provider: name, stage: 'chat', reasons: cleaned.reasons });
          throw new AIModerationError({ provider: name, stage: 'output', reasons: cleaned.reasons });
        }
        return cleaned.value;
      }

      const value = guardOutput<unknown>(coerceJson(raw));
      if (value.blocked) {
        log.warn('ai.output_blocked', { provider: name, stage: 'chat', reasons: value.reasons });
        throw new AIModerationError({ provider: name, stage: 'output', reasons: value.reasons });
      }
      return validateOrThrow(schema, value.value, { provider: name, stage: 'chat', intent: opts.intent });
    } catch (err) {
      throw toAIError(err, 'chat', timeoutMs);
    }
  }

  async function embed(text: string, opts?: EmbedOptions): Promise<number[]> {
    const guarded = guardInput(text ?? '');
    // embed 用于检索，不做阻断（脱敏即可），避免正常记录被误杀
    if (guarded.reasons.length) {
      log.info('ai.input_sanitized', { provider: name, stage: 'embed', reasons: guarded.reasons });
    }
    const timeoutMs = opts?.timeoutMs ?? defaultTimeoutMs();
    try {
      const vec = await impl.rawEmbed(guarded.value, withTimeout(opts?.signal, timeoutMs));
      return validateOrThrow(EmbedVectorSchema, normalizeVector(vec, name), {
        provider: name,
        stage: 'embed',
      });
    } catch (err) {
      throw toAIError(err, 'embed', timeoutMs);
    }
  }

  async function embedMany(texts: string[], opts?: EmbedOptions): Promise<number[][]> {
    const out: number[][] = [];
    for (const t of texts) out.push(await embed(t, opts));
    return out;
  }

  return {
    name,
    models: impl.models,
    visionAnalyze: visionAnalyze as AIProvider['visionAnalyze'],
    chat: chat as AIProvider['chat'],
    embed,
    embedMany,
  };
}
