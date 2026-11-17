import { prisma } from '../db';
import { nearestSpot } from '../map-config';
import { isManualSevereAlert } from '../alerts/rules';
import type { AlertLevel, AlertStatus, HealthLevel, ObservationType, Species } from '@/types/domain';

/**
 * 管理端总览的数据装载（2026-10-27 新增）。
 *
 * 一次把所有面板要的数据取齐，页面只负责排版 —— 总览页有 9 块内容，
 * 让每块各自查库会得到 9 个串行往返，首屏肉眼可见地慢。
 *
 * 日桶在 JS 里算而不是 SQL `date_trunc`：这张表是「校园级」体量（几十到几千行），
 * 一次取回 createdAt 再归桶比写一段带时区的 SQL 更短、更好读。
 * 真长到几十万行时再改成 SQL 聚合，届时语义（本地时区分桶）照这个实现对齐。
 */

export const TREND_RANGES = [7, 30, 90] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

export interface TrendPoint {
  /** MM-DD，图表 X 轴标签 */
  label: string;
  /** 完整日期，hover title 用 */
  date: string;
  observations: number;
  alerts: number;
}

export interface AlertBrief {
  id: string;
  level: AlertLevel;
  status: AlertStatus;
  reason: string;
  /** 同学手动标记「情况紧急」喊出来的（规则 R4）。总览上要单独标出来 */
  manualSevere: boolean;
  createdAt: string;
  animalName: string;
  animalCode: string;
}

export interface RecordBrief {
  id: string;
  type: ObservationType;
  content: string;
  createdAt: string;
  pendingReview: boolean;
  /** 离坐标最近的校园角落；没坐标就是 null */
  spotName: string | null;
  animalName: string;
  animalCode: string;
  animalAvatar: string | null;
}

export interface OverviewKpi {
  openAlerts: number;
  criticalAlerts: number;
  animals: number;
  animalsNew7d: number;
  pendingAnimals: number;
  todayObservations: number;
  yesterdayObservations: number;
  todayFeeding: number;
  totalObservations: number;
  photos: number;
}

export interface LevelSlice {
  level: AlertLevel;
  count: number;
}

export interface OverviewData {
  kpi: OverviewKpi;
  alerts: AlertBrief[];
  records: RecordBrief[];
  levels: LevelSlice[];
  trends: Record<TrendRange, TrendPoint[]>;
  map: {
    animals: Array<{
      id: string;
      code: string;
      name: string;
      species: Species;
      healthLevel: HealthLevel;
      mapLat: number;
      mapLng: number;
    }>;
    alerts: Array<{
      animalId: string;
      status: AlertStatus;
      level: AlertLevel;
      reason: string;
    }>;
  };
}

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(at: Date): Date {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shortLabel(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 归桶：把「某天有 N 条」摊进连续日期序列，没数据的那天补 0（图不能断） */
function buildBuckets(days: number, obs: Date[], alertRows: Date[]): TrendPoint[] {
  const today = startOfDay(new Date());
  const obsMap = new Map<string, number>();
  const alertMap = new Map<string, number>();
  for (const d of obs) {
    const k = dayKey(d);
    obsMap.set(k, (obsMap.get(k) ?? 0) + 1);
  }
  for (const d of alertRows) {
    const k = dayKey(d);
    alertMap.set(k, (alertMap.get(k) ?? 0) + 1);
  }

  const out: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today.getTime() - i * DAY);
    const k = dayKey(d);
    out.push({
      label: shortLabel(d),
      date: k,
      observations: obsMap.get(k) ?? 0,
      alerts: alertMap.get(k) ?? 0,
    });
  }
  return out;
}

