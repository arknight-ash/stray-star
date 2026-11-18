import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { writeAudit } from '../db/audit';
import { actorDbId } from '../auth/actor';
import { canAckAlert, canResolveAlert, canReviewReport, type Actor } from '../permissions';
import { isManualSevereAlert } from '../alerts/rules';
import { log } from '../logger';
import type {
  AdminAlertVM,
  AdminReportVM,
  AlertLevel,
  AlertSource,
  AlertStatus,
} from '../api/alert-contract';

/**
 * 管理端的业务层（阶段 7）。
 *
 * 与所有 lib 层一样：路由只做解析、限流与信封，裁决与落库在这里。
 * 权限一律问 `lib/permissions.ts`，本文件不自己写 if (role === ...)。
 */

export type AdminOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; code: 'NOT_FOUND' | 'FORBIDDEN'; message: string };

const ALERT_SELECT = {
  id: true,
  level: true,
  status: true,
  reason: true,
  source: true,
  dedupeKey: true,
  createdAt: true,
  ackAt: true,
  resolvedAt: true,
  animal: {
    select: {
      id: true,
      code: true,
      name: true,
      species: true,
      healthLevel: true,
      mapLat: true,
      mapLng: true,
    },
  },
  ackedBy: { select: { name: true, role: true } },
} satisfies Prisma.AlertSelect;

type AlertRow = Prisma.AlertGetPayload<{ select: typeof ALERT_SELECT }>;

function toVM(row: AlertRow): AdminAlertVM {
  return {
    id: row.id,
    level: row.level,
    status: row.status,
    reason: row.reason,
    source: (row.source as AlertSource | null) ?? null,
    manualSevere: isManualSevereAlert(row),
    createdAt: row.createdAt.toISOString(),
    ackAt: row.ackAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    animal: {
      id: row.animal.id,
      code: row.animal.code,
      name: row.animal.name,
      species: row.animal.species,
      healthLevel: row.animal.healthLevel,
      mapLat: row.animal.mapLat,
      mapLng: row.animal.mapLng,
    },
    handledBy: row.ackedBy ? { name: row.ackedBy.name, role: row.ackedBy.role } : null,
  };
}

export interface AlertBoard {
  items: AdminAlertVM[];
  counts: { OPEN: number; ACK: number; RESOLVED: number };
  reports: AdminReportVM[];
}

/**
 * 待办列表。排序：未处理在前、同级按等级（CRITICAL 先）再按时间 ——
 * 管理员打开页面第一眼必须是"最急的那条"，不是"最近生成的一条"。
 */
