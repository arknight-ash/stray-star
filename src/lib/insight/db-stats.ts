import { prisma } from '@/lib/db';
import { CAMPUS_SPOTS, nearestSpot } from '@/lib/map-config';
import type { PrismaClient } from '@prisma/client';

/**
 * 数据库概况快照 —— 星枢与星枢问答共用的**唯一统计口径**。
 *
 * 为什么单独建一层：两条问答链路此前只会"按编号/名字查一只动物的档案"，
 * 遇到「现在一共有几只」「本周记录了几条」「哪个角落最难找到」这类问题，
 * 要么答不上来，要么让模型自己数 —— 而模型数不清自己没看见的行。
 * 数字必须由数据库算，模型只负责把算好的数说出来。
 *
 * 口径细节（与图鉴、星图保持一致）：
 * - 角落归属用 `nearestSpot(档案坐标)`，和图鉴「常见位置」同一个函数；
 * - 观察的角落归属用观察自己的坐标，且只用已核实的记录；
 * - 「今天」按服务器本地时区零点起算，不是 UTC —— 用户问的是"今天"。
 */

export interface SpotStat {
  key: string;
  name: string;
  /** 档案坐标落在该角落的动物数 */
  animals: number;
  /** 已核实观察坐标落在该角落的条数 */
  observations: number;
}

export interface DbSnapshot {
  animals: {
    total: number;
    cats: number;
    dogs: number;
    green: number;
    yellow: number;
    red: number;
    pendingReview: number;
    located: number;
    missingLocation: number;
  };
  observations: {
    total: number;
    today: number;
    last7d: number;
    pendingReview: number;
    withPhoto: number;
  };
  alerts: { open: number; critical: number; warn: number; info: number };
  photos: number;
  users: number;
  spots: SpotStat[];
  /** 最近 5 条已核实记录 */
  latest: Array<{ code: string; name: string; content: string; at: string }>;
  /** 近 7 天被记录最多的个体 */
  topRecorded: Array<{ code: string; name: string; count: number }>;
}

export interface SnapshotDeps {
  db?: PrismaClient;
  /** 自测注入时钟，避免"今天"依赖真实日期 */
  now?: Date;
}

/** 本地时区当天零点 */
function startOfDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(now: Date, days: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d;
}