export async function loadOverview(): Promise<OverviewData> {
  const today = startOfDay(new Date());
  const yesterday = new Date(today.getTime() - DAY);
  const weekAgo = new Date(today.getTime() - 7 * DAY);
  const since90 = new Date(today.getTime() - 90 * DAY);

  const [
    animals,
    animalTotal,
    animalsNew7d,
    pendingAnimals,
    totalObservations,
    todayObservations,
    yesterdayObservations,
    todayFeeding,
    photos,
    recentAlerts,
    recentlyObserved,
    levelGroups,
    openAlerts,
  ] = await Promise.all([
    prisma.animal.findMany({
      where: { mapLat: { not: null }, mapLng: { not: null } },
      select: {
        id: true,
        code: true,
        name: true,
        species: true,
        healthLevel: true,
        mapLat: true,
        mapLng: true,
      },
    }),
    prisma.animal.count(),
    prisma.animal.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.animal.count({ where: { pendingReview: true } }),
    prisma.observation.count(),
    prisma.observation.count({ where: { createdAt: { gte: today } } }),
    prisma.observation.count({ where: { createdAt: { gte: yesterday, lt: today } } }),
    prisma.observation.count({ where: { type: 'FEEDING', createdAt: { gte: today } } }),
    prisma.animalPhoto.count(),
    prisma.alert.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        level: true,
        status: true,
        reason: true,
        source: true,
        dedupeKey: true,
        createdAt: true,
        animal: { select: { name: true, code: true } },
      },
    }),
    prisma.observation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        type: true,
        content: true,
        createdAt: true,
        pendingReview: true,
        mapLat: true,
        mapLng: true,
        animal: { select: { name: true, code: true, avatarUrl: true } },
      },
    }),
    prisma.alert.groupBy({ by: ['level'], _count: { _all: true } }),
    prisma.alert.findMany({
      where: { status: 'OPEN' },
      select: { animalId: true, status: true, level: true, reason: true },
    }),
  ]);

  // 趋势需要的原始时间戳：一次取 90 天，三档区间在内存里切
  const [obsTimes, alertTimes] = await Promise.all([
    prisma.observation.findMany({
      where: { createdAt: { gte: since90 } },
      select: { createdAt: true },
    }),
    prisma.alert.findMany({ where: { createdAt: { gte: since90 } }, select: { createdAt: true } }),
  ]);
  const obsDates = obsTimes.map((o) => o.createdAt);
  const alertDates = alertTimes.map((a) => a.createdAt);

  const trends = {
    7: buildBuckets(7, obsDates, alertDates),
    30: buildBuckets(30, obsDates, alertDates),
    90: buildBuckets(90, obsDates, alertDates),
  } satisfies Record<TrendRange, TrendPoint[]>;

  const levelOrder: AlertLevel[] = ['CRITICAL', 'WARN', 'INFO'];
  const levelCount = new Map<AlertLevel, number>();
  for (const g of levelGroups) levelCount.set(g.level, g._count._all);

  return {
    kpi: {
      openAlerts: openAlerts.length,
      criticalAlerts: openAlerts.filter((a) => a.level === 'CRITICAL').length,
      animals: animalTotal,
      animalsNew7d,
      pendingAnimals,
      todayObservations,
      yesterdayObservations,
      todayFeeding,
      totalObservations,
      photos,
    },
    alerts: recentAlerts.map((a) => ({
      id: a.id,
      level: a.level,
      status: a.status,
      reason: a.reason,
      manualSevere: isManualSevereAlert(a),
      createdAt: a.createdAt.toISOString(),
      animalName: a.animal.name,
      animalCode: a.animal.code,
    })),
    records: recentlyObserved.map((o) => {
      const spot =
        o.mapLat !== null && o.mapLng !== null ? nearestSpot(o.mapLat, o.mapLng) : null;
      return {
        id: o.id,
        type: o.type,
        content: o.content,
        createdAt: o.createdAt.toISOString(),
        pendingReview: o.pendingReview,
        spotName: spot?.name ?? null,
        animalName: o.animal.name,
        animalCode: o.animal.code,
        animalAvatar: o.animal.avatarUrl,
      };
    }),
    levels: levelOrder
      .map((level) => ({ level, count: levelCount.get(level) ?? 0 }))
      .filter((s) => s.count > 0),
    trends,
    map: {
      animals: animals.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        species: a.species,
        healthLevel: a.healthLevel,
        mapLat: a.mapLat as number,
        mapLng: a.mapLng as number,
      })),
      alerts: openAlerts.map((a) => ({
        animalId: a.animalId,
        status: a.status,
        level: a.level,
        reason: a.reason,
      })),
    },
  };
}
