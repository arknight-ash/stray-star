import { prisma } from '@/lib/db';
import { nearestSpot } from '@/lib/map-config';
import type { HealthLevel, PrismaClient, Species } from '@prisma/client';

/**
 * 「按条件找人/找记录」的只读检索 —— 星枢与星枢问答共用。
 *
 * 与 queryArchive 的分工：那边是"我知道名字/编号，看这一只"，
 * 这里是"我不知道是谁，但我知道条件"（红色预警的都有谁、哪个角落还有谁没被记录过）。
 * 两者都不写库，写操作只能走业务链路（createObservation / createAnimal）。
 */

export interface AnimalRow {
  id: string;
  code: string;
  name: string;
  species: Species;
  healthLevel: HealthLevel;
  /** 档案坐标归到的校园角落（与图鉴「常见位置」同一算法）；无坐标为 null */
  spot: string | null;
  pendingReview: boolean;
  observationCount: number;
  lastObsAt: string | null;
  openAlerts: number;
}

export interface AnimalFilter {
  species?: Species;
  healthLevel?: HealthLevel | HealthLevel[];
  /** 角落名（「宿舍区」这种自然表述），按档案坐标匹配 */
  spotName?: string;
  pendingReview?: boolean;
  /** true = 只要没有坐标的（「位置待补充」） */
  missingLocation?: boolean;
  keyword?: string;
  limit?: number;
}

export interface ListDeps {
  db?: PrismaClient;
}

const DEFAULT_LIMIT = 30;

export async function listAnimals(
  filter: AnimalFilter = {},
  deps: ListDeps = {},
): Promise<AnimalRow[]> {
  const db = deps.db ?? prisma;
  const levels = Array.isArray(filter.healthLevel)
    ? filter.healthLevel
    : filter.healthLevel
      ? [filter.healthLevel]
      : undefined;

  const rows = await db.animal.findMany({
    where: {
      ...(filter.species ? { species: filter.species } : {}),
      ...(levels ? { healthLevel: { in: levels } } : {}),
      ...(filter.pendingReview !== undefined ? { pendingReview: filter.pendingReview } : {}),
      ...(filter.missingLocation ? { mapLat: null } : {}),
      ...(filter.keyword
        ? {
            OR: [
              { name: { contains: filter.keyword, mode: 'insensitive' as const } },
              { code: { contains: filter.keyword, mode: 'insensitive' as const } },
              { summary: { contains: filter.keyword, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ healthLevel: 'desc' }, { createdAt: 'asc' }],
    // 角落过滤在内存里做（要算坐标归属），所以先全量取，最后再按 limit 截断
    take: filter.spotName ? 300 : (filter.limit ?? DEFAULT_LIMIT),
    select: {
      id: true,
      code: true,
      name: true,
      species: true,
      healthLevel: true,
      mapLat: true,
      mapLng: true,
      pendingReview: true,
      _count: { select: { observations: true, alerts: true } },
      observations: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
      alerts: { where: { status: 'OPEN' }, select: { id: true } },
    },
  });

  const mapped: AnimalRow[] = rows.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    species: a.species,
    healthLevel: a.healthLevel,
    spot: nearestSpot(a.mapLat, a.mapLng)?.name ?? null,
    pendingReview: a.pendingReview,
    observationCount: a._count.observations,
    lastObsAt: a.observations[0]?.createdAt.toISOString() ?? null,
    openAlerts: a.alerts.length,
  }));

  const filtered = filter.spotName ? mapped.filter((a) => a.spot === filter.spotName) : mapped;
  return filtered.slice(0, filter.limit ?? DEFAULT_LIMIT);
}

export interface ObservationRow {
  code: string;
  name: string;
  content: string;
  type: string;
  at: string;
  spot: string | null;
  hasPhoto: boolean;
}

export interface ObservationFilter {
  /** 正文关键词 */
  keyword?: string;
  /** 最近 N 天；不传 = 不限 */
  days?: number;
  spotName?: string;
  animalCode?: string;
  /** 只看待核实 / 只看已核实 */
  pendingReview?: boolean;
  limit?: number;
}

export async function listObservations(
  filter: ObservationFilter = {},
  deps: ListDeps & { now?: Date } = {},
): Promise<ObservationRow[]> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  const since = filter.days ? new Date(now.getTime() - filter.days * 86_400_000) : null;

  const rows = await db.observation.findMany({
    where: {
      ...(since ? { createdAt: { gte: since } } : {}),
      ...(filter.keyword
        ? { content: { contains: filter.keyword, mode: 'insensitive' as const } }
        : {}),
      ...(filter.animalCode
        ? { animal: { code: { contains: filter.animalCode, mode: 'insensitive' as const } } }
        : {}),
      ...(filter.pendingReview !== undefined ? { pendingReview: filter.pendingReview } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: filter.spotName ? 200 : (filter.limit ?? 10),
    select: {
      content: true,
      type: true,
      createdAt: true,
      imageUrl: true,
      mapLat: true,
      mapLng: true,
      animal: { select: { code: true, name: true } },
    },
  });

  const mapped: ObservationRow[] = rows.map((o) => ({
    code: o.animal.code,
    name: o.animal.name,
    content: o.content,
    type: o.type,
    at: o.createdAt.toISOString(),
    spot: nearestSpot(o.mapLat, o.mapLng)?.name ?? null,
    hasPhoto: Boolean(o.imageUrl),
  }));

  const filtered = filter.spotName ? mapped.filter((o) => o.spot === filter.spotName) : mapped;
  return filtered.slice(0, filter.limit ?? 10);
}
