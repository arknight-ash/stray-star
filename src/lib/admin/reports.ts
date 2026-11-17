import { prisma } from '../db';
import { writeAudit } from '../db/audit';
import { actorDbId } from '../auth/actor';
import { canReviewReport, type Actor } from '../permissions';
import { log } from '../logger';
import { reconcileHealth } from '../health/reconcile';
import type { Prisma } from '@prisma/client';
import type { ReportReviewInput } from '../api/alert-contract';
import type { AdminOutcome } from './alerts';

/**
 * HealthReport 审核业务层（阶段 9）：通过 / 驳回 / 修改 三动作。
 *
 * 拍板结论（docs/stage-9-wrapup.md §1）：
 * - 修改**直接编辑原字段**，不搞批注叠加 —— 数据保持单份事实源；
 * - 修改后过 `reconcileHealth`：SEVERE 强制 needsVet、severity 与 healthStatus 打架取严重侧；
 * - 驳回必须带 note（zod 已拦），报告保留并打「已驳回」徽标，不参与默认统计视图；
 * - diff 原样写进 AuditLog —— 审核动作必须能事后回答"谁把 SEVERE 改成了 MILD"。
 */

/** ReconciledHealth 的输入形状是 HealthAssessment 的超集，这里只需要四个字段 */
interface EditableFields {
  assessment: string;
  severity: 'MILD' | 'MODERATE' | 'SEVERE';
  advice: string[];
  healthStatus: 'GREEN' | 'YELLOW' | 'RED';
  needsVet: boolean;
}

export async function reviewReport(
  id: string,
  input: ReportReviewInput,
  actor: Actor,
): Promise<
  AdminOutcome<{
    report: {
      id: string;
      reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
      reviewedByAdmin: boolean;
      reviewNote: string | null;
      reviewedByName: string | null;
    };
    diff: Record<string, unknown>;
    decision: { allowed: boolean; reason: string };
  }>
> {
  const decision = canReviewReport(actor);
  if (!decision.allowed) return { ok: false, code: 'FORBIDDEN', message: decision.reason };

  const report = await prisma.healthReport.findUnique({
    where: { id },
    select: {
      id: true,
      assessment: true,
      severity: true,
      advice: true,
      healthStatus: true,
      needsVet: true,
      confidence: true,
      reviewStatus: true,
      reviewedBy: { select: { name: true } },
    },
  });
  if (!report) return { ok: false, code: 'NOT_FOUND', message: '这份报告不存在' };

  /* ── 构造 diff：edits 只在 APPROVED 时提交（契约层不再拦，这里兜底） ── */
  const diff: Record<string, unknown> = {};
  let data: Record<string, unknown>;

  if (input.verdict === 'APPROVED') {
    const merged: EditableFields = {
      assessment: input.edits?.assessment ?? report.assessment,
      severity: input.edits?.severity ?? (report.severity as EditableFields['severity']),
      advice: input.edits?.advice ?? report.advice,
      healthStatus: input.edits?.healthStatus ?? (report.healthStatus as EditableFields['healthStatus']),
      needsVet: report.needsVet,
    };

    // 修改后重新过一致性校正：安全下限（SEVERE ⇒ needsVet）由规则把着，管理员也不例外。
    // confidence/signals 不在管理员可编辑范围内，原值带入只为满足 reconcile 的入参形状。
    const corrected = reconcileHealth({ ...merged, confidence: report.confidence, signals: [] });
    if (corrected.adjusted) {
      diff['reconcile'] = corrected.adjustReason;
    }

    data = {
      reviewStatus: 'APPROVED',
      reviewedByAdmin: true,
      reviewNote: input.note ?? null,
      reviewedById: actorDbId(actor),
      assessment: corrected.assessment,
      severity: corrected.severity,
      advice: corrected.advice,
      healthStatus: corrected.healthStatus,
      needsVet: corrected.needsVet,
    };

    for (const key of ['assessment', 'severity', 'advice', 'healthStatus', 'needsVet'] as const) {
      if (JSON.stringify(corrected[key]) !== JSON.stringify(report[key])) {
        diff[key] = { from: report[key], to: corrected[key] };
      }
    }
  } else {
    data = {
      reviewStatus: 'REJECTED',
      reviewedByAdmin: false,
      reviewNote: input.note ?? null,
      reviewedById: actorDbId(actor),
    };
  }

  const row = await prisma.healthReport.update({
    where: { id },
    data,
    select: {
      id: true,
      reviewStatus: true,
      reviewedByAdmin: true,
      reviewNote: true,
      reviewedBy: { select: { name: true } },
    },
  });

  await writeAudit({
    actorId: actorDbId(actor),
    action: 'REPORT_REVIEW',
    targetType: 'HealthReport',
    targetId: id,
    payload: { verdict: input.verdict, diff: diff as Prisma.InputJsonValue, note: input.note ?? null },
  });

  log.info('admin.report_review', {
    reportId: id,
    verdict: input.verdict,
    edited: Object.keys(diff).length > 0,
    actor: actor.kind,
  });

  return {
    ok: true,
    data: {
      report: {
        id: row.id,
        reviewStatus: row.reviewStatus as 'PENDING' | 'APPROVED' | 'REJECTED',
        reviewedByAdmin: row.reviewedByAdmin,
        reviewNote: row.reviewNote,
        reviewedByName: row.reviewedBy?.name ?? null,
      },
      diff,
      decision,
    },
  };
}