export async function loadAlertBoard(filter: {
  status: 'ALL' | AlertStatus;
  level?: AlertLevel;
}): Promise<AlertBoard> {
  const where: Prisma.AlertWhereInput = {
    ...(filter.status === 'ALL' ? {} : { status: filter.status }),
    ...(filter.level ? { level: filter.level } : {}),
  };

  const [rows, grouped, reports] = await Promise.all([
    prisma.alert.findMany({ where, select: ALERT_SELECT, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.alert.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.healthReport.findMany({
      // 关键报告 = 重度异常或建议就医。其余的 MILD 报告不占管理员的注意力。
      where: { OR: [{ severity: 'SEVERE' }, { needsVet: true }] },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        severity: true,
        assessment: true,
        needsVet: true,
        confidence: true,
        reviewedByAdmin: true,
        reviewStatus: true,
        reviewNote: true,
        createdAt: true,
        animal: { select: { code: true, name: true } },
        reviewedBy: { select: { name: true } },
      },
    }),
  ]);

  const counts = { OPEN: 0, ACK: 0, RESOLVED: 0 };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
  }

  const rank: Record<AlertStatus, number> = { OPEN: 0, ACK: 1, RESOLVED: 2 };
  const items = rows
    .map(toVM)
    .sort((a, b) => rank[a.status] - rank[b.status] || levelRank(b.level) - levelRank(a.level));

  return {
    items,
    counts,
    reports: reports.map<AdminReportVM>((r) => ({
      id: r.id,
      animalCode: r.animal.code,
      animalName: r.animal.name,
      severity: r.severity,
      assessment: r.assessment,
      needsVet: r.needsVet,
      confidence: r.confidence,
      reviewedByAdmin: r.reviewedByAdmin,
      reviewStatus: r.reviewStatus as AdminReportVM['reviewStatus'],
      reviewNote: r.reviewNote,
      reviewedByName: r.reviewedBy?.name ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

function levelRank(level: AlertLevel): number {
  return level === 'CRITICAL' ? 2 : level === 'WARN' ? 1 : 0;
}

/** 确认（ACK = 我已知悉）。匿名也可以 —— 学生看到受伤动物时先认领跟进 */
export async function ackAlert(
  id: string,
  actor: Actor,
  note?: string,
): Promise<AdminOutcome<{ alert: AdminAlertVM; decision: { allowed: boolean; reason: string } }>> {
  const current = await prisma.alert.findUnique({ where: { id }, select: { id: true, level: true } });
  if (!current) return { ok: false, code: 'NOT_FOUND', message: '这条预警不存在或已被合并' };

  const decision = canAckAlert(actor, current.level);
  if (!decision.allowed) return { ok: false, code: 'FORBIDDEN', message: decision.reason };

  const row = await prisma.alert.update({
    where: { id },
    data: {
      status: 'ACK',
      ackAt: new Date(),
      ackedById: actorDbId(actor),
      ackedByRole: actor.kind === 'anonymous' ? null : actor.role,
    },
    select: ALERT_SELECT,
  });

  await writeAudit({
    actorId: actorDbId(actor),
    action: 'ALERT_ACK',
    targetType: 'Alert',
    targetId: id,
    payload: { level: row.level, note: note ?? null, anonymous: actor.kind === 'anonymous' },
  });

  return { ok: true, data: { alert: toVM(row), decision } };
}

/** 解决（RESOLVED = 这件事结了）。CRITICAL 只给管理员（R8） */
export async function resolveAlert(
  id: string,
  actor: Actor,
  note?: string,
): Promise<AdminOutcome<{ alert: AdminAlertVM; decision: { allowed: boolean; reason: string } }>> {
  const current = await prisma.alert.findUnique({ where: { id }, select: { id: true, level: true } });
  if (!current) return { ok: false, code: 'NOT_FOUND', message: '这条预警不存在或已被合并' };

  const decision = canResolveAlert(actor, current.level);
  if (!decision.allowed) return { ok: false, code: 'FORBIDDEN', message: decision.reason };

  const now = new Date();
  const row = await prisma.alert.update({
    where: { id },
    data: {
      status: 'RESOLVED',
      // ACK 时间只在第一次处置时写：从 OPEN 直接关掉不该留下"从未认领"的空白
      ackAt: now,
      resolvedAt: now,
      ackedById: actorDbId(actor),
      ackedByRole: actor.kind === 'anonymous' ? null : actor.role,
    },
    select: ALERT_SELECT,
  });

  await writeAudit({
    actorId: actorDbId(actor),
    action: 'ALERT_RESOLVE',
    targetType: 'Alert',
    targetId: id,
    payload: { level: row.level, note: note ?? null },
  });

  return { ok: true, data: { alert: toVM(row), decision } };
}

// 阶段 9：报告审核的三动作（通过/驳回/修改）搬到 lib/admin/reports.ts 的 reviewReport，
// 这里不再保留 boolean 开关。审核相关改动请去那边，权限裁决仍走 permissions.ts。

// ---------- 预警处置台改版（2026-10-27，设计稿二轮） ----------

export interface AlertTrendDay {
  /** MM-DD */
  label: string;
  date: string;
  /** 当天新增的预警数 */
  total: number;
  /** 当天被解决的预警数（按 resolvedAt 归日） */
  resolved: number;
}

export interface AlertPhotoCard {
  id: string;
  reason: string;
  status: AlertStatus;
  level: AlertLevel;
  createdAt: string;
  animalName: string;
  animalCode: string;
  /** 动物的第一张照片；没照片就 null，前端画首字母占位 */
  photo: string | null;
}

export interface AlertsPageData {
  items: AdminAlertVM[];
  counts: { OPEN: number; ACK: number; RESOLVED: number };
  reports: AdminReportVM[];
  trend: AlertTrendDay[];
  photoCards: AlertPhotoCard[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 预警处置台整页数据（2026-10-27 改版）。
 *
 * 在 loadAlertBoard 之上补两块设计稿要的内容：
 *  - 近 7 天趋势（新增/已解决两条线）：归桶在 JS 做，理由同 overview.ts；
 *  - 预警照片墙（最近 8 条 + 动物第一张照片），给「这条预警是谁」一个脸。
 */
export async function loadAlertsPage(): Promise<AlertsPageData> {
  const board = await loadAlertBoard({ status: 'ALL' });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const since = new Date(today.getTime() - 6 * DAY_MS);

  const [trendRows, photoRows] = await Promise.all([
    prisma.alert.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, resolvedAt: true },
    }),
    prisma.alert.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        reason: true,
        status: true,
        level: true,
        createdAt: true,
        animal: {
          select: {
            code: true,
            name: true,
            avatarUrl: true,
            photos: { orderBy: { createdAt: 'asc' as const }, take: 1, select: { url: true } },
          },
        },
      },
    }),
  ]);

  const dayKey = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const totalMap = new Map<string, number>();
  const resolvedMap = new Map<string, number>();
  for (const r of trendRows) {
    const k = dayKey(r.createdAt);
    totalMap.set(k, (totalMap.get(k) ?? 0) + 1);
    if (r.resolvedAt) {
      const rk = dayKey(r.resolvedAt);
      resolvedMap.set(rk, (resolvedMap.get(rk) ?? 0) + 1);
    }
  }
  const trend: AlertTrendDay[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getTime() - (6 - i) * DAY_MS);
    const k = dayKey(d);
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      label: `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      date: k,
      total: totalMap.get(k) ?? 0,
      resolved: resolvedMap.get(k) ?? 0,
    };
  });

  const photoCards: AlertPhotoCard[] = photoRows.map((r) => ({
    id: r.id,
    reason: r.reason,
    status: r.status,
    level: r.level,
    createdAt: r.createdAt.toISOString(),
    animalName: r.animal.name,
    animalCode: r.animal.code,
    // 优先动物档案头像（种子/上传都往这里写真实照片），再回落到第一张归档照片。
    // 2026-11-18 修：此前只读 AnimalPhoto.url，而种子把占位 SVG 写进了那一列，
    // 整面「预警照片」墙因此全是灰底占位图 —— 真照片其实一直在 avatarUrl 里。
    photo: r.animal.avatarUrl ?? r.animal.photos[0]?.url ?? null,
  }));

  return { items: board.items, counts: board.counts, reports: board.reports, trend, photoCards };
}
