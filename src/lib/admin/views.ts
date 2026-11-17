import { prisma } from '../db';
import { nearestSpot } from '../map-config';
import type {
  AlertLevel,
  AlertStatus,
  HealthLevel,
  ObservationType,
  Severity,
  Species,
} from '@/types/domain';

/**
 * 管理端「动物管理 / 记录管理 / 数据统计」三个内页的数据装载（2026-10-27）。
 *
 * 没有放进 animals.ts / alerts.ts：那两个文件是**业务动作**（删除、定位、处置），
 * 这里只是给内页拼视图 —— 动作和视图分开，改版时不会误碰权限裁决。
 */

// ---------- 动物管理 ----------

export interface AdminAnimalFull {
  id: string;
  code: string;
  name: string;
  species: Species;
  healthLevel: HealthLevel;
  healthManual: boolean;
  avatarUrl: string | null;
  pendingReview: boolean;
  summary: string | null;
  features: string[];
  spotName: string | null;
  mapLat: number | null;
  mapLng: number | null;
  photoCount: number;
  observationCount: number;
  openAlerts: number;
  createdAt: string;
  /** 卡片网格用第一张，档案面板的照片页签用前 4 张 */
  photos: Array<{ id: string; url: string; createdAt: string }>;
  reports: Array<{
    id: string;
    assessment: string;
    severity: Severity;
    healthStatus: HealthLevel;
    needsVet: boolean;
    confidence: number;
    reviewStatus: string;
    createdAt: string;
  }>;
  observations: Array<{
    id: string;
    type: ObservationType;
    content: string;
    createdAt: string;
    pendingReview: boolean;
    authorLabel: string;
    spotName: string | null;
  }>;
}

/**
 * 动物管理页整页数据：网格卡片与右侧档案面板共用一份。
 *
 * 站内动物是个位数到几十只的量级，一次带全（含最近 3 条报告/观察）比
 * 「点一下查一次」的选中态交互轻得多，也让搜索/筛选纯粹在客户端跑。
 */
export async function loadAnimalsPage(): Promise<AdminAnimalFull[]> {
  const [rows, openAlerts] = await Promise.all([
    prisma.animal.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        species: true,
        healthLevel: true,
        healthManual: true,
        avatarUrl: true,
        pendingReview: true,
        summary: true,
        features: true,
        mapLat: true,
        mapLng: true,
        createdAt: true,
        photos: {
          orderBy: { createdAt: 'asc' },
          take: 4,
          select: { id: true, url: true, createdAt: true },
        },
        healthReports: {
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: {
            id: true,
            assessment: true,
            severity: true,
            healthStatus: true,
            needsVet: true,
            confidence: true,
            reviewStatus: true,
            createdAt: true,
          },
        },
        observations: {
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: {
            id: true,
            type: true,
            content: true,
            createdAt: true,
            pendingReview: true,
            authorName: true,
            user: { select: { name: true } },
            mapLat: true,
            mapLng: true,
          },
        },
        _count: { select: { photos: true, observations: true } },
      },
    }),
    prisma.alert.groupBy({
      by: ['animalId'],
      where: { status: { not: 'RESOLVED' } },
      _count: { _all: true },
    }),
  ]);
  const openMap = new Map(openAlerts.map((g) => [g.animalId, g._count._all]));

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    species: r.species,
    healthLevel: r.healthLevel,
    healthManual: r.healthManual,
    avatarUrl: r.avatarUrl,
    pendingReview: r.pendingReview,
    summary: r.summary,
    features: r.features,
    spotName: nearestSpot(r.mapLat, r.mapLng)?.name ?? null,
    mapLat: r.mapLat,
    mapLng: r.mapLng,
    photoCount: r._count.photos,
    observationCount: r._count.observations,
    openAlerts: openMap.get(r.id) ?? 0,
    createdAt: r.createdAt.toISOString(),
    photos: r.photos.map((p) => ({ id: p.id, url: p.url, createdAt: p.createdAt.toISOString() })),
    reports: r.healthReports.map((rep) => ({
      id: rep.id,
      assessment: rep.assessment,
      severity: rep.severity,
      healthStatus: rep.healthStatus,
      needsVet: rep.needsVet,
      confidence: rep.confidence,
      reviewStatus: rep.reviewStatus,
      createdAt: rep.createdAt.toISOString(),
    })),
    observations: r.observations.map((o) => ({
      id: o.id,
      type: o.type,
      content: o.content,
      createdAt: o.createdAt.toISOString(),
      pendingReview: o.pendingReview,
      authorLabel: o.user?.name ?? o.authorName ?? '匿名同学',
      spotName: nearestSpot(o.mapLat, o.mapLng)?.name ?? null,
    })),
  }));
}