export async function loadDbSnapshot(deps: SnapshotDeps = {}): Promise<DbSnapshot> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  const today = startOfDay(now);
  const week = daysAgo(now, 7);

  const [
    speciesRows,
    healthRows,
    pendingAnimals,
    missingLoc,
    obsTotal,
    obsToday,
    obsWeek,
    obsPending,
    obsWithPhoto,
    alertRows,
    photos,
    users,
    latest,
    topRows,
    animalCoords,
    obsCoords,
  ] = await Promise.all([
    db.animal.groupBy({ by: ['species'], _count: { _all: true } }),
    db.animal.groupBy({ by: ['healthLevel'], _count: { _all: true } }),
    db.animal.count({ where: { pendingReview: true } }),
    db.animal.count({ where: { mapLat: null } }),
    db.observation.count(),
    db.observation.count({ where: { createdAt: { gte: today } } }),
    db.observation.count({ where: { createdAt: { gte: week } } }),
    db.observation.count({ where: { pendingReview: true } }),
    db.observation.count({ where: { imageUrl: { not: null } } }),
    db.alert.groupBy({ by: ['level'], where: { status: 'OPEN' }, _count: { _all: true } }),
    db.animalPhoto.count(),
    db.user.count(),
    db.observation.findMany({
      where: { pendingReview: false },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { content: true, createdAt: true, animal: { select: { code: true, name: true } } },
    }),
    db.observation.groupBy({
      by: ['animalId'],
      where: { createdAt: { gte: week } },
      _count: { _all: true },
    }),
    db.animal.findMany({ select: { code: true, name: true, mapLat: true, mapLng: true } }),
    db.observation.findMany({
      where: { pendingReview: false, mapLat: { not: null }, mapLng: { not: null } },
      select: { mapLat: true, mapLng: true },
    }),
  ]);

  const bySpecies = (key: string) => speciesRows.find((r) => r.species === key)?._count._all ?? 0;
  const byHealth = (key: string) => healthRows.find((r) => r.healthLevel === key)?._count._all ?? 0;
  const byLevel = (key: string) => alertRows.find((r) => r.level === key)?._count._all ?? 0;

  // 角落分布：两只动物落在同一角落就累加，没有坐标的不进任何角落
  const spotMap = new Map<string, SpotStat>(
    CAMPUS_SPOTS.map((s) => [s.key, { key: s.key, name: s.name, animals: 0, observations: 0 }]),
  );
  for (const a of animalCoords) {
    const spot = nearestSpot(a.mapLat, a.mapLng);
    if (spot) spotMap.get(spot.key)!.animals += 1;
  }
  for (const o of obsCoords) {
    const spot = nearestSpot(o.mapLat, o.mapLng);
    if (spot) spotMap.get(spot.key)!.observations += 1;
  }

  // 近 7 天记录数排序：groupBy 拿不到名字，单独查一次实体
  const sortedTop = [...topRows].sort((a, b) => b._count._all - a._count._all).slice(0, 3);
  const topAnimals = sortedTop.length
    ? await db.animal.findMany({
        where: { id: { in: sortedTop.map((r) => r.animalId) } },
        select: { id: true, code: true, name: true },
      })
    : [];
  const nameOf = new Map(topAnimals.map((a) => [a.id, a]));

  const total = animalCoords.length;

  return {
    animals: {
      total,
      cats: bySpecies('CAT'),
      dogs: bySpecies('DOG'),
      green: byHealth('GREEN'),
      yellow: byHealth('YELLOW'),
      red: byHealth('RED'),
      pendingReview: pendingAnimals,
      located: total - missingLoc,
      missingLocation: missingLoc,
    },
    observations: {
      total: obsTotal,
      today: obsToday,
      last7d: obsWeek,
      pendingReview: obsPending,
      withPhoto: obsWithPhoto,
    },
    alerts: {
      open: byLevel('CRITICAL') + byLevel('WARN') + byLevel('INFO'),
      critical: byLevel('CRITICAL'),
      warn: byLevel('WARN'),
      info: byLevel('INFO'),
    },
    photos,
    users,
    spots: [...spotMap.values()].sort(
      (a, b) => b.animals - a.animals || b.observations - a.observations,
    ),
    latest: latest.map((o) => ({
      code: o.animal.code,
      name: o.animal.name,
      content: o.content,
      at: o.createdAt.toISOString(),
    })),
    topRecorded: sortedTop
      .filter((r) => nameOf.has(r.animalId))
      .map((r) => ({
        code: nameOf.get(r.animalId)!.code,
        name: nameOf.get(r.animalId)!.name,
        count: r._count._all,
      })),
  };
}

/** 压成一段给模型看的事实文本（两条链路共用，避免各写一套措辞） */
export function describeSnapshot(s: DbSnapshot): string {
  const parts: string[] = [];
  parts.push(
    `档案 ${s.animals.total} 只（猫 ${s.animals.cats} / 狗 ${s.animals.dogs}；` +
      `健康 ${s.animals.green} / 观察 ${s.animals.yellow} / 预警 ${s.animals.red}）`,
  );
  if (s.animals.pendingReview) parts.push(`其中待核实 ${s.animals.pendingReview} 只`);
  if (s.animals.missingLocation) parts.push(`缺位置坐标 ${s.animals.missingLocation} 只`);
  parts.push(
    `观察记录 ${s.observations.total} 条（今天 ${s.observations.today}、近 7 天 ${s.observations.last7d}）`,
  );
  if (s.observations.pendingReview) parts.push(`待核实记录 ${s.observations.pendingReview} 条`);
  if (s.observations.withPhoto) parts.push(`带照片 ${s.observations.withPhoto} 条`);
  parts.push(
    `未处理预警 ${s.alerts.open} 条` +
      (s.alerts.open
        ? `（严重 ${s.alerts.critical} / 警告 ${s.alerts.warn} / 通知 ${s.alerts.info}）`
        : ''),
  );
  parts.push(`照片 ${s.photos} 张、在册同学 ${s.users} 人`);
  const active = s.spots.filter((x) => x.animals > 0 || x.observations > 0);
  if (active.length) {
    parts.push(
      `角落分布：${active
        .map((x) => `${x.name}（动物 ${x.animals} 只、记录 ${x.observations} 条）`)
        .join('、')}`,
    );
  }
  return parts.join('；');
}
