import { z } from 'zod';
import { LIMITS } from '../constants';
import { HealthLevelSchema } from '../ai/schemas';
import { AlertLevelSchema } from './alert-contract';

// 两个枚举都不在本文件定义，只做转出 —— 四个副本迟早有一个漏改：
// 健康档的唯一来源是 lib/ai/schemas.ts（AI 输出形状）；
// 预警等级的唯一来源是 lib/api/alert-contract.ts（它是规则产物，不是模型输出）。
export { HealthLevelSchema, AlertLevelSchema };

/**
 * 健康评估的前后端共用契约（唯一事实源）。
 * 表单校验、API 解析、响应类型都从这里取 —— 和 observation-contract 保持同一种写法，
 * 免得「同一件事两处不同限制」慢慢长出来。
 */

export const HealthAssessRequestSchema = z.object({
  // 缺失即为 preview 模式：照常出结论，但不写 HealthReport
  animalId: z.string().trim().min(1).optional(),
  description: z.string().trim().max(LIMITS.note, `描述最多 ${LIMITS.note} 字`).optional(),
  // 复用站内已上传的照片（走 isOwnUploadUrl 白名单），与 file 二选一
  fromPhotoUrl: z.string().trim().max(300).optional(),
  clientId: z.string().trim().max(64).optional(),
});

export type HealthAssessRequest = z.infer<typeof HealthAssessRequestSchema>;

export const SeveritySchema = z.enum(['MILD', 'MODERATE', 'SEVERE']);

export const HealthAssessDataSchema = z.object({
  /** preview 模式为 null：没写库，不参与时间线 */
  reportId: z.string().nullable(),
  persisted: z.boolean(),
  animal: z.object({ id: z.string(), code: z.string(), name: z.string() }).nullable(),
  /** AI 的判断正文。学生照着它决定要不要跑一趟，必须有 */
  assessment: z.string(),
  /** 本次评估依据的照片。纯文字的 preview 模式为 null */
  imageUrl: z.string().nullable(),
  healthStatus: HealthLevelSchema,
  severity: SeveritySchema,
  /** 个体当前档案健康档位。未变更时等于评估前的档位 */
  healthLevel: HealthLevelSchema,
  healthLevelChanged: z.boolean(),
  advice: z.array(z.string()),
  confidence: z.number(),
  /** confidence < CONFIDENCE_FLOOR，UI 必须显式呈现「不确定」 */
  uncertain: z.boolean(),
  uncertainNote: z.string().optional(),
  needsVet: z.boolean(),
  signals: z.array(z.string()),
  /** 任何 AI 健康结论都必须带，文案唯一来源是 constants.ts 的 DISCLAIMER */
  disclaimer: z.string(),
  alert: z.object({ id: z.string(), level: AlertLevelSchema, reason: z.string() }).nullable(),
  /**
   * 发生了什么降级：adviceStripped:N / visionUnavailable:AI_TIMEOUT 等，不留沉默失败。
   * `visionUnavailable:` 前缀有专门含义 —— 照片没读到，结论只依据文字（见 VISION_FALLBACK_NOTE）。
   */
  degraded: z.array(z.string()).default([]),
  timingMs: z.number(),
});

export type HealthAssessData = z.infer<typeof HealthAssessDataSchema>;