export interface AnimalApplication {
  id: string;
  code: string;
  name: string;
  species: Species;
  avatarUrl: string | null;
  summary: string | null;
  features: string[];
  spotName: string | null;
  mapLat: number | null;
  mapLng: number | null;
  photoCount: number;
  createdAt: string;
  photos: Array<{ id: string; url: string }>;
  /** 谁提交的：匿名建档时为「匿名同学」，登录建档时取真实姓名 */
  submitter: string;
}

/**
 * 待审核的「新增动物申请」。
 *
 * 与 loadAnimalsPage 分开的原因：申请的语义不是"档案"，而是"一条待办的提交" ——
 * 管理员要在这一屏里看清是谁、什么时候、拍到了什么，然后按下通过或驳回。
 * 提交人从审计里取（ANIMAL_CREATE 那一条的 actorId），而不是给 Animal 加一列：
 * 建档入口只有一个（客户端拍摄识别），审计里已经记了，再加一列就要两处维护。
 */
export async function loadAnimalApplications(): Promise<AnimalApplication[]> {
  const rows = await prisma.animal.findMany({
    where: { pendingReview: true },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      code: true,
      name: true,
      species: true,
      avatarUrl: true,
      summary: true,
      features: true,
      mapLat: true,
      mapLng: true,
      createdAt: true,
      photos: { orderBy: { createdAt: 'asc' }, take: 4, select: { id: true, url: true } },
      _count: { select: { photos: true } },
    },
  });
  if (rows.length === 0) return [];

  const audits = await prisma.auditLog.findMany({
    where: { action: 'ANIMAL_CREATE', targetId: { in: rows.map((r) => r.id) } },
    orderBy: { createdAt: 'desc' },
    select: { targetId: true, actorId: true, actor: { select: { name: true } } },
  });
  const submitterById = new Map<string, string>();
  for (const a of audits) {
    if (!a.targetId || submitterById.has(a.targetId)) continue;
    submitterById.set(a.targetId, a.actor?.name ?? (a.actorId ? '已登录同学' : '匿名同学'));
  }

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    species: r.species,
    avatarUrl: r.avatarUrl,
    summary: r.summary,
    features: r.features,
    spotName: nearestSpot(r.mapLat, r.mapLng)?.name ?? null,
    mapLat: r.mapLat,
    mapLng: r.mapLng,
    photoCount: r._count.photos,
    createdAt: r.createdAt.toISOString(),
    photos: r.photos,
    submitter: submitterById.get(r.id) ?? '匿名同学',
  }));
}

export interface AnimalDetailData {
  id: string;
 code: string;
  name: string;
  species: Species;
  healthLevel: HealthLevel;
  healthManual: boolean;
  avatarUrl: string | null;
  pendingReview: boolean;
  summary: string | null;
  features: string[];
  spotName: string | null;
  mapLat: number | null;
  mapLng: number | null;
  createdAt: string;
  updatedAt: string;
  /** 名下观察总数。删除弹窗要如实报「会连坐删掉多少条」，不能用 take:15 的长度 */
  observationCount: number;
  photos: Array<{ id: string; url: string; createdAt: string; pendingReview: boolean }>;
  reports: Array<{
    id: string;
    assessment: string;
    severity: Severity;
    healthStatus: HealthLevel;
    needsVet: boolean;
    confidence: number;
    reviewStatus: string;
    createdAt: string;
  }>;
  observations: Array<{
    id: string;
    type: ObservationType;
    content: string;
    createdAt: string;
    pendingReview: boolean;
    authorLabel: string;
    spotName: string | null;
  }>;
  alerts: Array<{
    id: string;
    level: AlertLevel;
    status: AlertStatus;
    reason: string;
    createdAt: string;
  }>;
}

