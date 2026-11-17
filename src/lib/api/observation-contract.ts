import { z } from 'zod';
import { LIMITS } from '../constants';
import { HealthLevelSchema } from '../ai/schemas';
import { AlertLevelSchema } from './alert-contract';

export { HealthLevelSchema };

/**
 * 众包观察的前后端共用契约（唯一事实源）。
 * 表单 UI、API 解析、响应类型都从这里取，避免两处限制各自漂移。
 */

export const ObservationTypeSchema = z.enum(['FEEDING', 'HEALTH', 'BEHAVIOR', 'OTHER']);
export type ObservationType = z.infer<typeof ObservationTypeSchema>;
export const SeveritySchema = z.enum(['MILD', 'MODERATE', 'SEVERE']);

/** 表单输入契约（UI 与 API 共用同一份 min/max，防止两处漂移） */
export const ObservationFormSchema = z.object({
  animalCode: z.string().trim().min(1, '缺少动物编号'),
  content: z
    .string()
    .trim()
    .min(1, '写点什么吧，哪怕是「喂了半碗」')
    .max(LIMITS.observation, `最多 ${LIMITS.observation} 字`),
  /**
   * 2026-10-28 起**不再接受前端指定分类**。
   * 分类是 AI 的活（`lib/observations/analyze.ts` → `ObservationAnalysisSchema.type`），
   * 契约里留一个可写的 type 就等于给"绕过 AI"留了一扇门（CLAUDE.md ★1）。
   */
  /**
   * 「情况紧急」：旧客户端 / Agent 的兼容通道，勾选后 severity 强制为 SEVERE。
   * 当前客户端 UI 已移除这个开关（严重度由 AI 判定），保留是为了不打断旧版本 App
   * 与预警规则 R4 的既有覆盖；新代码不要再传它。
   */
  severe: z.boolean().optional(),
  authorName: z.string().trim().max(LIMITS.authorName, `昵称最多 ${LIMITS.authorName} 字`).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  /**
   * 设备定位的精度半径（米，2026-10-29）。
   * 只做审计与「±12 米」这类文案，不参与是否入库的判断 ——
   * 能不能入库由校园围栏决定，精度另说。
   */
  accuracyM: z.number().min(0).max(100_000).optional(),
  clientId: z.string().trim().max(64).optional(),
});

export type ObservationForm = z.infer<typeof ObservationFormSchema>;

export const ObservationDataSchema = z.object({
  observation: z.object({
    id: z.string(),
    type: ObservationTypeSchema,
    content: z.string(),
    tags: z.array(z.string()),
    severity: SeveritySchema,
    /** 同学是否手动勾了「情况紧急」。手账上要把它显示出来：这条严重是人说的，不是 AI 猜的 */
    manualSevere: z.boolean(),
    imageUrl: z.string().nullable(),
    pendingReview: z.boolean(),
    createdAt: z.string(),
    authorName: z.string(),
  }),
  animal: z.object({
    code: z.string(),
    name: z.string(),
    healthLevel: HealthLevelSchema,
    previousHealthLevel: HealthLevelSchema,
    healthChanged: z.boolean(),
    healthReason: z.string(),
    summary: z.string().nullable(),
    summaryChanged: z.boolean(),
    observationCount: z.number(),
    pendingCount: z.number(),
  }),
  /** 成功提示原文就用这句，前端不重新拼 —— 避免两处措辞慢慢不一样 */
  toast: z.string(),
  /**
   * 本次提交命中的预警（阶段 7）。null = 没有触发任何规则。
   * 命中时给最严重的那一档 —— 一次提交可能同时踩中 R3 与 R5，
   * 但学生只需要知道"有人被通知了"，不需要看两条待办。
   */
  alert: z
    .object({ id: z.string(), level: AlertLevelSchema, reason: z.string() })
    .nullable(),
  /** 命中预警时给提交者的话；未命中为 null。措辞取自 constants.ALERT_NOTICE */
  notice: z.string().nullable(),
  /**
   * AI 本次解析的全貌（2026-10-28）。
   * 前端据此展示「AI 已为你归档」与标签组 —— 分类与严重度是模型说的，
   * 界面上必须能看见依据，而不是只丢一句"已提交"。
   */
  analysis: z.object({
    type: ObservationTypeSchema,
    severity: SeveritySchema,
    tags: z.array(z.string()),
    sentiment: z.enum(['POSITIVE', 'NEUTRAL', 'CONCERNED', 'URGENT']),
    entities: z.array(
      z.object({
        kind: z.enum(['BODY_PART', 'SYMPTOM', 'ACTION', 'FOOD', 'LOCATION', 'OBJECT']),
        text: z.string(),
      }),
    ),
    /** 模型给的一句话事实摘要（不改写用户正文） */
    summary: z.string(),
    confidence: z.number(),
    /** ai = 模型给出了结论；fallback = 模型不可用，等人工核实 */
    source: z.enum(['ai', 'fallback']),
    /** 本次是否真的看过照片 */
    withImage: z.boolean(),
    /** 是否尝试过视觉入口（失败回退文本时为 true） */
    visionAttempted: z.boolean(),
    /** 向严一侧的一致性校正说明，给审计与复盘看 */
    corrections: z.array(z.string()),
  }),
  tagsSource: z.enum(['ai', 'fallback']),
  degraded: z.object({ tagging: z.boolean(), vision: z.boolean() }),
  timingMs: z.object({ total: z.number(), tagging: z.number() }),
});

export type ObservationData = z.infer<typeof ObservationDataSchema>;
