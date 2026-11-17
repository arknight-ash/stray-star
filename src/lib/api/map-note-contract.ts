import { z } from 'zod';
import { HealthLevelSchema } from '../ai/schemas';

/**
 * 「AI 星图观测手记」的前后端共用契约（2026-10-28）。
 *
 * 这张卡的定位是**展示 AI 主动看全局**，所以契约里刻意放了三样东西，缺一不可：
 *   ① `text` —— 那句人话；
 *   ② `window` —— 这句话是基于多少数据、什么口径算出来的（不给口径，一句话就成了玄学）；
 *   ③ `source` + `degraded` —— 这句话到底是 AI 写的还是本地拼的。**不许把兜底文案伪装成 AI 结论**。
 * 生成时间也必须在，因为它是缓存的：卡片上的这句话可能算于 8 分钟前，读者有权知道。
 */

export const MapNoteFocusSchema = z.object({
  code: z.string(),
  name: z.string(),
  healthLevel: HealthLevelSchema,
});

export const MapNoteSchema = z.object({
  /** 卡片正文：一句话总览。已剥掉重复的「AI 观测：」前缀（卡片标题已经有这四个字） */
  text: z.string(),
  /** 最值得关注的那颗星；没有值得关注的对象时为 null */
  focus: MapNoteFocusSchema.nullable(),
  /** 2-4 条依据，每条只复述一个事实 */
  signals: z.array(z.string()).default([]),
  /** ai = 模型写的；fallback = 编排层用规则拼的（AI 不可用或输出不合规） */
  source: z.enum(['ai', 'fallback']),
  /** 为什么降级：ai:AI_TIMEOUT / note:unknown_code 等，不留沉默失败 */
  degraded: z.array(z.string()).default([]),
  /** 这句话的生成时刻（ISO）。缓存命中时保持不变 */
  generatedAt: z.string(),
  /** 数据口径：让读者知道这句话建立在多少条数据上 */
  window: z.object({
    label: z.string(),
    total: z.number(),
    openAlerts: z.number(),
    observations7d: z.number(),
    /** 缓存上限（分钟）。由服务端从 constants.OBSERVATORY 带下来 —— 前端不许自己写死一个"10" */
    ttlMinutes: z.number(),
  }),
  /** 数据指纹：同一份数据不会重复烧模型调用，UI 调试时也能看出是否换了输入 */
  fingerprint: z.string(),
  /** 是否命中缓存 */
  cached: z.boolean(),
});

export type MapNote = z.infer<typeof MapNoteSchema>;
export type MapNoteFocus = z.infer<typeof MapNoteFocusSchema>;
