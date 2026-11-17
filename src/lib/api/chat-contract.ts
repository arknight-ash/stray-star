import { z } from 'zod';
import { LIMITS } from '../constants';
import type { Citation } from '../rag/citations';

/**
 * 问答的前后端共用契约（唯一事实源）。
 * 与 health-contract / observation-contract 保持同一种写法：
 * 表单校验、API 解析、响应类型都从这里取。
 */

export const ChatRequestSchema = z.object({
  question: z
    .string()
    .trim()
    .min(4, '问题太短了，至少说清楚你在问什么')
    .max(LIMITS.question, `问题最多 ${LIMITS.question} 字`),
  /** 指定在问哪只动物；不给则由问题里的编号/名字推断 */
  animalId: z.string().trim().min(1).optional(),
  /** 幂等键：同一 clientId 在窗口内复用结果 */
  clientId: z.string().trim().max(64).optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/**
 * 引用结构。用 `z.ZodType<Citation>` 标注 —— rag/citations.ts 里的接口一旦改字段，
 * 这里会在类型检查时报错，不会悄悄漂。
 */
export const CitationSchema: z.ZodType<Citation> = z.object({
  seq: z.number().int().min(1),
  kind: z.enum(['knowledge', 'animal', 'database']),
  title: z.string(),
  snippet: z.string(),
  source: z.string(),
  score: z.number(),
  tied: z.boolean(),
  href: z.string().optional(),
  docId: z.string().optional(),
  chunkId: z.string().optional(),
  chunkIndex: z.number().int().optional(),
  animalId: z.string().optional(),
  animalCode: z.string().optional(),
  dbTopic: z.string().optional(),
});

/**
 * DATA：问的是库里的统计与名单（多少只、几条、哪些需要关注）。
 * 这类问题由本地统计作答，不经过生成器 —— 模型数不清自己没看见的行。
 */
export const ChatIntentSchema = z.enum(['KNOWLEDGE', 'ANIMAL', 'MIXED', 'DATA', 'CHATTER']);
export const ChatFallbackSchema = z.enum([
  'no_knowledge',
  'no_animal_record',
  'ai_unavailable',
  'blocked',
]);

export const ChatDataSchema = z.object({
  question: z.string(),
  answer: z.string(),
  intent: ChatIntentSchema,
  citations: z.array(CitationSchema),
  /** 唯一命中的动物；命中多只时为 null，改看 candidates */
  animal: z.object({ id: z.string(), code: z.string(), name: z.string() }).nullable(),
  /** 命中多只：列出来让用户自己挑，不替他猜 */
  candidates: z.array(z.object({ id: z.string(), code: z.string(), name: z.string() })),
  /** 走了哪种兜底；正常回答为 null */
  fallback: ChatFallbackSchema.nullable(),
  /** 不确定（低置信 或 用了原文兜底）→ UI 必须显式提示 */
  uncertain: z.boolean(),
  uncertainNote: z.string().optional(),
  /** 任何护理/健康相关结论都必须带，文案唯一来源是 constants.ts 的 DISCLAIMER */
  disclaimer: z.string(),
  /** 发生了什么降级：doc_rescue:N / citations_dropped:N / AI_SCHEMA_INVALID 等 */
  degraded: z.array(z.string()).default([]),
  timingMs: z.number(),
});

export type ChatData = z.infer<typeof ChatDataSchema>;
