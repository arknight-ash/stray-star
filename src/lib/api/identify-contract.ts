import { z } from 'zod';
import { LIMITS } from '../constants';
import { HealthLevelSchema, SpeciesResultSchema } from '../ai/schemas';

export { HealthLevelSchema };

/**
 * 识别 / 建档的前后端共用契约（唯一事实源）。
 * UI 表单校验、API 入参解析、响应类型都从这里取，避免两头各写一份 Zod 后慢慢漂移。
 */

export const SpeciesSchema = z.enum(['CAT', 'DOG']);
export const SuggestedSpeciesSchema = z.enum(['CAT', 'DOG', 'UNKNOWN']);

export const AnimalSummarySchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  species: SpeciesSchema,
  avatarUrl: z.string().nullable(),
  healthLevel: HealthLevelSchema,
  /** 匿名建档的档案为 true，UI 必须显示「待管理员核实」 */
  pendingReview: z.boolean(),
  lastSeenAt: z.string().nullable(),
  mapLat: z.number().nullable(),
  mapLng: z.number().nullable(),
});

export const CandidateSchema = z.object({
  animalId: z.string(),
  code: z.string(),
  name: z.string(),
  species: SpeciesSchema,
  avatarUrl: z.string().nullable(),
  pendingReview: z.boolean(),
  score: z.number(),
});

/** /api/identify 的响应 data：按 matched 判别联合，UI 只需 switch tier */
const IdentifyBase = {
  /** 本次使用的照片（重跑与建档复用，不必二次上传） */
  photoUrl: z.string().nullable(),
  /** 视觉侧看到的外观特征，结果页做「AI 看到了什么」透明展示 */
  features: z.array(z.string()),
  /** 是否必须展示「不确定」提示 */
  uncertain: z.boolean(),
  degraded: z.object({ vision: z.boolean(), embedding: z.boolean() }),
  timingMs: z.object({ total: z.number(), vision: z.number(), embed: z.number(), search: z.number() }),
  /** 命中了哪几道闸门，便于自检断言与线上排查 */
  reasons: z.array(z.string()),
  note: z.string().optional(),
};

export const IdentifyMatchedSchema = z.object({
  ...IdentifyBase,
  tier: z.literal('matched'),
  matched: z.literal(true),
  animal: AnimalSummarySchema,
  confidence: z.number(),
});

export const IdentifyUnmatchedSchema = z.object({
  ...IdentifyBase,
  tier: z.enum(['candidate', 'new']),
  matched: z.literal(false),
  suggestedSpecies: SuggestedSpeciesSchema,
  confidence: z.number(),
  candidates: z.array(CandidateSchema),
});

export const IdentifyDataSchema = z.discriminatedUnion('matched', [
  IdentifyMatchedSchema,
  IdentifyUnmatchedSchema,
]);

/**
 * 自测注入契约（2026-10-29）：识别链路「视觉 + 检索」两段的输入。
 *
 * 只在 /api/identify 路由开启 E2E_TESTS=1 时才解析这个字段，生产一律忽略 ——
 * 否则任何人都能直接指定候选池，把识别结果当旋钮拨。
 * 形状与上限一律由 Zod 卡住，不信任何外来 JSON。
 */
export const IdentifyInjectSchema = z.object({
  species: SpeciesResultSchema.optional(),
  hits: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        code: z.string().min(1).max(24),
        name: z.string().max(24),
        species: SpeciesSchema,
        avatarUrl: z.string().nullable().default(null),
        healthLevel: HealthLevelSchema,
        pendingReview: z.boolean().default(false),
        summary: z.string().max(300).nullable().default(null),
        features: z.array(z.string().max(40)).max(8).default([]),
        score: z.number().min(0).max(1),
      }),
    )
    .max(10)
    .optional(),
});

export type IdentifyInject = z.infer<typeof IdentifyInjectSchema>;

export type IdentifyData = z.infer<typeof IdentifyDataSchema>;
export type AnimalSummary = z.infer<typeof AnimalSummarySchema>;
export type CandidateVM = z.infer<typeof CandidateSchema>;
export type SuggestedSpecies = z.infer<typeof SuggestedSpeciesSchema>;

/** 建档表单：前端 zodResolver 与后端 form 解析共用 */
export const CreateAnimalFormSchema = z.object({
  name: z.string().trim().min(1, '给它起个名字吧').max(LIMITS.name, `名字不超过 ${LIMITS.name} 字`),
  species: z.union([SpeciesSchema, z.literal('UNKNOWN')]).optional(),
  summary: z.string().trim().max(LIMITS.summary).optional(),
  features: z
    .array(z.string().trim().min(1).max(LIMITS.featureLen))
    .max(LIMITS.featureCount, `最多 ${LIMITS.featureCount} 条特征`)
    .optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  fromPhotoUrl: z.string().optional(),
  clientId: z.string().optional(),
});

export type CreateAnimalForm = z.infer<typeof CreateAnimalFormSchema>;

export const CreateAnimalDataSchema = z.object({
  animal: AnimalSummarySchema,
  photoUrl: z.string().nullable(),
  photoId: z.string().nullable(),
});

export type CreateAnimalData = z.infer<typeof CreateAnimalDataSchema>;
