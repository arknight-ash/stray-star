import { z } from 'zod';
import { LIMITS } from '../constants';
import { HealthLevelSchema } from '../ai/schemas';
import type { Species } from '@/types/domain';

/**
 * 预警的前后端共用契约（阶段 7）。
 *
 * `AlertLevelSchema` 的家在这里，不在 `lib/ai/schemas.ts`：
 * 预警等级是**服务端规则**的产物，不是 AI 输出（schemas.ts 只放模型要返回的形状）。
 * 唯一定义在此，`health-contract.ts` / `observation-contract.ts` 一律 re-export，
 * 谁都不许再抄一遍 z.enum（CLAUDE.md §5 的老规矩）。
 */

export const AlertLevelSchema = z.enum(['INFO', 'WARN', 'CRITICAL']);
export const AlertStatusSchema = z.enum(['OPEN', 'ACK', 'RESOLVED']);
/** 触发来源：同学上报的观察 / AI 健康初筛 */
export const AlertSourceSchema = z.enum(['OBSERVATION', 'HEALTH_REPORT']);
/** 列表筛选：ALL 是前端的「不筛」，不是库里的状态 */
export const AlertStatusFilterSchema = z.enum(['ALL', 'OPEN', 'ACK', 'RESOLVED']);

export type AlertLevel = z.infer<typeof AlertLevelSchema>;
export type AlertStatus = z.infer<typeof AlertStatusSchema>;
export type AlertSource = z.infer<typeof AlertSourceSchema>;

/** 管理端列表的一行。刻意不传整条 Alert：客户端不该拿到处置人以外的信息 */
export interface AdminAlertVM {
  id: string;
  level: AlertLevel;
  status: AlertStatus;
  reason: string;
  source: AlertSource | null;
  /**
   * 这条是不是「同学手动标记情况紧急」喊出来的（规则 R4）。
   * 管理端据此把人喊的那几条单独拎出来置顶 —— AI 初筛天天有，人喊紧急一年也没几次。
   */
  manualSevere: boolean;
  createdAt: string;
  ackAt: string | null;
  resolvedAt: string | null;
  animal: {
    id: string;
    code: string;
    name: string;
    species: Species;
    healthLevel: z.infer<typeof HealthLevelSchema>;
    /** 预警位置分布图（2026-10-26 设计稿）要用的坐标；未定位为 null */
    mapLat: number | null;
    mapLng: number | null;
  };
  /** 最后处置人。匿名 ACK 时为 null —— 界面要写「匿名同学认领」而不是留空白 */
  handledBy: { name: string | null; role: 'STUDENT' | 'ADMIN' | null } | null;
}

/** 待审核的关键报告（severity=SEVERE 或 needsVet=true 才进这个区） */
export interface AdminReportVM {
  id: string;
  animalCode: string;
  animalName: string;
  severity: 'MILD' | 'MODERATE' | 'SEVERE';
  assessment: string;
  needsVet: boolean;
  confidence: number;
  reviewedByAdmin: boolean;
  /** 阶段 9 三态：PENDING / APPROVED / REJECTED。reviewedByAdmin 是它的派生显示 */
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote: string | null;
  reviewedByName: string | null;
  createdAt: string;
}

export const AlertListDataSchema = z.object({
  items: z.array(z.custom<AdminAlertVM>()),
  counts: z.object({ OPEN: z.number(), ACK: z.number(), RESOLVED: z.number() }),
  /** 当前操作者：前端据此决定按钮禁用与提示文案，不自己猜权限 */
  actor: z.object({ kind: z.enum(['anonymous', 'student', 'admin']), role: z.enum(['STUDENT', 'ADMIN']).nullable() }),
  reports: z.array(z.custom<AdminReportVM>()),
});

export type AlertListData = z.infer<typeof AlertListDataSchema>;

/** PATCH /api/admin/alerts/:id */
export const AlertActionSchema = z.object({
  action: z.enum(['ACK', 'RESOLVED']),
  /** 处置备注。管理员写下的理由要能被人复核，所以留 200 字而不是一句话 */
  note: z.string().trim().max(LIMITS.note, `备注最多 ${LIMITS.note} 字`).optional(),
  clientId: z.string().trim().max(64).optional(),
});

/**
 * PATCH /api/admin/reports/:id（阶段 9：通过 / 驳回 / 修改 三动作）。
 * - 驳回必须带 note（驳回不留理由等于没驳，zod 层 superRefine 拦）。
 * - 修改（edits）只许随 APPROVED 提交，改动会过 reconcile 规则再落库。
 */
export const ReportEditsSchema = z.object({
  // 与 AI 契约（schemas.ts 的 HealthAssessmentSchema）同界：管理员改写不许超出 AI 的表达空间
  assessment: z.string().trim().min(4).max(500).optional(),
  severity: z.enum(['MILD', 'MODERATE', 'SEVERE']).optional(),
  advice: z.array(z.string().trim().min(2).max(120)).max(6).optional(),
  healthStatus: z.enum(['GREEN', 'YELLOW', 'RED']).optional(),
});

export const ReportReviewSchema = z
  .object({
    verdict: z.enum(['APPROVED', 'REJECTED']),
    edits: ReportEditsSchema.optional(),
    note: z.string().trim().max(LIMITS.note, `备注最多 ${LIMITS.note} 字`).optional(),
    clientId: z.string().trim().max(64).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.verdict === 'REJECTED' && !v.note) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: '驳回必须填写理由' });
    }
  });

export type ReportReviewInput = z.infer<typeof ReportReviewSchema>;

export const AlertActionDataSchema = z.object({
  alert: z.custom<AdminAlertVM>(),
  /** 权限裁决结果原样回传：被拒时前端直接显示 reason，不自己改写措辞 */
  decision: z.object({ allowed: z.boolean(), reason: z.string() }),
});

export const ReportReviewDataSchema = z.object({
  report: z.object({
    id: z.string(),
    reviewStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
    reviewedByAdmin: z.boolean(),
    reviewNote: z.string().nullable(),
    reviewedByName: z.string().nullable(),
  }),
  /** 修改了哪些字段、改成了什么 —— 前端据此提示「已按你的修改更新」 */
  diff: z.record(z.string(), z.unknown()),
  decision: z.object({ allowed: z.boolean(), reason: z.string() }),
});
