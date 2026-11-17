import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { writeAudit, AUDIT_ACTIONS } from '../db/audit';
import { canDeleteObservation, type Actor } from '../permissions';
import { actorDbId } from '../auth/actor';
import { log } from '../logger';

/**
 * 管理端记录业务（2026-10-27）：删除一条观察记录。
 *
 * 与 lib/admin/animals.ts 同一规矩：路由只做解析/限流，裁决与落库在这里。
 *
 * 删的是「一条记录」而不是「一只动物」，但代价同样不可逆 —— 记录可能带着唯一的
 * 现场照片，也是健康档派生与预警规则的证据来源。所以删除前把原文与作者抄进审计：
 * 事后能查到"谁删了谁写的什么"，而不是只剩一条没有内容的编号。
 */
export type AdminOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; code: 'NOT_FOUND' | 'FORBIDDEN'; message: string };

export async function deleteObservation(
  id: string,
  actor: Actor,
): Promise<AdminOutcome<{ id: string }>> {
  const row = await prisma.observation.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      content: true,
      authorName: true,
      manualSevere: true,
      pendingReview: true,
      createdAt: true,
      animal: { select: { id: true, code: true, name: true } },
    },
  });
  if (!row) return { ok: false, code: 'NOT_FOUND', message: '没有找到这条记录' };

  const verdict = canDeleteObservation(actor);
  if (!verdict.allowed) return { ok: false, code: 'FORBIDDEN', message: verdict.reason };

  // HealthReport 通过 observationId 关联，外键是 SetNull：报告留着，钩摘掉。
  // 反过来若因为报告存在就拒绝删除，管理员就拿不掉一条明确写错的上报。
  await prisma.observation.delete({ where: { id: row.id } });

  await writeAudit({
    actorId: actorDbId(actor),
    action: AUDIT_ACTIONS.OBSERVATION_DELETE,
    targetType: 'Observation',
    targetId: row.id,
    payload: {
      animalId: row.animal.id,
      animalCode: row.animal.code,
      animalName: row.animal.name,
      type: row.type,
      content: row.content,
      authorName: row.authorName,
      manualSevere: row.manualSevere,
      pendingReview: row.pendingReview,
      createdAt: row.createdAt.toISOString(),
      by: actor.kind,
    } satisfies Prisma.InputJsonValue,
  });
  log.info('observation_deleted', { id: row.id, animalCode: row.animal.code, by: actor.kind });

  return { ok: true, data: { id: row.id } };
}
