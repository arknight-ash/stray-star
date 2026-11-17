import { prisma } from '@/lib/db';
import { nearestSpot, type CampusSpot } from '@/lib/map-config';
import type { PrismaClient } from '@prisma/client';

/**
 * 「这只动物平时在哪活动」的**唯一口径**。
 *
 * 图鉴/档案页显示「常见位置：X附近」用的是 `nearestSpot(档案坐标)` —— 由坐标归到最近的校园角落。
 * 但问答链路（星枢 / 星枢问答）此前只读档案摘要和观察正文，正文里写的是「车棚」「北侧」这类
 * 自由描述，模型据此回答就会说成「工程训练中心车棚」，与图鉴的「宿舍区附近」对不上。
 *
 * 所以把这件事收敛成一个函数：谁能回答"它在哪"，就从这里取，两条链路与图鉴同一个算法。
 * 观察坐标（而不是文字）也参与统计 —— 那是"确实在哪被看到过"的硬证据，
 * 但仍然只用已核实（pendingReview = false）的记录，未核实的说法不能当事实。
 */

export interface SpotVisit {
  key: string;
  name: string;
  count: number;
}

export interface Whereabouts {
  /** 档案坐标归到的角落（与图鉴「常见位置」同一算法） */
  spot: CampusSpot | null;
  coords: { lat: number; lng: number } | null;
  /** 已核实观察按坐标归类的分布，按次数降序 */
  visits: SpotVisit[];
}

export const EMPTY_WHEREABOUTS: Whereabouts = { spot: null, coords: null, visits: [] };

/** 观察坐标的统计上限：够看出"常出没"就行，不必把整本手账扫一遍 */
const VISIT_SAMPLE = 50;
/** 只报前三名，避免答案里堆一串一次性地点 */
const VISIT_TOP = 3;

export interface WhereaboutsDeps {
  db?: PrismaClient;
}

export async function loadWhereabouts(
  animalId: string,
  deps: WhereaboutsDeps = {},
): Promise<Whereabouts> {
  const db = deps.db ?? prisma;

  const [animal, observations] = await Promise.all([
    db.animal.findUnique({
      where: { id: animalId },
      select: { mapLat: true, mapLng: true },
    }),
    db.observation.findMany({
      where: { animalId, pendingReview: false, mapLat: { not: null }, mapLng: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: VISIT_SAMPLE,
      select: { mapLat: true, mapLng: true },
    }),
  ]);

  const coords =
    animal?.mapLat !== null && animal?.mapLat !== undefined && animal.mapLng !== null
      ? { lat: animal.mapLat, lng: animal.mapLng as number }
      : null;

  const counts = new Map<string, SpotVisit>();
  for (const o of observations) {
    const spot = nearestSpot(o.mapLat, o.mapLng);
    if (!spot) continue;
    const hit = counts.get(spot.key);
    if (hit) hit.count += 1;
    else counts.set(spot.key, { key: spot.key, name: spot.name, count: 1 });
  }
  const visits = [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, VISIT_TOP);

  return {
    spot: coords ? nearestSpot(coords.lat, coords.lng) : null,
    coords,
    visits,
  };
}

/**
 * 压成一句给模型看的事实描述（两个入口共用，保证口径一致）。
 * 没有坐标也没有带坐标的观察 → null，调用方当作"没有位置依据"，不要硬答。
 */
export function describeWhereabouts(w: Whereabouts): string | null {
  const parts: string[] = [];
  if (w.spot) {
    parts.push(`档案坐标位于「${w.spot.name}」附近`);
  }
  if (w.visits.length) {
    parts.push(
      `已核实记录里出现最多的是${w.visits.map((v) => `${v.name}（${v.count} 次）`).join('、')}`,
    );
  }
  return parts.length ? parts.join('；') : null;
}

/** 观察正文是自由描述，可能写着图上没有的地名（如「车棚」），回答时要标明这是文字线索 */
export const WHEREABOUTS_RULE =
  '关于「在哪活动」：以上面的档案坐标归类为官方口径（与图鉴的「常见位置」一致）；' +
  '观察正文里的地名只是当时的文字描述，若与坐标归类不同，要说明两者都有，不要只挑一个说。';