/** 档案详情（/admin/animals/[code]）。查不到返回 null，页面给 404。 */
export async function loadAnimalDetail(code: string): Promise<AnimalDetailData | null> {
  const r = await prisma.animal.findUnique({
    where: { code },
    include: {
      photos: { orderBy: { createdAt: 'asc' }, select: { id: true, url: true, createdAt: true, pendingReview: true } },
      healthReports: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          assessment: true,
          severity: true,
          healthStatus: true,
          needsVet: true,
          confidence: true,
          reviewStatus: true,
          createdAt: true,
        },
      },
      observations: {
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: {
          id: true,
          type: true,
          content: true,
          createdAt: true,
          pendingReview: true,
          authorName: true,
          user: { select: { name: true } },
          mapLat: true,
          mapLng: true,
        },
      },
      alerts: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, level: true, status: true, reason: true, createdAt: true },
      },
      _count: { select: { observations: true } },
    },
  });
  if (!r) return null;

  return {
    id: r.id,
    code: r.code,
    name: r.name,
    species: r.species,
    healthLevel: r.healthLevel,
    healthManual: r.healthManual,
    avatarUrl: r.avatarUrl,
    pendingReview: r.pendingReview,
    summary: r.summary,
    features: r.features,
    spotName: nearestSpot(r.mapLat, r.mapLng)?.name ?? null,
    mapLat: r.mapLat,
    mapLng: r.mapLng,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    observationCount: r._count.observations,
    photos: r.photos.map((p) => ({
      id: p.id,
      url: p.url,
      createdAt: p.createdAt.toISOString(),
      pendingReview: p.pendingReview,
    })),
    reports: r.healthReports.map((rep) => ({
      id: rep.id,
      assessment: rep.assessment,
      severity: rep.severity,
      healthStatus: rep.healthStatus,
      needsVet: rep.needsVet,
      confidence: rep.confidence,
      reviewStatus: rep.reviewStatus,
      createdAt: rep.createdAt.toISOString(),
    })),
    observations: r.observations.map((o) => ({
      id: o.id,
      type: o.type,
      content: o.content,
      createdAt: o.createdAt.toISOString(),
      pendingReview: o.pendingReview,
      authorLabel: o.user?.name ?? o.authorName ?? '匿名同学',
      spotName: nearestSpot(o.mapLat, o.mapLng)?.name ?? null,
    })),
    alerts: r.alerts.map((a) => ({
      id: a.id,
      level: a.level,
      status: a.status,
      reason: a.reason,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

// ---------- 记录管理 ----------

export interface AdminRecordRow {
  id: string;
  type: ObservationType;
  content: string;
  createdAt: string;
  pendingReview: boolean;
  manualSevere: boolean;
  authorLabel: string;
  animalName: string;
  animalCode: string;
  animalAvatar: string | null;
  spotName: string | null;
}

export async function loadRecordRows(): Promise<AdminRecordRow[]> {
  const rows = await prisma.observation.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      type: true,
      content: true,
      createdAt: true,
      pendingReview: true,
      manualSevere: true,
      authorName: true,
      user: { select: { name: true } },
      mapLat: true,
      mapLng: true,
      animal: { select: { name: true, code: true, avatarUrl: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
    pendingReview: r.pendingReview,
    manualSevere: r.manualSevere,
    authorLabel: r.user?.name ?? r.authorName ?? '匿名同学',
    animalName: r.animal.name,
    animalCode: r.animal.code,
    animalAvatar: r.animal.avatarUrl,
    spotName: nearestSpot(r.mapLat, r.mapLng)?.name ?? null,
  }));
}

// ---------- 数据统计 ----------

export interface SpeciesSlice {
  key: Species;
  label: string;
  count: number;
  pct: number;
}

export interface SpotSlice {
  key: string;
  label: string;
  count: number;
  pct: number;
}

export interface StatsPoint {
  label: string;
  date: string;
  observations: number;
  alerts: number;
}

export interface StatsData {
  kpi: {
    animals: number;
    records30d: number;
    healthRate: number;
    alertsTotal: number;
  };
  species: SpeciesSlice[];
  campus: SpotSlice[];
  trend: StatsPoint[];
  hotspots: Array<{ label: string; count: number }>;
  map: Array<{
    id: string;
    code: string;
    name: string;
    species: Species;
    healthLevel: HealthLevel;
    mapLat: number;
    mapLng: number;
  }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 数据统计页（2026-10-27 改版）。
 *
 * 健康率 = 非 RED 档案占比。设计稿写「平均健康率 78%」，这里必须按库里真实档位算 ——
 * 有多少 GREEN/YELLOW 就是多少，不做任何美化。
 */
export async function loadStatsPage(): Promise<StatsData> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const since30 = new Date(today.getTime() - 29 * DAY_MS);

  const [
    animals,
    bySpecies,
    records30d,
    alertsTotal,
    notRed,
    obsDates,
    alertDates,
    mapAnimals,
  ] = await Promise.all([
    prisma.animal.count(),
    prisma.animal.groupBy({ by: ['species'], _count: { _all: true } }),
    prisma.observation.count({ where: { createdAt: { gte: since30 } } }),
    prisma.alert.count(),
    prisma.animal.count({ where: { healthLevel: { not: 'RED' } } }),
    prisma.observation.findMany({
      where: { createdAt: { gte: since30 } },
      select: { createdAt: true, mapLat: true, mapLng: true },
    }),
    prisma.alert.findMany({ where: { createdAt: { gte: since30 } }, select: { createdAt: true } }),
    prisma.animal.findMany({
      where: { mapLat: { not: null }, mapLng: { not: null } },
      select: { id: true, code: true, name: true, species: true, healthLevel: true, mapLat: true, mapLng: true },
    }),
  ]);

  const speciesTotal = bySpecies.reduce((s, g) => s + g._count._all, 0) || 1;
  const SPECIES_LABEL: Record<Species, string> = { CAT: '猫', DOG: '狗' };
  const species: SpeciesSlice[] = bySpecies
    .map((g) => ({
      key: g.species,
      label: SPECIES_LABEL[g.species],
      count: g._count._all,
      pct: Math.round((g._count._all / speciesTotal) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  // 校园分布：按「档案点位最近的角落」统计（观察坐标零散，档案点位才是长期归属）
  const spotMap = new Map<string, number>();
  for (const a of mapAnimals) {
    const spot = nearestSpot(a.mapLat, a.mapLng);
    if (!spot) continue;
    spotMap.set(spot.name, (spotMap.get(spot.name) ?? 0) + 1);
  }
  const spotTotal = [...spotMap.values()].reduce((s, v) => s + v, 0) || 1;
  const campus: SpotSlice[] = [...spotMap.entries()]
    .map(([label, count]) => ({ key: label, label, count, pct: Math.round((count / spotTotal) * 100) }))
    .sort((a, b) => b.count - a.count);

  const dayKey = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const obsMap = new Map<string, number>();
  for (const o of obsDates) obsMap.set(dayKey(o.createdAt), (obsMap.get(dayKey(o.createdAt)) ?? 0) + 1);
  const alertMap = new Map<string, number>();
  for (const a of alertDates) alertMap.set(dayKey(a.createdAt), (alertMap.get(dayKey(a.createdAt)) ?? 0) + 1);
  const trend: StatsPoint[] = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today.getTime() - (29 - i) * DAY_MS);
    const k = dayKey(d);
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      label: `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      date: k,
      observations: obsMap.get(k) ?? 0,
      alerts: alertMap.get(k) ?? 0,
    };
  });

  return {
    kpi: {
      animals,
      records30d,
      healthRate: animals === 0 ? 0 : Math.round((notRed / animals) * 100),
      alertsTotal,
    },
    species,
    campus,
    trend,
    hotspots: campus.slice(0, 6).map((c) => ({ label: c.label, count: c.count })),
    map: mapAnimals.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      species: a.species,
      healthLevel: a.healthLevel,
      // Prisma 的 where 已过滤 null，这里收窄类型
      mapLat: a.mapLat as number,
      mapLng: a.mapLng as number,
    })),
  };
}
