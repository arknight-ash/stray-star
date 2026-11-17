import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { writeAudit, AUDIT_ACTIONS } from '../db/audit';
import { canDelete, canEditAnimal, canReviewAnimal, type Actor } from '../permissions';
import { actorDbId } from '../auth/actor';
import { log } from '../logger';

/**
 * 管理端档案业务：
 *  - 删除「已经找不到的小动物」的档案（canDelete：2026-10-27 起只放行管理员）；
 *  - 为暂无位置的档案补充经纬度（canEditAnimal：匿名拒绝，待审核档案学生不可改）；
 *  - 审核同学提交的新增动物申请（canReviewAnimal：通过 = 转正式档案，驳回 = 连同档案删除）。
 * 与 lib/admin/alerts.ts 同一规矩：路由只做解析/限流，裁决与落库在这里。
 */

export type AdminOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; code: 'NOT_FOUND' | 'FORBIDDEN'; message: string };

/** 审核结论：通过 = 转正式档案；驳回 = 认定这条申请不成立，档案与照片一并清掉 */
export type ReviewDecision = 'approve' | 'reject';

/**
 * 审核同学提交的新增动物申请（2026-10-27）。
 *
 * 为什么「通过」不是简单地把开关拨成 false 就完事：待审核档案的照片同样带着
 * pendingReview，只转档案不转照片，识别库仍会把它们当「不稳定依据」而排除，
 * 于是同学拍的那张照片永远不会参与识别 —— 审核通过必须连照片一起升格。
 *
 * 驳回走删除：申请不成立意味着这只动物不该出现在图鉴里，
 * 留一条 pendingReview 的僵尸档案只会让它一直挂在列表里等人来第二次处理。
 */
export async function reviewAnimal(
  code: string,
  decision: ReviewDecision,
  actor: Actor,
  note?: string,
): Promise<AdminOutcome<{ code: string; name: string; decision: ReviewDecision }>> {
  const animal = await prisma.animal.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      name: true,
      pendingReview: true,
      _count: { select: { photos: true } },
    },
  });
  if (!animal) return { ok: false, code: 'NOT_FOUND', message: '没有找到这条申请' };

  const verdict = canReviewAnimal(actor);
  if (!verdict.allowed) return { ok: false, code: 'FORBIDDEN', message: verdict.reason };

  if (decision === 'approve') {
    await prisma.$transaction([
      prisma.animal.update({ where: { id: animal.id }, data: { pendingReview: false } }),
      prisma.animalPhoto.updateMany({
        where: { animalId: animal.id },
        data: { pendingReview: false },
      }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.animalPhoto.deleteMany({ where: { animalId: animal.id } }),
      prisma.animal.delete({ where: { id: animal.id } }),
    ]);
  }

  await writeAudit({
    actorId: actorDbId(actor),
    action: AUDIT_ACTIONS.ANIMAL_REVIEW,
    targetType: 'Animal',
    targetId: animal.id,
    payload: {
      code: animal.code,
      name: animal.name,
      decision,
      note: note?.trim() ? note.trim() : null,
      photos: animal._count.photos,
      by: actor.kind,
    } satisfies Prisma.InputJsonValue,
  });
  log.info('animal_reviewed', { code: animal.code, decision, by: actor.kind });

  return { ok: true, data: { code: animal.code, name: animal.name, decision } };
}

/** 删除档案。观察/预警随外键 Cascade 一并清掉，照片按 SetNull 摘钩 —— 审计里留下记录。 */
export async function deleteAnimal(
  code: string,
  actor: Actor,
): Promise<AdminOutcome<{ code: string; name: string }>> {
  const animal = await prisma.animal.findUnique({
    where: { code },
    select: { id: true, code: true, name: true },
  });
  if (!animal) return { ok: false, code: 'NOT_FOUND', message: '没有找到这只动物' };

  const verdict = canDelete(actor);
  if (!verdict.allowed) return { ok: false, code: 'FORBIDDEN', message: verdict.reason };

  await prisma.animal.delete({ where: { id: animal.id } });

  await writeAudit({
    actorId: actorDbId(actor),
    action: AUDIT_ACTIONS.ANIMAL_DELETE,
    targetType: 'Animal',
    targetId: animal.id,
    payload: {
      code: animal.code,
      name: animal.name,
      by: actor.kind,
    } satisfies Prisma.InputJsonValue,
  });
  log.info('animal_deleted', { code: animal.code, by: actor.kind });

  return { ok: true, data: { code: animal.code, name: animal.name } };
}

/** 补充/更正档案位置。坐标合法性（范围 + 校园围栏）由调用方（路由层）先行校验。 */
export async function setAnimalLocation(
  code: string,
  lat: number,
  lng: number,
  actor: Actor,
): Promise<AdminOutcome<{ code: string; lat: number; lng: number }>> {
  const animal = await prisma.animal.findUnique({
    where: { code },
    select: { id: true, code: true, name: true, pendingReview: true },
  });
  if (!animal) return { ok: false, code: 'NOT_FOUND', message: '没有找到这只动物' };

  const verdict = canEditAnimal(actor, { pendingReview: animal.pendingReview });
  if (!verdict.allowed) return { ok: false, code: 'FORBIDDEN', message: verdict.reason };

  await prisma.animal.update({
    where: { id: animal.id },
    data: { mapLat: lat, mapLng: lng },
  });

  await writeAudit({
    actorId: actorDbId(actor),
    action: AUDIT_ACTIONS.ANIMAL_LOCATION,
    targetType: 'Animal',
    targetId: animal.id,
    payload: { code: animal.code, lat, lng } satisfies Prisma.InputJsonValue,
  });

  return { ok: true, data: { code: animal.code, lat, lng } };
}
